import { getSupabase } from "./supabase";

export interface DocumentChunk {
  id?: string;
  document_name: string;
  section_title: string;
  content: string;
  chunk_index: number;
  metadata?: Record<string, string>;
}

export async function searchDocuments(
  query: string,
  limit = 5
): Promise<DocumentChunk[]> {
  const supabase = getSupabase();

  // Extract meaningful search terms
  const searchTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 8);

  if (searchTerms.length === 0) return [];

  // Build OR query matching any term in content or section_title
  const orConditions = searchTerms
    .map((term) => `content.ilike.%${term}%,section_title.ilike.%${term}%`)
    .join(",");

  const { data, error } = await supabase
    .from("legal_chunks")
    .select("*")
    .or(orConditions)
    .limit(limit * 3);

  if (error || !data) return [];

  // Rank by how many search terms appear in each chunk
  const ranked = data.map((chunk) => {
    const text = `${chunk.section_title} ${chunk.content}`.toLowerCase();
    const score = searchTerms.reduce(
      (acc, term) => acc + (text.includes(term) ? 1 : 0),
      0
    );
    return { ...chunk, score };
  });

  ranked.sort((a, b) => b.score - a.score);

  return ranked.slice(0, limit);
}
