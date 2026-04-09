"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTED_QUESTIONS = [
  "What are my rights if my landlord wants to evict me?",
  "What does Gambian labour law say about unfair dismissal?",
  "What are a child's rights under the Children's Act?",
  "What protections exist for women against domestic violence?",
  "What are my rights if I am arrested?",
  "How does the Consumer Protection Act protect me?",
];

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
      {/* Messages area */}
      <div className={`flex-1 px-4 py-6 space-y-6 overflow-y-auto hide-scrollbar ${messages.length === 0 ? "flex items-center justify-center" : ""}`}>
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
              {SUGGESTED_QUESTIONS.map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q)}
                  className="text-left px-4 py-3 rounded-xl bg-surface border border-border text-sm text-text-secondary hover:text-text-primary hover:border-accent-green/30 hover:bg-surface-elevated transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
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
          <div className="flex items-center justify-center gap-3 mt-2">
            {messages.length > 0 && (
              <button
                onClick={() => { setMessages([]); localStorage.removeItem("gla-messages"); }}
                className="text-[11px] text-text-muted hover:text-accent-green font-mono transition-colors"
              >
                New chat
              </button>
            )}
            <p className="text-[11px] text-text-muted font-mono">
              Grounded in 8 Gambian Acts of Parliament
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
