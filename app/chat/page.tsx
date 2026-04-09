import Link from "next/link";
import ChatInterface from "../components/ChatInterface";

export const metadata = {
  title: "Chat - Gamba Legal Aid",
  description: "Ask questions about your rights under Gambian law",
};

export default function ChatPage() {
  return (
    <div className="h-dvh flex flex-col bg-background">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-border px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
            <div className="w-7 h-7 rounded-md bg-accent-green/15 border border-accent-green/25 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-accent-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
            </div>
            <span className="text-sm font-semibold tracking-tight">
              Gamba Legal Aid
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent-green pulse-dot" />
            <span className="text-[11px] font-mono text-accent-green">Online</span>
          </div>
        </div>
      </header>

      {/* Chat */}
      <main className="flex-1 min-h-0 max-w-3xl mx-auto w-full">
        <ChatInterface />
      </main>
    </div>
  );
}
