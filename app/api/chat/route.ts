import { NextRequest } from "next/server";
import { getGroq, LEGAL_SYSTEM_PROMPT } from "../../lib/groq";
import { searchDocuments } from "../../lib/embeddings";

// Rate limit: 10 requests per minute per IP
const rateMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count++;
  return entry.count > 10;
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  if (isRateLimited(ip)) {
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
    const query = lastUserMsg?.content ?? "";

    // Search legal documents for relevant context
    const relevantChunks = await searchDocuments(query, 8);

    let context = "";
    if (relevantChunks.length > 0) {
      context = relevantChunks
        .map(
          (chunk) =>
            `[${chunk.document_name} - ${chunk.section_title}]\n${chunk.content}`
        )
        .join("\n\n---\n\n");
    }

    const systemPrompt = `${LEGAL_SYSTEM_PROMPT}

${
  context
    ? `RELEVANT LEGAL DOCUMENT EXCERPTS:\n\n${context}`
    : "No specific legal documents were found for this query. Answer based on your general knowledge of Gambian law, but clearly state that you could not find the specific legal provision and recommend the user verify with a legal professional."
}`;

    // Stream response
    const stream = await getGroq().chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 1024,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.slice(-8).map((m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant",
          content: m.content.slice(0, 1000),
        })),
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
