import Link from "next/link";

const LEGAL_AREAS = [
  {
    title: "Constitutional Rights",
    description:
      "Fundamental rights and freedoms guaranteed to every Gambian citizen",
    icon: "M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21",
  },
  {
    title: "Labour Rights",
    description:
      "Employment protections, unfair dismissal, wages, and workplace safety",
    icon: "M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0",
  },
  {
    title: "Criminal Law",
    description:
      "Understanding criminal charges, your rights during arrest and trial",
    icon: "M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.249-8.25-3.286zm0 13.036h.008v.008H12v-.008z",
  },
  {
    title: "Family Law",
    description:
      "Marriage, divorce, child custody, inheritance, and domestic violence",
    icon: "M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z",
  },
  {
    title: "Consumer Protection",
    description: "Your rights as a consumer against unfair business practices",
    icon: "M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.249-8.25-3.286z",
  },
  {
    title: "Land and Property",
    description:
      "Land ownership, acquisition, compensation, and property disputes",
    icon: "M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z",
  },
];

const DOCUMENTS = [
  "Constitution of The Gambia (1997)",
  "Labour Act 2023",
  "Criminal Code 1933",
  "Criminal Offences Act 2025",
  "Criminal Procedure Act 2025",
  "Children's Act 2005",
  "Consumer Protection Act 2014",
  "Land Acquisition Act",
];

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent-green/15 border border-accent-green/25 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-accent-green"
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
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                Gamba Legal Aid
              </h1>
              <p className="text-[11px] font-mono text-text-muted uppercase tracking-wider">
                Free legal assistance for Gambian citizens
              </p>
            </div>
          </div>
          <Link
            href="/chat"
            className="px-5 py-2 bg-accent-green text-background text-sm font-medium rounded-lg hover:bg-accent-green/90 transition-colors"
          >
            Ask a Question
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full bg-accent-green/10 border border-accent-green/20">
            <span className="w-2 h-2 rounded-full bg-accent-green pulse-dot" />
            <span className="text-xs font-mono text-accent-green uppercase tracking-wider">
              Powered by AI
            </span>
          </div>
          <h2 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight mb-6">
            Know your rights
            <br />
            <span className="text-accent-green">under Gambian law</span>
          </h2>
          <p className="text-lg text-text-secondary max-w-xl mx-auto mb-10 leading-relaxed">
            Free, instant legal information for every Gambian citizen. Ask
            questions in plain English and get answers grounded in actual
            Gambian legislation.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/chat"
              className="w-full sm:w-auto px-8 py-3 bg-accent-green text-background font-medium rounded-xl hover:bg-accent-green/90 transition-all hover:shadow-[0_0_30px_rgba(34,197,94,0.15)]"
            >
              Start asking questions
            </Link>
            <a
              href="#areas"
              className="w-full sm:w-auto px-8 py-3 bg-surface border border-border text-text-secondary font-medium rounded-xl hover:text-text-primary hover:border-accent-green/20 transition-all"
            >
              Browse legal areas
            </a>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-16 px-6 border-t border-border">
        <div className="max-w-4xl mx-auto">
          <h3 className="text-center font-mono text-xs tracking-[0.2em] uppercase text-accent-green mb-12">
            How it works
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                title: "Ask your question",
                desc: "Type your legal question in plain English. No legal jargon needed.",
              },
              {
                step: "02",
                title: "We search the law",
                desc: "Our system searches through Gambian legislation to find the relevant provisions.",
              },
              {
                step: "03",
                title: "Get clear answers",
                desc: "Receive an easy-to-understand explanation with references to the actual law.",
              },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="text-3xl font-mono text-accent-green/30 mb-3">
                  {item.step}
                </div>
                <h4 className="text-base font-semibold mb-2">{item.title}</h4>
                <p className="text-sm text-text-secondary">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Legal areas */}
      <section id="areas" className="py-16 px-6 border-t border-border">
        <div className="max-w-4xl mx-auto">
          <h3 className="text-center font-mono text-xs tracking-[0.2em] uppercase text-accent-green mb-4">
            Legal areas covered
          </h3>
          <p className="text-center text-sm text-text-secondary mb-12">
            Grounded in 8 Gambian Acts and legal documents
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {LEGAL_AREAS.map((area) => (
              <Link
                key={area.title}
                href="/chat"
                className="group p-5 bg-surface border border-border rounded-xl hover:border-accent-green/20 hover:bg-surface-elevated transition-all"
              >
                <svg
                  className="w-6 h-6 text-accent-green/60 group-hover:text-accent-green mb-3 transition-colors"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d={area.icon}
                  />
                </svg>
                <h4 className="text-sm font-semibold mb-1">{area.title}</h4>
                <p className="text-xs text-text-secondary leading-relaxed">
                  {area.description}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Source documents */}
      <section className="py-16 px-6 border-t border-border">
        <div className="max-w-4xl mx-auto text-center">
          <h3 className="font-mono text-xs tracking-[0.2em] uppercase text-accent-green mb-4">
            Powered by real legislation
          </h3>
          <p className="text-sm text-text-secondary mb-8">
            Our AI is grounded in official Gambian legal documents
          </p>
          <div className="flex flex-wrap justify-center gap-3 mb-6">
            {DOCUMENTS.map((doc) => (
              <span
                key={doc}
                className="px-3 py-1.5 bg-accent-green/5 border border-accent-green/20 rounded-lg text-xs font-mono text-accent-green/80"
              >
                {doc}
              </span>
            ))}
          </div>
          <p className="text-xs text-text-muted mb-3">Coming soon</p>
          <div className="flex flex-wrap justify-center gap-3">
            {["Women's Act 2010", "Domestic Violence Act 2013", "Rent Act 2014", "Immigration Act"].map((doc) => (
              <span
                key={doc}
                className="px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-mono text-text-muted"
              >
                {doc}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-3xl mx-auto text-center">
          <h3 className="text-2xl font-bold mb-4">
            Everyone deserves to know their rights
          </h3>
          <p className="text-text-secondary mb-8">
            Legal information should not be a privilege. Ask your question now.
          </p>
          <Link
            href="/chat"
            className="inline-block px-8 py-3 bg-accent-green text-background font-medium rounded-xl hover:bg-accent-green/90 transition-all hover:shadow-[0_0_30px_rgba(34,197,94,0.15)]"
          >
            Start asking questions
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6 mt-auto">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-text-muted font-mono">
            Gamba Legal Aid. General legal information, not legal advice.
          </p>
          <p className="text-xs text-text-muted">Built by Abdoulie Balisa</p>
        </div>
      </footer>
    </div>
  );
}
