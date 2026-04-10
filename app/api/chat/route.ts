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

    // Extract CANONICAL section numbers from a chunk.
    //
    // The chunks are PDF text with headings embedded inline like
    // "91. Notice on termination of contracts" — these are canonical.
    // Cross-references appear as "section 91" or "sections 128 to 134" —
    // those do NOT match the "NUMBER. Title" pattern.
    //
    // Rule: a number is canonical if it appears as `NUMBER. Title-Case-Word`
    // AND is not preceded by the word "section" or "sections".
    function extractSectionNumbers(text: string): string {
      const matches = new Set<string>();
      const headingRe = /\b(\d{1,3}[A-Za-z]?)\.\s+[A-Z][a-zA-Z]+/g;
      let m;
      while ((m = headingRe.exec(text)) !== null) {
        const lookback = text.slice(Math.max(0, m.index - 12), m.index).toLowerCase();
        if (/sections?\s+$/.test(lookback)) continue;
        matches.add(m[1]);
      }
      const arr = Array.from(matches).slice(0, 12);
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
        max_tokens: 1200,
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
      // "You should consult / seek / speak / contact / talk to / reach out / get advice / review..."
      { pattern: /\s*you (?:should|may want to|might want to|can|could)\s+(?:also\s+)?(?:consult|seek|speak|contact|talk|reach out|get|obtain|hire|engage|retain|see|visit|review)[^.]*\./gi, replacement: "" },
      // "It is recommended / advisable / advised that you..."
      { pattern: /\s*it is (?:recommended|advisable|advised|suggested|wise|prudent)[^.]*\./gi, replacement: "" },
      // "I recommend / I suggest / I advise..."
      { pattern: /\s*i (?:recommend|suggest|advise|would (?:recommend|suggest|advise))[^.]*\./gi, replacement: "" },
      // "Consult a lawyer..." in any form
      { pattern: /\s*(?:please |kindly )?consult (?:with )?(?:a|an|the)?\s*(?:qualified |licensed |professional )?(?:lawyer|legal professional|attorney|advocate|solicitor)[^.]*\./gi, replacement: "" },
      // "Seek legal advice / professional advice / further advice..."
      { pattern: /\s*seek (?:out )?(?:legal|professional|further|specialist|expert)\s+advice[^.]*\./gi, replacement: "" },
      // "For accurate / legal / professional advice..."
      { pattern: /\s*for (?:the )?(?:most )?(?:accurate|specific|tailored|personalised|personalized|professional|legal)\s+(?:legal\s+)?advice[^.]*\./gi, replacement: "" },
      // "Speak / talk to a qualified lawyer..."
      { pattern: /\s*(?:speak|talk) to (?:a|an) (?:qualified |licensed )?(?:lawyer|legal professional|attorney)[^.]*\./gi, replacement: "" },
      // Disclaimers
      { pattern: /\s*this is general legal information[^.]*\./gi, replacement: "" },
      { pattern: /\s*this (?:information )?(?:is|does) not (?:constitute )?legal advice[^.]*\./gi, replacement: "" },
      // Filler emphasis
      { pattern: /\s*it is (?:crucial|important|essential|vital|imperative|necessary)\s+(?:to\s+(?:note|remember|understand|emphasize|mention)\s+)?(?:that\s+)?[^.]*\./gi, replacement: "" },
      { pattern: /\s*i want to (?:emphasize|reiterate|note|stress|highlight|point out)[^.]*\./gi, replacement: "" },
      { pattern: /\s*it (?:is|'s) (?:worth|important)\s+(?:noting|mentioning|remembering)[^.]*\./gi, replacement: "" },
      { pattern: /\s*(?:please )?(?:note|be aware)\s+that[^.]*(?:lawyer|legal advice|consult|circumstances may vary)[^.]*\./gi, replacement: "" },
      { pattern: /\s*review your employment contract[^.]*\./gi, replacement: "" },
      { pattern: /\s*(?:additionally,?\s*)?(?:keep|bear) in mind[^.]*\./gi, replacement: "" },
      // Catch any remaining "consult... lawyer/advice/professional" sentence
      { pattern: /\s*[^.]*consult[^.]*(?:lawyer|legal advice|legal professional|attorney|advocate|solicitor)[^.]*\./gi, replacement: "" },
    ];
    function stripBannedPhrases(text: string): string {
      let out = text;
      for (const { pattern, replacement } of BANNED_PHRASES) {
        out = out.replace(pattern, replacement);
      }

      // Clean up orphan sentence starters left behind by mid-sentence strips,
      // e.g. "You should If you believe..." → "If you believe..."
      out = out.replace(
        /\b(?:You should|You may|You can|It is|Additionally,|Furthermore,|Moreover,)\s+(?=[A-Z][a-z])/g,
        ""
      );

      // Collapse leftover double spaces / orphan whitespace
      out = out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();

      // Drop empty paragraphs and lone-fragment lines
      out = out
        .split(/\n\n+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 20)
        .join("\n\n");

      // If the answer ends mid-sentence (no terminal punctuation), trim back
      // to the last complete sentence so the user never sees a half-cut reply.
      if (!/[.!?]"?\)?$/.test(out)) {
        const lastTerm = Math.max(
          out.lastIndexOf("."),
          out.lastIndexOf("!"),
          out.lastIndexOf("?")
        );
        if (lastTerm > 50) {
          out = out.slice(0, lastTerm + 1).trim();
        }
      }
      return out;
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

    // Normalize text for fuzzy substring comparison: lowercase, collapse
    // whitespace, replace curly quotes/apostrophes/dashes with ASCII versions.
    function normalize(s: string): string {
      return s
        .toLowerCase()
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
        .replace(/[\u2013\u2014\u2012]/g, "-")
        .replace(/\s+/g, " ")
        .trim();
    }

    // Find every quoted span in the answer and verify it appears as a
    // substring of the source context. If a quote isn't in the context,
    // it's a fabrication. Handles both straight and curly quotes.
    function findInvalidQuotes(text: string, ctx: string): string[] {
      const ctxNorm = normalize(ctx);
      const invalid: string[] = [];
      // Match quoted spans of 3+ words. Accept straight (") and curly (" ")
      // quote pairs. Min length 10 chars, max 400.
      const re = /["\u201C]([^"\u201C\u201D]{10,400})["\u201D]/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const quote = m[1];
        const wordCount = quote.trim().split(/\s+/).length;
        if (wordCount < 3) continue;
        const quoteNorm = normalize(quote);
        if (!ctxNorm.includes(quoteNorm)) {
          invalid.push(quote.length > 80 ? quote.slice(0, 80) + "..." : quote);
        }
      }
      return invalid;
    }

    const buildId = "v7-hard-fail";
    console.log(`[chat] build=${buildId} query="${query.slice(0, 60)}" allowlist=${validNumbers.size} chunks=${relevantChunks.length}`);

    let answer = await generate(systemPrompt);

    // VALIDATION PASS 1: sections, quotes, and durations against the source context
    if (context) {
      const citedSections = findCitations(answer);
      const invalidSections = Array.from(
        new Set(citedSections.filter((c) => !validNumbers.has(c)))
      );
      const invalidQuotes = findInvalidQuotes(answer, context);
      const invalidDurations = findInvalidDurations(answer, context);

      console.log(
        `[chat] pass1 cited=[${citedSections.join(",")}] invalidSections=[${invalidSections.join(",")}] invalidQuotes=${invalidQuotes.length} invalidDurations=${invalidDurations.length}`
      );

      if (
        invalidSections.length > 0 ||
        invalidQuotes.length > 0 ||
        invalidDurations.length > 0
      ) {
        const problems: string[] = [];
        if (invalidSections.length > 0) {
          problems.push(
            `INVALID SECTION NUMBERS you cited that DO NOT EXIST in the sources: ${invalidSections.join(", ")}.`
          );
        }
        if (invalidQuotes.length > 0) {
          problems.push(
            `FABRICATED QUOTES — these quoted phrases do NOT appear in the legal excerpts: ${invalidQuotes.map((q) => `"${q}"`).join("; ")}. You may only put text in quotation marks if it appears LITERALLY in the excerpts above.`
          );
        }
        if (invalidDurations.length > 0) {
          problems.push(
            `FABRICATED DURATIONS you wrote that DO NOT APPEAR LITERALLY in the sources: ${invalidDurations.join("; ")}. These exact values are not in the legal text.`
          );
        }
        console.log(`[chat] retry triggered: ${problems.length} problem(s)`);
        const correction = `${systemPrompt}\n\nYOUR PREVIOUS ATTEMPT CONTAINED HALLUCINATIONS:\n${problems.join(
          "\n"
        )}\n\nRegenerate the answer. STRICT RULES:\n- Cite ONLY section numbers from the VALID SECTION NUMBERS list above.\n- Any text inside quotation marks MUST be a verbatim, character-for-character copy of text from the legal excerpts above. Do not paraphrase inside quotes. If you can't find the exact wording, do not use quotation marks at all — explain in your own words instead.\n- Quote durations, fines, and ages ONLY if they appear LITERALLY in the legal excerpts. Do not invent tiers or simplify multi-clause provisions.\n- If a provision has subsections (a), (b), (c), reproduce them all literally. Do not collapse them.\n- If the excerpts do not contain a specific number you would need, do not write any number — explain qualitatively and stop there.\n- Do not write phrases like "consult a lawyer", "review your contract", "seek legal advice", or any disclaimer.`;
        answer = await generate(correction);

        const citedAfter = findCitations(answer);
        const invalidQuotesRetry = findInvalidQuotes(answer, context);
        const invalidDurationsRetry = findInvalidDurations(answer, context);
        console.log(
          `[chat] retry result cited=[${citedAfter.join(",")}] invalidQuotes=${invalidQuotesRetry.length} invalidDurations=${invalidDurationsRetry.length}`
        );
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
      const invalidQuotesAfter = findInvalidQuotes(answer, context);
      if (invalidQuotesAfter.length > 0) {
        console.log(`[chat] strip pass: removing ${invalidQuotesAfter.length} fake quote(s)`);
        // Strip any remaining fabricated quotes — sentence-level removal
        answer = answer.replace(/["\u201C]([^"\u201C\u201D]{10,400})["\u201D]/g, (match, q) => {
          const wc = q.trim().split(/\s+/).length;
          if (wc < 3) return match;
          if (normalize(context).includes(normalize(q))) return match;
          return ""; // fabricated — drop it
        });
        // Drop any sentence that became empty after quote removal
        answer = answer
          .split(/(?<=[.!?])\s+/)
          .filter((s) => s.replace(/\s+/g, " ").trim().length > 15)
          .join(" ");
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

    // HARD FAIL: after retry + strip + banned-phrase removal, if the answer
    // STILL has fake quotes, invalid sections, or fabricated durations, we
    // refuse to show it. The user gets an honest "I don't know" instead of
    // a confidently-wrong answer.
    let validationFailed = false;
    if (context) {
      const finalSections = findCitations(answer);
      const finalInvalidSections = finalSections.filter(
        (c) => !validNumbers.has(c)
      );
      const finalInvalidQuotes = findInvalidQuotes(answer, context);
      const finalInvalidDurations = findInvalidDurations(answer, context);
      if (
        finalInvalidSections.length > 0 ||
        finalInvalidQuotes.length > 0 ||
        finalInvalidDurations.length > 0
      ) {
        console.log(
          `[chat] HARD FAIL: invalidSections=[${finalInvalidSections.join(",")}] invalidQuotes=${finalInvalidQuotes.length} invalidDurations=${finalInvalidDurations.length}`
        );
        validationFailed = true;
      }
    }

    // Final safety: if validation/stripping wiped the answer, fall back to a
    // direct, non-cited response so the user never sees an empty bubble
    if (validationFailed || !answer.trim()) {
      answer =
        "I cannot give you a verified answer to this question from the legal documents in my database. The relevant provisions may not be in the chunks I retrieved, or the question may need to be more specific. Please try rephrasing your question, or ask about a more specific aspect of the issue (for example, naming the Act you're asking about).";
    }

    // Stream the validated answer out word-by-word with small delays so the
    // user sees it being written rather than pasted in all at once.
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        // Split on whitespace but keep the spaces so the output reads naturally
        const tokens = answer.match(/\S+\s*/g) || [answer];
        for (const token of tokens) {
          controller.enqueue(encoder.encode(token));
          // ~25ms per word feels like real typing without dragging the UX
          await new Promise((r) => setTimeout(r, 25));
        }
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Build": buildId,
        "X-Validation": validationFailed ? "hard-fail" : "passed",
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
