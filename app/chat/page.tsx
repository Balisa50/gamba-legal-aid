import Link from "next/link";
import ChatInterface from "../components/ChatInterface";

export const metadata = {
  title: "Chat - Gamba Legal Aid",
  description: "Ask questions about your rights under Gambian law",
};

export default function ChatPage() {
  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-border px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center justify-center w-7 h-7 rounded-lg bg-surface border border-border hover:border-accent-green/30 transition-colors">
              <svg className="w-3.5 h-3.5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <span className="text-sm font-semibold tracking-tight">
              Gamba Legal Aid
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent-green pulse-dot" />
            <span className="text-[11px] font-mono text-accent-green">Online</span>
          </div>
        </div>
      </header>

      {/* Chat */}
      <main className="flex-1 overflow-hidden max-w-3xl mx-auto w-full">
        <ChatInterface />
      </main>
    </div>
  );
}
