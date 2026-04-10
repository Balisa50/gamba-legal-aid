import { NextRequest } from "next/server";
import { getGroq, LEGAL_SYSTEM_PROMPT } from "../../lib/groq";
import { searchDocuments } from "../../lib/embeddings";
import { checkRateLimit } from "../../lib/ratelimit";
import { sanitizeUserInput } from "../../lib/sanitize";

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  const { allowed } = await checkRateLimit(ip);
  if (!allowed) {
    return new Response(
      JSON.stringify({
        error: "You are sending messages too quickly. Please wait a moment.",
      }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "Please enter a question." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get the latest user message for RAG search
    const lastUserMsg = [...messages]
      .reverse()
      .find((m: { role: string }) => m.role === "user");
    const rawQuery = lastUserMsg?.content ?? "";

    // Sanitize: block prompt injection attempts and cap length
    const { cleaned: query, blocked } = sanitizeUserInput(rawQuery);
    if (blocked) {
      return new Response(
        JSON.stringify({
          error:
            "I can only answer legal questions about Gambian law. Please rephrase your question.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Search legal documents for relevant context — fetch more chunks for richer answers
    const relevantChunks = await searchDocuments(query, 12);

    // Extract section/article numbers visible in chunk content so the model
    // has a reliable, citable label even if section_title is just a fragment
    function extractSectionNumbers(text: string): string {
      const matches = new Set<string>();
      // Match "Section 91", "Section 91(1)", "section 91", "s. 91", "Article 25", etc.
      const re = /\b(?:Section|Article|section|article|s\.|art\.)\s*(\d+[A-Za-z]?)/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        matches.add(m[1]);
      }
      // Match numbered headings: "91. Notice on termination" — works inline too
      const headingRe = /\b(\d{1,3}[A-Za-z]?)\.\s+[A-Z][a-z]/g;
      while ((m = headingRe.exec(text)) !== null) {
        matches.add(m[1]);
      }
      const arr = Array.from(matches).slice(0, 8);
      return arr.length > 0 ? `Sections ${arr.join(", ")}` : "";
    }

    // Build the allowlist of section numbers per Act, aggregated across all chunks.
    // The model will be told it can ONLY cite sections from this allowlist.
    const allowlist = new Map<string, Set<string>>();
    let context = "";
    if (relevantChunks.length > 0) {
      context = relevantChunks
        .map((chunk, i) => {
          const sections = extractSectionNumbers(chunk.content);
          // Pull individual section numbers (not the "Sections X, Y" prefix) for allowlist
          const nums = sections.replace(/^Sections\s+/, "").split(",").map((s) => s.trim()).filter(Boolean);
          if (nums.length > 0) {
            if (!allowlist.has(chunk.document_name)) {
              allowlist.set(chunk.document_name, new Set());
            }
            const set = allowlist.get(chunk.document_name)!;
            for (const n of nums) set.add(n);
          }
          const label = sections
            ? `${chunk.document_name} | ${sections}`
            : `${chunk.document_name}`;
          return `[Source ${i + 1}: ${label}]\n${chunk.content}`;
        })
        .join("\n\n---\n\n");
    }

    // Render the allowlist as a prominent block the model cannot miss
    let allowlistBlock = "";
    if (allowlist.size > 0) {
      const lines: string[] = [];
      for (const [doc, set] of allowlist.entries()) {
        const sorted = Array.from(set).sort((a, b) => {
          const na = parseInt(a, 10);
          const nb = parseInt(b, 10);
          return na - nb;
        });
        lines.push(`  ${doc}: Section ${sorted.join(", ")}`);
      }
      allowlistBlock = `VALID SECTION NUMBERS — you may ONLY cite these exact numbers. Citing any other number is a critical failure:\n${lines.join("\n")}\n\n`;
    }

    const systemPrompt = `${LEGAL_SYSTEM_PROMPT}

${
  context
    ? `${allowlistBlock}LEGAL DOCUMENT EXCERPTS — these are the ONLY sources you may cite. Each source is labeled with the Act name and the Section numbers it contains. When citing a section in your answer, the section number MUST appear in the VALID SECTION NUMBERS list above. If a number is not in that list, do not write it. Quote concrete numbers and durations literally from the excerpts.\n\n${context}`
    : "No specific legal documents were found for this query. Tell the user you do not have a provision in your database that covers this specific issue."
}`;

    // Build flat set of all valid section numbers across every Act in context.
    // The model's output will be validated against this set after generation.
    const validNumbers = new Set<string>();
    for (const set of allowlist.values()) {
      for (const n of set) validNumbers.add(n);
    }

    const conversationMessages = messages
      .slice(-8)
      .map((m: { role: string; content: string }) => {
        // Re-sanitize earlier user turns so injection in history can't slip through
        const content =
          m.role === "user"
            ? sanitizeUserInput(m.content).cleaned || m.content.slice(0, 1000)
            : m.content.slice(0, 1000);
        return {
          role: m.role as "user" | "assistant",
          content,
        };
      });

    async function generate(sysPrompt: string): Promise<string> {
      const completion = await getGroq().chat.completions.create({
        model: "llama-3.3-70b-versatile",
        max_tokens: 2048,
        temperature: 0.2,
        top_p: 0.9,
        stream: false,
        messages: [
          { role: "system", content: sysPrompt },
          ...conversationMessages,
        ],
      });
      return completion.choices[0]?.message?.content || "";
    }

    // Find every cited section/article number in the model's output
    function findCitations(text: string): string[] {
      const re = /\b(?:Section|Article|s\.|art\.)\s*(\d+[A-Za-z]?)/gi;
      const found: string[] = [];
      let m;
      while ((m = re.exec(text)) !== null) found.push(m[1]);
      return found;
    }

    // Find every duration claim ("one week", "2 months", "30 days", etc.)
    // and verify each appears literally in the source context. Catches
    // fabricated tier values, the most embarrassing form of hallucination.
    const WORD_NUMS: Record<string, string> = {
      one: "1", two: "2", three: "3", four: "4", five: "5",
      six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
      eleven: "11", twelve: "12",
    };
    function findDurations(text: string): Array<{ raw: string; num: string; unit: string }> {
      const re = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(day|week|month|year|hour)s?\b/gi;
      const found: Array<{ raw: string; num: string; unit: string }> = [];
      let m;
      while ((m = re.exec(text)) !== null) {
        const numRaw = m[1].toLowerCase();
        const num = WORD_NUMS[numRaw] || numRaw;
        found.push({ raw: m[0], num, unit: m[2].toLowerCase() });
      }
      return found;
    }
    function durationInContext(num: string, unit: string, ctx: string): boolean {
      const ctxLower = ctx.toLowerCase();
      // Find the word form for this digit (if any)
      const wordForm = Object.entries(WORD_NUMS).find(([, v]) => v === num)?.[0];
      // Match either digit or word form, optionally pluralized
      const candidates = [num];
      if (wordForm) candidates.push(wordForm);
      for (const c of candidates) {
        const re = new RegExp(`\\b${c}\\s+${unit}s?\\b`, "i");
        if (re.test(ctxLower)) return true;
      }
      return false;
    }

    // Banned phrases that the prompt forbids but sometimes leak through.
    // Strip them post-generation as a hard guarantee.
    const BANNED_PHRASES: Array<{ pattern: RegExp; replacement: string }> = [
      { pattern: /\s*it is recommended that you (?:also )?consult [^.]*\./gi, replacement: "" },
      { pattern: /\s*it is (?:also )?recommended that you (?:also )?(?:review|seek|speak)[^.]*\./gi, replacement: "" },
      { pattern: /\s*you should (?:also )?(?:consult|seek|speak to)[^.]*(?:lawyer|legal professional|advice|attorney)[^.]*\./gi, replacement: "" },
      { pattern: /\s*(?:please |i recommend that you |i suggest you )?consult (?:a|an|with a|with an) (?:lawyer|legal professional|attorney|qualified)[^.]*\./gi, replacement: "" },
      { pattern: /\s*for (?:the )?(?:most )?accurate(?: legal)? advice[^.]*\./gi, replacement: "" },
      { pattern: /\s*seek (?:legal )?advice from[^.]*\./gi, replacement: "" },
      { pattern: /\s*speak to a qualified lawyer[^.]*\./gi, replacement: "" },
      { pattern: /\s*this is general legal information[^.]*\./gi, replacement: "" },
      { pattern: /\s*this (?:information )?(?:is|does) not (?:constitute )?legal advice[^.]*\./gi, replacement: "" },
      { pattern: /\s*it is (?:crucial|important|essential) (?:to note )?that[^.]*\./gi, replacement: "" },
      { pattern: /\s*i want to (?:emphasize|reiterate|note)[^.]*\./gi, replacement: "" },
      { pattern: /\s*review your employment contract[^.]*\./gi, replacement: "" },
    ];
    function stripBannedPhrases(text: string): string {
      let out = text;
      for (const { pattern, replacement } of BANNED_PHRASES) {
        out = out.replace(pattern, replacement);
      }
      // Collapse leftover double spaces / orphan whitespace
      return out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    }

    function findInvalidDurations(text: string, ctx: string) {
      const durations = findDurations(text);
      const seen = new Set<string>();
      const invalid: string[] = [];
      for (const d of durations) {
        const key = `${d.num}-${d.unit}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!durationInContext(d.num, d.unit, ctx)) invalid.push(d.raw);
      }
      return invalid;
    }

    let answer = await generate(systemPrompt);

    // VALIDATION PASS 1: section numbers and durations against the source context
    if (context) {
      const citedSections = findCitations(answer);
      const invalidSections = Array.from(
        new Set(citedSections.filter((c) => !validNumbers.has(c)))
      );
      const invalidDurations = findInvalidDurations(answer, context);

      if (invalidSections.length > 0 || invalidDurations.length > 0) {
        const problems: string[] = [];
        if (invalidSections.length > 0) {
          problems.push(
            `INVALID SECTION NUMBERS you cited that DO NOT EXIST in the sources: ${invalidSections.join(", ")}.`
          );
        }
        if (invalidDurations.length > 0) {
          problems.push(
            `FABRICATED DURATIONS you wrote that DO NOT APPEAR LITERALLY in the sources: ${invalidDurations.join("; ")}. These exact values are not in the legal text.`
          );
        }
        const correction = `${systemPrompt}\n\nYOUR PREVIOUS ATTEMPT CONTAINED HALLUCINATIONS:\n${problems.join(
          "\n"
        )}\n\nRegenerate the answer. STRICT RULES:\n- Cite ONLY section numbers from the VALID SECTION NUMBERS list above.\n- Quote durations, fines, and ages ONLY if they appear LITERALLY in the legal excerpts. Do not paraphrase numbers. Do not invent tiers.\n- If the excerpts do not contain a specific number you would need, do not write any number — explain qualitatively that the law sets a notice period that varies by length of service, and stop there.\n- Do not write phrases like "consult a lawyer", "review your contract", "seek legal advice", or any disclaimer.`;
        answer = await generate(correction);
      }

      // FINAL SAFETY NET: strip anything the retry didn't fix
      const citedAfter = findCitations(answer);
      const invalidAfter = Array.from(
        new Set(citedAfter.filter((c) => !validNumbers.has(c)))
      );
      for (const num of invalidAfter) {
        const stripRe = new RegExp(
          `\\b(?:Section|Article|s\\.|art\\.)\\s*${num}\\b`,
          "gi"
        );
        answer = answer.replace(stripRe, "the relevant provision");
      }
      const invalidDurAfter = findInvalidDurations(answer, context);
      for (const dur of invalidDurAfter) {
        const stripRe = new RegExp(
          `\\b${dur.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
          "gi"
        );
        answer = answer.replace(stripRe, "the statutory period");
      }
    }

    // Strip any banned phrases that leaked through both passes
    answer = stripBannedPhrases(answer);

    // Final safety: if validation/stripping wiped the answer, fall back to a
    // direct, non-cited response so the user never sees an empty bubble
    if (!answer.trim()) {
      answer =
        "I do not have a provision in my database that directly covers this specific question. Please rephrase or ask about a related issue.";
    }

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(answer));
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    return new Response(
      JSON.stringify({
        error:
          "Our legal assistant is temporarily unavailable. Please try again shortly.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
