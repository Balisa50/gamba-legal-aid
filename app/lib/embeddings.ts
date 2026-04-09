import { getSupabase } from "./supabase";

export interface DocumentChunk {
  id?: string;
  document_name: string;
  section_title: string;
  content: string;
  chunk_index: number;
  metadata?: Record<string, string>;
}

// Legal synonym expansion — maps common terms to legal language
const LEGAL_SYNONYMS: Record<string, string[]> = {
  landlord: ["landlord", "tenant", "rent", "lease", "evict", "property", "dwelling", "premises", "occupation"],
  tenant: ["tenant", "landlord", "rent", "lease", "evict", "property", "dwelling", "premises"],
  evict: ["evict", "eviction", "possession", "tenant", "landlord", "rent", "property", "dwelling"],
  fired: ["dismissal", "termination", "employment", "unfair", "labour", "worker", "employer"],
  dismissed: ["dismissal", "termination", "employment", "unfair", "labour", "worker"],
  salary: ["wages", "remuneration", "pay", "employment", "labour", "compensation"],
  wages: ["wages", "remuneration", "pay", "salary", "employment", "labour"],
  arrested: ["arrest", "detention", "custody", "criminal", "police", "bail", "charge", "rights"],
  police: ["police", "arrest", "detention", "custody", "criminal", "force", "search"],
  divorce: ["divorce", "marriage", "matrimonial", "custody", "maintenance", "spouse"],
  marriage: ["marriage", "matrimonial", "divorce", "spouse", "wife", "husband"],
  child: ["child", "children", "minor", "juvenile", "custody", "guardian", "welfare", "protection"],
  violence: ["violence", "domestic", "assault", "protection", "abuse", "battery"],
  land: ["land", "property", "acquisition", "compensation", "title", "deed", "ownership"],
  property: ["property", "land", "acquisition", "compensation", "ownership", "possession"],
  consumer: ["consumer", "protection", "goods", "services", "product", "warranty", "refund"],
  rights: ["rights", "freedom", "protection", "fundamental", "constitutional", "entitle"],
  immigration: ["immigration", "passport", "visa", "deportation", "permit", "alien", "citizen"],
  worker: ["worker", "employee", "employment", "labour", "employer", "work"],
  employer: ["employer", "employment", "labour", "worker", "employee", "dismissal"],
};

function expandQuery(terms: string[]): string[] {
  const expanded = new Set(terms);
  for (const term of terms) {
    const synonyms = LEGAL_SYNONYMS[term];
    if (synonyms) {
      synonyms.forEach((s) => expanded.add(s));
    }
  }
  return Array.from(expanded).slice(0, 15);
}

// Stop words to filter out
const STOP_WORDS = new Set([
  "the", "what", "are", "my", "if", "is", "can", "how", "does", "do",
  "was", "were", "been", "being", "have", "has", "had", "will", "would",
  "could", "should", "may", "might", "shall", "that", "this", "with",
  "from", "for", "and", "but", "not", "you", "your", "they", "them",
  "their", "its", "about", "want", "wants", "get", "got", "say", "says",
]);

export async function searchDocuments(
  query: string,
  limit = 8
): Promise<DocumentChunk[]> {
  const supabase = getSupabase();

  // Extract meaningful search terms, filter stop words
  const rawTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  if (rawTerms.length === 0) return [];

  // Expand with legal synonyms
  const searchTerms = expandQuery(rawTerms);

  // Build OR query
  const orConditions = searchTerms
    .map((term) => `content.ilike.%${term}%,section_title.ilike.%${term}%`)
    .join(",");

  const { data, error } = await supabase
    .from("legal_chunks")
    .select("*")
    .or(orConditions)
    .limit(limit * 5);

  if (error || !data) return [];

  // Rank by how many search terms appear + bonus for original terms
  const ranked = data.map((chunk) => {
    const text = `${chunk.section_title} ${chunk.content}`.toLowerCase();
    let score = 0;

    // Original terms get double weight
    for (const term of rawTerms) {
      if (text.includes(term)) score += 2;
    }

    // Expanded terms get single weight
    for (const term of searchTerms) {
      if (text.includes(term)) score += 1;
    }

    // Bonus for longer content (more context)
    if (chunk.content.length > 500) score += 1;

    return { ...chunk, score };
  });

  ranked.sort((a, b) => b.score - a.score);

  return ranked.slice(0, limit);
}
