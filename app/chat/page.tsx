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
          <span className="text-sm font-semibold tracking-tight">
            Gamba Legal Aid
          </span>
          <div />
        </div>
      </header>

      {/* Chat */}
      <main className="flex-1 min-h-0 max-w-3xl mx-auto w-full">
        <ChatInterface />
      </main>
    </div>
  );
}
