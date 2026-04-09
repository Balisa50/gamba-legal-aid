import Link from "next/link";

const STATS = [
  { value: "1,713", label: "Legal provisions indexed" },
  { value: "8", label: "Acts of Parliament" },
  { value: "24/7", label: "Always available" },
];

const COVERAGE = [
  {
    title: "Constitutional Rights",
    detail: "Fundamental freedoms, citizenship, due process",
  },
  {
    title: "Criminal Law",
    detail: "Offences, penalties, arrest rights, bail, trial procedure",
  },
  {
    title: "Labour",
    detail: "Employment contracts, dismissal, wages, workplace safety",
  },
  {
    title: "Children's Rights",
    detail: "Child welfare, custody, juvenile justice, guardianship",
  },
  {
    title: "Consumer Protection",
    detail: "Product safety, unfair practices, refunds, warranties",
  },
  {
    title: "Land and Property",
    detail: "Acquisition, compensation, ownership, title disputes",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="border-b border-border px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-accent-green/15 border border-accent-green/25 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-accent-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
            </div>
            <span className="text-sm font-semibold tracking-tight">Gamba Legal Aid</span>
          </div>
          {/* nav right side intentionally empty */}
          <div />
        </div>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex items-center justify-center px-6 py-20">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.1] mb-5">
            Know your rights
            <br />
            <span className="text-accent-green">under Gambian law.</span>
          </h1>
          <p className="text-text-secondary text-lg mb-10 max-w-md mx-auto">
            Ask a question. Get an answer grounded in real legislation.
          </p>
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 px-8 py-3.5 bg-accent-green text-background font-medium rounded-xl hover:bg-accent-green/90 transition-all hover:shadow-[0_0_40px_rgba(34,197,94,0.12)] text-base"
          >
            Ask a legal question
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>

          {/* Stats */}
          <div className="mt-14 grid grid-cols-3 gap-6">
            {STATS.map((s) => (
              <div key={s.label}>
                <div className="text-2xl font-bold text-accent-green font-mono">{s.value}</div>
                <div className="text-xs text-text-muted mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Coverage — clean grid, no icons, no links to chat */}
      <section className="border-t border-border py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="font-mono text-xs tracking-[0.2em] uppercase text-text-muted text-center mb-10">
            Coverage
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {COVERAGE.map((area) => (
              <div
                key={area.title}
                className="p-4 bg-surface border border-border rounded-xl"
              >
                <h3 className="text-sm font-semibold mb-1">{area.title}</h3>
                <p className="text-xs text-text-secondary leading-relaxed">{area.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Source legislation */}
      <section className="border-t border-border py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="font-mono text-xs tracking-[0.2em] uppercase text-text-muted text-center mb-8">
            Source Legislation
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto">
            {[
              { name: "Constitution of The Gambia", year: "1997", chunks: 267 },
              { name: "Criminal Code", year: "1933", chunks: 321 },
              { name: "Criminal Offences Act", year: "2025", chunks: 266 },
              { name: "Criminal Procedure Act", year: "2025", chunks: 393 },
              { name: "Labour Act", year: "2023", chunks: 183 },
              { name: "Children's Act", year: "2005", chunks: 206 },
              { name: "Consumer Protection Act", year: "2014", chunks: 45 },
              { name: "Land Acquisition Act", year: "-", chunks: 31 },
            ].map((doc) => (
              <div key={doc.name} className="flex items-center justify-between px-4 py-3 bg-surface border border-border rounded-lg">
                <div>
                  <span className="text-sm text-text-primary">{doc.name}</span>
                  <span className="text-xs text-text-muted ml-2">{doc.year}</span>
                </div>
                <span className="text-[11px] font-mono text-accent-green/60">{doc.chunks} sections</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer — minimal */}
      <footer className="border-t border-border py-6 px-6 mt-auto">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <span className="text-xs text-text-muted font-mono">Gamba Legal Aid</span>
          <span className="text-xs text-text-muted">Abdoulie Balisa</span>
        </div>
      </footer>
    </div>
  );
}
