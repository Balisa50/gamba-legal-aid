import { getSupabase } from "./supabase";

export interface DocumentChunk {
  id?: string;
  document_name: string;
  section_title: string;
  content: string;
  chunk_index: number;
  metadata?: Record<string, string>;
}

// Stop words to filter out
const STOP_WORDS = new Set([
  "the", "what", "are", "my", "if", "is", "can", "how", "does", "do",
  "was", "were", "been", "being", "have", "has", "had", "will", "would",
  "could", "should", "may", "might", "shall", "that", "this", "with",
  "from", "for", "and", "but", "not", "you", "your", "they", "them",
  "their", "its", "about", "want", "wants", "get", "got", "say", "says",
  "when", "where", "who", "why", "which", "there", "here", "some", "any",
  "all", "each", "every", "both", "few", "more", "most", "other", "than",
  "too", "very", "just", "also", "only", "own", "same", "into", "over",
  "such", "then", "these", "those", "through", "under", "between",
  "doing", "having", "tell", "told", "know", "think", "make",
  "someone", "something", "nothing", "anything", "please", "help",
  "need", "like", "really", "much", "many", "going", "come",
]);

// Common legal vocabulary that appears in nearly every chunk and is too
// generic to anchor a search on. We keep them for ranking but never let
// them dominate scoring.
const LOW_SIGNAL = new Set([
  "rights", "right", "law", "act", "section", "person", "may", "must",
  "shall", "court", "person", "people", "gambia", "gambian",
]);

// Simple stemming: strip common English suffixes to get root word
function stem(word: string): string {
  return word
    .replace(/ing$/, "")
    .replace(/tion$/, "t")
    .replace(/sion$/, "s")
    .replace(/ment$/, "")
    .replace(/ness$/, "")
    .replace(/able$/, "")
    .replace(/ible$/, "")
    .replace(/ated$/, "ate")
    .replace(/ised$/, "ise")
    .replace(/ized$/, "ize")
    .replace(/ful$/, "")
    .replace(/less$/, "")
    .replace(/ous$/, "")
    .replace(/ive$/, "")
    .replace(/ly$/, "")
    .replace(/ed$/, "")
    .replace(/er$/, "")
    .replace(/es$/, "")
    .replace(/s$/, "")
    || word;
}

// Detect when the query is about a specific topic and add anchor terms to
// pull in chunks that may not contain the user's literal words but DO
// contain the substantive provisions (with concrete numbers).
const TOPIC_ANCHORS: Array<{ patterns: RegExp[]; anchors: string[] }> = [
  {
    // Unfair dismissal — Sections 130, 132, 139, 140 of the Labour Act 2023
    patterns: [/unfair/i, /wrongful/i, /tribunal/i, /reinstate/i, /complaint/i],
    anchors: ["unfair", "tribunal", "complaint", "reinstatement", "remedies", "valid reason"],
  },
  {
    patterns: [/fir(e|ing|ed)/i, /dismiss/i, /sack/i, /terminat/i, /lay\s*off/i, /redundanc/i],
    anchors: ["notice", "weeks", "months", "days", "termination", "redundancy", "severance", "unfair", "tribunal"],
  },
  {
    // Arrest rights are in Constitution s.19 (right to liberty) — language uses
    // "arrested or detained", "informed", "legal practitioner", "seventy-two hours"
    patterns: [/arrest/i, /detain/i, /custody/i, /police/i, /handcuff/i, /interrogat/i],
    anchors: [
      "arrested",
      "detained",
      "informed",
      "legal practitioner",
      "seventy-two",
      "three hours",
      "liberty",
      "bail",
      "magistrate",
      "charge",
    ],
  },
  {
    // Rent Act 2014 + Amendments 2017/2024 — eviction, notice, tribunal
    patterns: [/landlord/i, /evict/i, /tenant/i, /rent/i, /lease/i, /premises/i],
    anchors: [
      "notice",
      "rent",
      "premises",
      "lease",
      "tenant",
      "landlord",
      "tribunal",
      "recovery",
      "possession",
      "quit",
      "months",
      "dalasi",
    ],
  },
  {
    patterns: [/divorce/i, /marriage/i, /spouse/i, /husband/i, /wife/i],
    anchors: ["dissolution", "maintenance", "custody", "marriage"],
  },
  {
    // Domestic Violence Act 2013 — protection orders, shelters, police duty
    patterns: [/domestic/i, /abuse/i, /violence/i, /batter/i, /beat/i],
    anchors: [
      "protection order",
      "protection",
      "complainant",
      "respondent",
      "shelter",
      "police officer",
      "emotional",
      "economic abuse",
      "intimidation",
      "harassment",
      "household",
      "relationship",
    ],
  },
  {
    patterns: [/assault/i, /attack/i, /injur/i, /wound/i, /hurt/i],
    anchors: ["grievous", "harm", "force", "wound", "hurt", "bodily"],
  },
  {
    // Immigration Act — visas, residence, deportation, border
    patterns: [/immigrat/i, /visa/i, /passport/i, /deport/i, /citizen/i, /border/i, /foreigner/i, /refugee/i, /asylum/i],
    anchors: [
      "entry",
      "permit",
      "residence",
      "prohibited immigrant",
      "deportation",
      "passport",
      "immigration officer",
      "visa",
      "port of entry",
      "removal",
      "citizen",
    ],
  },
  {
    // Women's rights — fall back on Constitution + Domestic Violence Act
    patterns: [/woman/i, /women/i, /gender/i, /sex(ual)? harassment/i, /rape/i],
    anchors: [
      "equality",
      "discrimination",
      "woman",
      "women",
      "protection",
      "sexual",
      "consent",
      "maternity",
    ],
  },
  {
    patterns: [/child/i, /minor/i, /juvenile/i],
    anchors: ["welfare", "guardian", "parent", "custody", "education"],
  },
];

