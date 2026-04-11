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
    let searchError: string | undefined;
    let relevantChunks = [] as Awaited<ReturnType<typeof searchDocuments>>;
    try {
      relevantChunks = await searchDocuments(query, 12);
    } catch (e) {
      searchError = e instanceof Error ? e.message : String(e);
    }
    const lastErr = (globalThis as { __lastSearchError?: string }).__lastSearchError;
    if (lastErr && !searchError) searchError = lastErr;

    // Extract CANONICAL section numbers AND their titles from a chunk.
    //
    // The chunks are PDF text with headings embedded inline like
    // "91. Notice on termination of contracts" — these are canonical.
    // Cross-references appear as "section 91" or "sections 128 to 134" —
    // those do NOT match the "NUMBER. Title" pattern.
    //
    // Rule: a number is canonical if it appears as `NUMBER. Title-Case-Word`
    // AND is not preceded by the word "section" or "sections".
    //
    // Returns an array of { num, title } pairs. The title is captured from
    // the first 80 chars following the number, trimmed at the next sentence
    // boundary or subsection marker. These titles are shown to the model so
    // it stops swapping adjacent section numbers.
    function extractSectionHeadings(
      text: string
    ): Array<{ num: string; title: string }> {
      const out: Array<{ num: string; title: string }> = [];
      const seen = new Set<string>();
      const headingRe = /\b(\d{1,3}[A-Za-z]?)\.\s+([A-Z][a-zA-Z][^\n]{1,120})/g;
      let m;
      while ((m = headingRe.exec(text)) !== null) {
        const lookback = text
          .slice(Math.max(0, m.index - 12), m.index)
          .toLowerCase();
        if (/sections?\s+$/.test(lookback)) continue;
        const num = m[1];
        if (seen.has(num)) continue;
        // Title ends at the first (1) subsection marker, period, or next number heading
        let title = m[2];
        title = title.split(/\s*\(\s*\d+\s*\)/)[0];
        title = title.split(/(?<=\w)\.\s+[A-Z]/)[0];
        title = title.split(/\s+\d{1,3}\.\s+[A-Z]/)[0];
        // Trim trailing TOC number pollution: "Implied covenants 14" → "Implied covenants"
        title = title.replace(/\s+\d{1,3}[A-Za-z]?\s*$/, "");
        title = title.trim().slice(0, 80);
        // Drop trailing partial words
        if (title.length === 80) {
          const lastSpace = title.lastIndexOf(" ");
          if (lastSpace > 40) title = title.slice(0, lastSpace);
        }
        seen.add(num);
        out.push({ num, title });
      }
      return out.slice(0, 15);
    }

    // Slice a chunk into { num, title, body } pieces by finding every
    // canonical "NUMBER. Title" heading and taking everything between
    // successive headings as that section's body. This is how we get
    // DISTINCT content for Section 14 vs Section 15 even when they live
    // in the same chunk.
    interface SectionSlice {
      num: string;
      title: string;
      body: string;
      start: number;
    }
    function sliceChunkByHeadings(chunk: string): SectionSlice[] {
      const headingRe = /\b(\d{1,3}[A-Za-z]?)\.\s+([A-Z][a-zA-Z][^\n]{1,120})/g;
      const slices: SectionSlice[] = [];
      let m;
      while ((m = headingRe.exec(chunk)) !== null) {
        const lookback = chunk
          .slice(Math.max(0, m.index - 12), m.index)
          .toLowerCase();
        if (/sections?\s+$/.test(lookback)) continue;
        let title = m[2];
        title = title.split(/\s*\(\s*\d+\s*\)/)[0];
        title = title.split(/(?<=\w)\.\s+[A-Z]/)[0];
        title = title.split(/\s+\d{1,3}\.\s+[A-Z]/)[0];
        title = title.replace(/\s+\d{1,3}[A-Za-z]?\s*$/, "");
        title = title.trim().slice(0, 80);
        slices.push({ num: m[1], title, body: "", start: m.index });
      }
      // Assign body = text between this heading and the next heading
      for (let i = 0; i < slices.length; i++) {
        const from = slices[i].start;
        const to = i + 1 < slices.length ? slices[i + 1].start : chunk.length;
        slices[i].body = chunk.slice(from, to);
      }
      // Drop TOC-style slices whose body is < 40 chars (just heading + next heading)
      return slices.filter((s) => s.body.length >= 40);
    }

    // Build the allowlist: for each Act, a map of section number → title.
    // Also build sectionContent: section number → the actual prose of
    // that section (sliced from the chunks, not the whole chunk) so that
    // grounding can distinguish adjacent sections.
    const allowlist = new Map<string, Map<string, string>>();
    const sectionContent = new Map<string, Map<string, string>>();
    let context = "";
    if (relevantChunks.length > 0) {
      context = relevantChunks
        .map((chunk, i) => {
          const slices = sliceChunkByHeadings(chunk.content);
          if (slices.length > 0) {
            if (!allowlist.has(chunk.document_name)) {
              allowlist.set(chunk.document_name, new Map());
            }
            if (!sectionContent.has(chunk.document_name)) {
              sectionContent.set(chunk.document_name, new Map());
            }
            const titleMap = allowlist.get(chunk.document_name)!;
            const contentMap = sectionContent.get(chunk.document_name)!;
            for (const sl of slices) {
              // Prefer the LONGEST body seen for this number — TOC slices
              // are tiny, real prose is longer. Title follows whichever
              // body wins.
              const priorBody = contentMap.get(sl.num) || "";
              if (sl.body.length > priorBody.length) {
                contentMap.set(sl.num, sl.body);
                titleMap.set(sl.num, sl.title);
              }
            }
          }
          const headings = extractSectionHeadings(chunk.content);
          const sectionLabel =
            headings.length > 0
              ? `Sections ${headings.map((h) => h.num).join(", ")}`
              : "";
          const label = sectionLabel
            ? `${chunk.document_name} | ${sectionLabel}`
            : `${chunk.document_name}`;
          return `[Source ${i + 1}: ${label}]\n${chunk.content}`;
        })
        .join("\n\n---\n\n");
    }

    // Render the allowlist with TITLES so the model can pick the right number.
    // Example: "  Rent Act 2014: 13 Implied covenants; 14 Notice of termination; 15 Powers of tribunal"
    // Seeing the titles side-by-side is the main mechanism that stops the
    // model from swapping adjacent section numbers.
    let allowlistBlock = "";
    if (allowlist.size > 0) {
      const lines: string[] = [];
      for (const [doc, titleMap] of allowlist.entries()) {
        const sorted = Array.from(titleMap.entries()).sort((a, b) => {
          const na = parseInt(a[0], 10);
          const nb = parseInt(b[0], 10);
          return na - nb;
        });
        const formatted = sorted
          .map(([n, t]) => `s.${n} ${t}`)
          .join("; ");
        lines.push(`  ${doc}: ${formatted}`);
      }
      allowlistBlock = `VALID SECTIONS with their titles — you may ONLY cite these numbers, and the claim attached to each cited number MUST match the section's title. Citing s.15 (Powers of tribunal) for a claim about notice periods is wrong — use s.14 (Notice of termination) instead. Read the titles carefully:\n${lines.join(
        "\n"
      )}\n\n`;
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
    for (const titleMap of allowlist.values()) {
      for (const n of titleMap.keys()) validNumbers.add(n);
    }

    // Flatten sectionContent: number → concatenated text. Used by the
    // grounding validator below.
    const flatSectionContent = new Map<string, string>();
    for (const contentMap of sectionContent.values()) {
      for (const [num, text] of contentMap.entries()) {
        const prior = flatSectionContent.get(num) || "";
        flatSectionContent.set(num, prior + " " + text);
      }
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

    // Find each citation AND the sentence it appears in so we can check
    // whether the content of that sentence matches the cited section's
    // actual text.
    function findCitationsWithContext(
      text: string
    ): Array<{ num: string; sentence: string }> {
      const out: Array<{ num: string; sentence: string }> = [];
      // Split on sentence boundaries — ., !, ? followed by space or newline
      const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
      const re = /\b(?:Section|Article|s\.|art\.)\s*(\d+[A-Za-z]?)/gi;
      for (const sentence of sentences) {
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(sentence)) !== null) {
          out.push({ num: m[1], sentence });
        }
      }
      return out;
    }

    // Stop words to strip from sentence content words before grounding check
    const GROUNDING_STOP = new Set([
      "the", "a", "an", "of", "to", "in", "on", "at", "by", "for", "with",
      "from", "into", "under", "over", "upon", "and", "or", "but", "is",
      "are", "was", "were", "be", "been", "being", "have", "has", "had",
      "shall", "may", "must", "can", "could", "should", "will", "would",
      "this", "that", "these", "those", "it", "its", "as", "if", "so",
      "not", "no", "any", "all", "such", "any", "some", "one", "two",
      "act", "section", "article", "states", "provides", "stated",
      "provision", "provisions", "law", "legal", "court", "person", "you",
      "your", "their", "his", "her", "he", "she", "they", "who", "which",
      "where", "when", "what", "than", "then", "other", "more", "also",
      "including", "include", "such", "out", "about", "according", "upon",
    ]);

    // Grounding check: for each citation, verify that at least 2 content
    // words from the surrounding sentence actually appear in the cited
    // section's chunk text. This catches "Section 15 says you have one
    // month notice" when Section 15 is actually about tribunal powers and
    // Section 14 is the one about notice.
    //
    // Returns the list of citations whose grounding failed. Each failure
    // is { num, sentence } so we can show the model exactly what to fix.
    function findUngroundedCitations(
      text: string
    ): Array<{ num: string; sentence: string }> {
      const failures: Array<{ num: string; sentence: string }> = [];
      const cites = findCitationsWithContext(text);
      for (const { num, sentence } of cites) {
        const sectionText = flatSectionContent.get(num);
        if (!sectionText) continue; // number not in our corpus — caught by other validators
        const sectionNorm = normalize(sectionText);
        // Extract content words from the sentence (excluding the citation itself)
        const sentenceClean = sentence
          .replace(/\b(?:Section|Article|s\.|art\.)\s*\d+[A-Za-z]?/gi, "")
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ");
        const words = sentenceClean
          .split(/\s+/)
          .filter(
            (w) => w.length >= 4 && !GROUNDING_STOP.has(w)
          );
        if (words.length < 3) continue; // too little content to judge
        // Count how many of the distinct content words appear in the section
        const distinct = Array.from(new Set(words));
        let hits = 0;
        for (const w of distinct) {
          if (sectionNorm.includes(w)) hits++;
        }
        // Require at least 2 content-word overlaps AND at least 25% of them
        const overlapRatio = hits / distinct.length;
        if (hits < 2 || overlapRatio < 0.25) {
          failures.push({ num, sentence: sentence.slice(0, 160) });
        }
      }
      return failures;
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

    const buildId = "v13-imatch";
    console.log(`[chat] build=${buildId} query="${query.slice(0, 60)}" allowlist=${validNumbers.size} chunks=${relevantChunks.length}`);

    // DIAG: how many quotes does the regex extract from any text?
    function countQuotes(text: string): number {
      const re = /["\u201C]([^"\u201C\u201D]{10,400})["\u201D]/g;
      let n = 0;
      while (re.exec(text) !== null) n++;
      return n;
    }

    let answer = await generate(systemPrompt);

    // VALIDATION PASS 1: sections, quotes, durations, AND grounding
    if (context) {
      const citedSections = findCitations(answer);
      const invalidSections = Array.from(
        new Set(citedSections.filter((c) => !validNumbers.has(c)))
      );
      const invalidQuotes = findInvalidQuotes(answer, context);
      const invalidDurations = findInvalidDurations(answer, context);
      const ungrounded = findUngroundedCitations(answer);

      console.log(
        `[chat] pass1 cited=[${citedSections.join(",")}] invalidSections=[${invalidSections.join(",")}] invalidQuotes=${invalidQuotes.length} invalidDurations=${invalidDurations.length} ungrounded=${ungrounded.length}`
      );

      if (
        invalidSections.length > 0 ||
        invalidQuotes.length > 0 ||
        invalidDurations.length > 0 ||
        ungrounded.length > 0
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
        if (ungrounded.length > 0) {
          const lines = ungrounded
            .slice(0, 6)
            .map(
              (u) =>
                `  - You cited Section ${u.num} for: "${u.sentence.slice(
                  0,
                  140
                )}" — but Section ${u.num}'s actual text does not mention those concepts. You likely confused it with an adjacent section. Find the section number whose TITLE matches the substance of your claim and use that instead.`
            )
            .join("\n");
          problems.push(
            `SECTION-CONTENT MISMATCH — you cited a real section but attached the wrong claim to it:\n${lines}`
          );
        }
        console.log(`[chat] retry triggered: ${problems.length} problem(s)`);
        const correction = `${systemPrompt}\n\nYOUR PREVIOUS ATTEMPT CONTAINED HALLUCINATIONS:\n${problems.join(
          "\n"
        )}\n\nRegenerate the answer. STRICT RULES:\n- Cite ONLY section numbers from the VALID SECTIONS list above.\n- Each section has a TITLE — the claim you attach to a section number must match that section's title. Do not swap adjacent numbers.\n- Any text inside quotation marks MUST be a verbatim, character-for-character copy of text from the legal excerpts above. Do not paraphrase inside quotes. If you can't find the exact wording, do not use quotation marks at all — explain in your own words instead.\n- Quote durations, fines, and ages ONLY if they appear LITERALLY in the legal excerpts. Do not invent tiers or simplify multi-clause provisions.\n- If a provision has subsections (a), (b), (c), reproduce them all literally. Do not collapse them.\n- If the excerpts do not contain a specific number you would need, do not write any number — explain qualitatively and stop there.\n- Do not write phrases like "consult a lawyer", "review your contract", "seek legal advice", or any disclaimer.`;
        answer = await generate(correction);

        const citedAfter = findCitations(answer);
        const invalidQuotesRetry = findInvalidQuotes(answer, context);
        const invalidDurationsRetry = findInvalidDurations(answer, context);
        const ungroundedRetry = findUngroundedCitations(answer);
        console.log(
          `[chat] retry result cited=[${citedAfter.join(",")}] invalidQuotes=${invalidQuotesRetry.length} invalidDurations=${invalidDurationsRetry.length} ungrounded=${ungroundedRetry.length}`
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

      // GROUNDING STRIP: any citation whose sentence content doesn't
      // match the cited section's actual text gets the citation replaced
      // with "the relevant provision". The claim survives but the wrong
      // section number is removed — the user sees accurate substance
      // instead of a confidently-wrong section pointer.
      const ungroundedAfter = findUngroundedCitations(answer);
      if (ungroundedAfter.length > 0) {
        console.log(
          `[chat] grounding strip: ${ungroundedAfter.length} ungrounded citation(s): ${ungroundedAfter
            .map((u) => `s.${u.num}`)
            .join(", ")}`
        );
        // Strip only the first occurrence of each ungrounded number in
        // its surrounding sentence, so we don't accidentally touch a
        // correct later reuse of the same number.
        for (const u of ungroundedAfter) {
          const stripRe = new RegExp(
            `\\b(?:Section|Article|s\\.|art\\.)\\s*${u.num}\\b(?:\\s+of\\s+(?:the\\s+)?[A-Z][A-Za-z ()0-9]{2,60}Act[^.]*?)?`,
            "i"
          );
          answer = answer.replace(stripRe, "the relevant provision");
        }
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

    // DIAG: final counts so we can SEE in headers what the validator is doing
    const finalQuoteCount = countQuotes(answer);
    const finalCitationCount = findCitations(answer).length;
    const finalInvalidQuoteCount = context ? findInvalidQuotes(answer, context).length : 0;
    const finalInvalidSectionCount = context
      ? findCitations(answer).filter((c) => !validNumbers.has(c)).length
      : 0;
    const finalUngroundedCount = context ? findUngroundedCitations(answer).length : 0;

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Build": buildId,
        "X-Validation": validationFailed ? "hard-fail" : "passed",
        "X-Quotes-Total": String(finalQuoteCount),
        "X-Quotes-Invalid": String(finalInvalidQuoteCount),
        "X-Cites-Total": String(finalCitationCount),
        "X-Cites-Invalid": String(finalInvalidSectionCount),
        "X-Cites-Ungrounded": String(finalUngroundedCount),
        "X-Allowlist-Size": String(validNumbers.size),
        "X-Chunks": String(relevantChunks.length),
        "X-Context-Len": String(context.length),
        "X-Search-Error": (searchError || "none").slice(0, 200),
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
