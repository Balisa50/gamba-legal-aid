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

  // Run multiple ILIKE searches in parallel for speed
  // Search both content and section_title
  const orConditions = searchTerms
    .map((term) => `content.ilike.%${term}%,section_title.ilike.%${term}%`)
    .join(",");

  const { data, error } = await supabase
    .from("legal_chunks")
    .select("*")
    .or(orConditions)
    .limit(limit * 5);

  if (error || !data) return [];

  // Rank results by relevance
  const ranked = data.map((chunk) => {
    const text = `${chunk.section_title} ${chunk.content}`.toLowerCase();
    let score = 0;

    for (const term of rawTerms) {
      // Exact term match (highest weight)
      if (text.includes(term)) score += 3;
    }

    for (const term of searchTerms) {
      // Stemmed/variant match
      if (text.includes(term)) score += 1;
    }

    // Bonus for chunks with multiple different matches
    const uniqueMatches = searchTerms.filter((t) => text.includes(t)).length;
    score += uniqueMatches * 2;

    // Bonus for longer, more contextual chunks
    if (chunk.content.length > 800) score += 2;
    else if (chunk.content.length > 400) score += 1;

    return { ...chunk, score };
  });

  ranked.sort((a, b) => b.score - a.score);

  return ranked.slice(0, limit);
}
