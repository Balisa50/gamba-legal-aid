"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const QUESTION_POOL = [
  "What are my rights if my landlord wants to evict me?",
  "How much notice must a landlord give before increasing rent?",
  "What does Gambian labour law say about unfair dismissal?",
  "What are a child's rights under the Children's Act?",
  "How do I get a protection order against a violent partner?",
  "What does the Domestic Violence Act define as abuse?",
  "What are my rights if I am arrested?",
  "How does the Consumer Protection Act protect me?",
  "Can I be detained without charge in The Gambia?",
  "What is the legal age of marriage in The Gambia?",
  "What are my rights as a tenant under the Rent Act?",
  "What is the punishment for assault in The Gambia?",
  "Who is a prohibited immigrant under the Immigration Act?",
  "What does Gambian law say about deportation?",
  "How does Gambian law protect freedom of expression?",
  "What are an employee's rights to maternity leave?",
  "What does the Constitution say about the right to life?",
  "Can the police search my home without a warrant?",
  "What are my rights if my employer fires me without notice?",
  "How does Gambian law treat self-defence?",
  "What protections exist against workplace discrimination?",
  "What is the law on child labour in The Gambia?",
  "What is the legal procedure for arrest in The Gambia?",
  "What remedies exist for a tenant whose landlord refuses to make repairs?",
];

function pickQuestions(count: number): string[] {
  const shuffled = [...QUESTION_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("gla-messages");
      if (saved) try { return JSON.parse(saved); } catch { /* ignore */ }
    }
    return [];
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  // Use a deterministic placeholder during SSR, then shuffle on client mount
  // to avoid hydration mismatch between server and client renders.
  const [suggestions, setSuggestions] = useState<string[]>(() =>
    QUESTION_POOL.slice(0, 6)
  );
  useEffect(() => {
    setSuggestions(pickQuestions(6));
  }, []);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Persist messages to localStorage
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem("gla-messages", JSON.stringify(messages));
    }
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!loading) inputRef.current?.focus();
  }, [loading]);

  async function sendMessage(text?: string) {
    const content = (text || input).trim();
    if (!content || loading) return;

    const userMsg: Message = { role: "user", content };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!res.ok) {
        if (res.status === 429) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                "You are sending messages too quickly. Please wait a moment and try again.",
            },
          ]);
          return;
        }
        if (res.status === 400) {
          // Try to surface the server's specific message (e.g. injection blocked)
          let msg = "I can only answer legal questions about Gambian law. Please rephrase your question.";
          try {
            const data = await res.json();
            if (data?.error) msg = data.error;
          } catch { /* ignore */ }
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: msg },
          ]);
          return;
        }
        throw new Error("Request failed");
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          assistantText += decoder.decode(value, { stream: true });
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              role: "assistant",
              content: assistantText,
            };
            return updated;
          });
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "The legal assistant is temporarily unavailable. Please try again shortly.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Sticky toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 pt-4 pb-2">
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-accent-green transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </Link>
        {messages.length > 0 && (
          <button
            onClick={() => setConfirmWipe(true)}
            className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-red-400 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
            </svg>
            Wipe chat
          </button>
        )}
      </div>

      {/* Confirm wipe modal */}
      {confirmWipe && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm px-4"
          onClick={() => setConfirmWipe(false)}
        >
          <div
            className="bg-surface border border-border rounded-2xl p-6 max-w-sm w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-text-primary mb-2">Wipe this chat?</h3>
            <p className="text-sm text-text-secondary mb-5">
              This will permanently delete the entire conversation. You cannot undo this.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmWipe(false)}
                className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setMessages([]);
                  localStorage.removeItem("gla-messages");
                  setConfirmWipe(false);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500/90 hover:bg-red-500 rounded-lg transition-colors"
              >
                Wipe chat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Messages area */}
      <div className={`flex-1 min-h-0 px-4 pb-6 pt-2 space-y-6 overflow-y-auto hide-scrollbar ${messages.length === 0 ? "flex flex-col items-center justify-center" : ""}`}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center text-center px-4">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-text-primary mb-1.5">
                How can I help you today?
              </h2>
              <p className="text-sm text-text-secondary max-w-sm">
                Ask about your rights under Gambian law.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
              {suggestions.map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="text-left px-4 py-3 rounded-xl bg-surface border border-border text-sm text-text-secondary hover:text-text-primary hover:border-accent-green/30 hover:bg-surface-elevated transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
            <button
              onClick={() => setSuggestions(pickQuestions(6))}
              className="mt-3 inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-accent-green transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Show different questions
            </button>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-accent-green/15 border border-accent-green/20 text-text-primary"
                    : "bg-surface border border-border text-text-primary"
                }`}
              >
                {msg.role === "assistant" && (
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-5 h-5 rounded-md bg-accent-green/20 flex items-center justify-center">
                      <svg
                        className="w-3 h-3 text-accent-green"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
                        />
                      </svg>
                    </div>
                    <span className="text-[11px] font-mono text-accent-green uppercase tracking-wider">
                      Legal Aid
                    </span>
                  </div>
                )}
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </p>
              </div>
            </div>
          ))
        )}

        {loading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex justify-start">
            <div className="bg-surface border border-border rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-5 h-5 rounded-md bg-accent-green/20 flex items-center justify-center">
                  <svg
                    className="w-3 h-3 text-accent-green"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
                    />
                  </svg>
                </div>
                <span className="text-[11px] font-mono text-accent-green uppercase tracking-wider">
                  Legal Aid
                </span>
              </div>
              <div className="flex gap-1.5">
                <span className="typing-dot w-2 h-2 rounded-full bg-accent-green/60" />
                <span className="typing-dot w-2 h-2 rounded-full bg-accent-green/60" />
                <span className="typing-dot w-2 h-2 rounded-full bg-accent-green/60" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-border bg-surface/50 backdrop-blur-sm px-4 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-3 bg-surface border border-border rounded-2xl px-4 py-3 focus-within:border-accent-green/30 transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your legal rights..."
              disabled={loading}
              rows={1}
              className="flex-1 bg-transparent text-text-primary placeholder-text-muted text-sm outline-none resize-none max-h-32 disabled:opacity-50"
              style={{ minHeight: "24px" }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              className="flex-shrink-0 w-8 h-8 rounded-lg bg-accent-green flex items-center justify-center hover:bg-accent-green/90 transition-colors disabled:opacity-30 disabled:hover:bg-accent-green"
            >
              <svg
                className="w-4 h-4 text-background"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 12h14M12 5l7 7-7 7"
                />
              </svg>
            </button>
          </div>
          <p className="text-[11px] text-text-muted text-center mt-2 font-mono">
            Grounded in 13 Gambian Acts of Parliament. Verify critical decisions against the source text.
          </p>
        </div>
      </div>
    </div>
  );
}
