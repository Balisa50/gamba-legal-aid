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

    let context = "";
    if (relevantChunks.length > 0) {
      context = relevantChunks
        .map((chunk, i) => {
          const sections = extractSectionNumbers(chunk.content);
          const label = sections
            ? `${chunk.document_name} | ${sections}`
            : `${chunk.document_name}`;
          return `[Source ${i + 1}: ${label}]\n${chunk.content}`;
        })
        .join("\n\n---\n\n");
    }

    const systemPrompt = `${LEGAL_SYSTEM_PROMPT}

${
  context
    ? `LEGAL DOCUMENT EXCERPTS — these are the ONLY sources you may cite. Each source is labeled with the Act name and the Section numbers it contains. When citing a section in your answer, the section number MUST appear in one of these source labels. Quote concrete numbers and durations literally from the excerpts.\n\n${context}`
    : "No specific legal documents were found for this query. Tell the user you do not have a provision in your database that covers this specific issue."
}`;

    // Stream response
    const stream = await getGroq().chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 2048,
      // Low temperature minimizes hallucination of section numbers and values
      temperature: 0.2,
      top_p: 0.9,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.slice(-8).map((m: { role: string; content: string }) => {
          // For user messages, run them through the sanitizer too so injection
          // attempts in earlier turns can't slip through
          const content =
            m.role === "user"
              ? sanitizeUserInput(m.content).cleaned || m.content.slice(0, 1000)
              : m.content.slice(0, 1000);
          return {
            role: m.role as "user" | "assistant",
            content,
          };
        }),
      ],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content;
            if (text) {
              controller.enqueue(encoder.encode(text));
            }
          }
        } catch {
          controller.enqueue(
            encoder.encode(
              "\n\nThe service is temporarily unavailable. Please try again."
            )
          );
        } finally {
          controller.close();
        }
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