export async function searchDocuments(
  query: string,
  limit = 8
): Promise<DocumentChunk[]> {
  const supabase = getSupabase();

  // Extract meaningful search terms
  const rawTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  if (rawTerms.length === 0) return [];

  // Generate search variants: original + stemmed
  const searchSet = new Set<string>();
  for (const term of rawTerms) {
    searchSet.add(term);
    const stemmed = stem(term);
    if (stemmed.length >= 3) searchSet.add(stemmed);
  }
  const searchTerms = Array.from(searchSet).slice(0, 12);

  // Identify the high-signal terms (specific words that should drive ranking)
  const highSignalRaw = rawTerms.filter((t) => !LOW_SIGNAL.has(t));
  const highSignalSet = new Set<string>();
  for (const t of highSignalRaw) {
    highSignalSet.add(t);
    const s = stem(t);
    if (s.length >= 3) highSignalSet.add(s);
  }

  // Add topic anchors so we pull substantive provisions even when the
  // user phrases their question in informal language
  const anchorSet = new Set<string>();
  for (const topic of TOPIC_ANCHORS) {
    if (topic.patterns.some((p) => p.test(query))) {
      for (const a of topic.anchors) anchorSet.add(a);
    }
  }
  // Anchors join the search pool but only count for ranking, not filtering
  for (const a of anchorSet) searchSet.add(a);
  const finalSearchTerms = Array.from(searchSet).slice(0, 20);

  // Run multiple ILIKE searches in parallel for speed
  // Search both content and section_title
  const orConditions = finalSearchTerms
    .map((term) => `content.ilike.%${term}%,section_title.ilike.%${term}%`)
    .join(",");

  const { data, error } = await supabase
    .from("legal_chunks")
    .select("*")
    .or(orConditions)
    .limit(400);

  if (error || !data) return [];

  // Rank results by relevance with TF-IDF-style scoring:
  //   - Common legal vocabulary ("rights", "law") gets near-zero weight
  //   - Specific query terms ("notice", "employer", "fires") get high weight
  //   - Quadratic bonus for matching MULTIPLE distinct high-signal terms
  //   - Anchor terms (topic-specific) add bonus to surface substantive provisions
  //   - Big bonus for chunks containing actual section/article numbers
  //     (those are the substantive legal provisions)
  //   - Bonus for chunks containing concrete numerical values (days, weeks, months)
  const ranked = data.map((chunk) => {
    const text = `${chunk.section_title} ${chunk.content}`.toLowerCase();
    let score = 0;

    // High-signal terms: each match worth a lot
    let highSignalHits = 0;
    for (const term of highSignalSet) {
      if (text.includes(term)) {
        score += 5;
        highSignalHits += 1;
      }
    }

    // Quadratic bonus for matching multiple distinct high-signal terms.
    // A chunk matching 4 high-signal terms scores 16, vs 1 term scoring 1.
    score += highSignalHits * highSignalHits * 3;

    // Anchor term hits: topic-specific words pulled in via TOPIC_ANCHORS
    let anchorHits = 0;
    for (const a of anchorSet) {
      if (text.includes(a)) {
        score += 2;
        anchorHits += 1;
      }
    }
    score += anchorHits * 2;

    // Low-signal terms get a tiny weight so they break ties but don't dominate
    for (const term of finalSearchTerms) {
      if (LOW_SIGNAL.has(term) && text.includes(term)) score += 0.5;
    }

    // Big boost for chunks that contain explicit section/article numbers
    if (/\b(?:Section|Article|section|article)\s*\d+/.test(chunk.content)) {
      score += 4;
    }
    // Numbered heading pattern (less restrictive — works inline too):
    // matches "82. Types of contracts" or "...code. 91. Notice on termination..."
    if (/\b\d{1,3}[A-Za-z]?\.\s+[A-Z][a-z]/.test(chunk.content)) {
      score += 3;
    }
    // Concrete numerical values (days/weeks/months/years/percent) — these are
    // the chunks with the actual legal thresholds the user needs
    const numericValuePattern = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:day|week|month|year|hour|percent|%|dalasi|dalasis)/i;
    if (numericValuePattern.test(chunk.content)) {
      score += 5;
    }

    // Bonus for longer, more contextual chunks
    if (chunk.content.length > 800) score += 1;
    else if (chunk.content.length > 400) score += 0.5;

    return { ...chunk, score };
  });

  // Filter out chunks that don't match ANY high-signal term — they're noise
  const filtered =
    highSignalSet.size > 0
      ? ranked.filter((c) => {
          const text = `${c.section_title} ${c.content}`.toLowerCase();
          return Array.from(highSignalSet).some((t) => text.includes(t));
        })
      : ranked;

  filtered.sort((a, b) => b.score - a.score);

  return filtered.slice(0, limit);
}
