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
  // Violence and assault
  attacked: ["assault", "battery", "bodily harm", "self-defence", "defence", "force", "weapon", "wound", "grievous", "offence"],
  attack: ["assault", "battery", "bodily harm", "self-defence", "defence", "force", "weapon", "wound", "grievous"],
  knife: ["weapon", "offensive weapon", "wound", "stabbing", "assault", "bodily harm", "grievous"],
  stabbed: ["wound", "grievous harm", "assault", "weapon", "bodily harm"],
  beaten: ["assault", "battery", "bodily harm", "force", "wound", "grievous"],
  hurt: ["bodily harm", "assault", "injury", "wound", "grievous", "offence"],
  killed: ["murder", "manslaughter", "homicide", "death", "culpable"],
  murder: ["murder", "manslaughter", "homicide", "death", "culpable", "killing"],
  steal: ["theft", "stealing", "robbery", "larceny", "dishonest", "property"],
  stolen: ["theft", "stealing", "robbery", "larceny", "dishonest", "property"],
  robbery: ["robbery", "theft", "stealing", "force", "violence", "armed"],
  rape: ["sexual", "offence", "assault", "consent", "indecent"],
  sexual: ["sexual", "offence", "assault", "indecent", "consent", "rape"],
  fraud: ["fraud", "dishonest", "deception", "false", "pretence", "cheating"],
  bribe: ["corruption", "bribery", "public officer", "gratification"],
  drug: ["narcotic", "drug", "substance", "possession", "trafficking"],
  fight: ["assault", "affray", "battery", "bodily harm", "force", "wound"],
  threaten: ["threat", "intimidation", "criminal", "assault", "menace"],
  harass: ["harassment", "stalking", "intimidation", "threat", "nuisance"],

  // Self-defense
  defend: ["self-defence", "defence", "force", "justified", "provocation", "assault"],
  protection: ["protection", "defence", "restraining", "order", "safety"],

  // Arrest and criminal procedure
  arrested: ["arrest", "detention", "custody", "criminal", "police", "bail", "charge", "rights", "warrant"],
  police: ["police", "arrest", "detention", "custody", "criminal", "force", "search", "warrant"],
  bail: ["bail", "custody", "detention", "release", "surety", "court"],
  jail: ["imprisonment", "sentence", "custody", "detention", "prison", "convicted"],
  prison: ["imprisonment", "sentence", "custody", "detention", "prison", "convicted"],
  court: ["court", "trial", "judge", "magistrate", "hearing", "proceedings"],
  trial: ["trial", "court", "judge", "accused", "evidence", "proceedings", "verdict"],
  sentence: ["sentence", "punishment", "imprisonment", "fine", "penalty", "convicted"],
  guilty: ["guilty", "convicted", "verdict", "sentence", "plea", "offence"],
  innocent: ["innocent", "acquitted", "presumption", "not guilty", "accused"],
  lawyer: ["lawyer", "counsel", "advocate", "legal representation", "attorney", "defence"],

  // Employment
  fired: ["dismissal", "termination", "employment", "unfair", "labour", "worker", "employer"],
  dismissed: ["dismissal", "termination", "employment", "unfair", "labour", "worker"],
  salary: ["wages", "remuneration", "pay", "employment", "labour", "compensation"],
  wages: ["wages", "remuneration", "pay", "salary", "employment", "labour"],
  worker: ["worker", "employee", "employment", "labour", "employer", "work"],
  employer: ["employer", "employment", "labour", "worker", "employee", "dismissal"],
  contract: ["contract", "agreement", "employment", "terms", "conditions"],
  overtime: ["overtime", "hours", "work", "wages", "labour", "employment"],
  leave: ["leave", "maternity", "annual", "sick", "employment", "labour"],
  pension: ["pension", "retirement", "gratuity", "benefit", "social security"],

  // Housing
  landlord: ["landlord", "tenant", "rent", "lease", "evict", "property", "dwelling", "premises", "occupation"],
  tenant: ["tenant", "landlord", "rent", "lease", "evict", "property", "dwelling", "premises"],
  evict: ["evict", "eviction", "possession", "tenant", "landlord", "rent", "property", "dwelling"],
  rent: ["rent", "tenant", "landlord", "lease", "premises", "dwelling"],

  // Family
  divorce: ["divorce", "marriage", "matrimonial", "custody", "maintenance", "spouse"],
  marriage: ["marriage", "matrimonial", "divorce", "spouse", "wife", "husband"],
  custody: ["custody", "child", "guardian", "welfare", "parent", "access"],
  abuse: ["abuse", "violence", "domestic", "assault", "child", "protection", "cruelty"],
  violence: ["violence", "domestic", "assault", "protection", "abuse", "battery", "restraining"],

  // Children
  child: ["child", "children", "minor", "juvenile", "custody", "guardian", "welfare", "protection"],
  minor: ["minor", "child", "juvenile", "age", "guardian", "welfare"],
  adoption: ["adoption", "child", "guardian", "welfare", "custody", "parent"],

  // Property
  land: ["land", "property", "acquisition", "compensation", "title", "deed", "ownership"],
  property: ["property", "land", "acquisition", "compensation", "ownership", "possession"],
  inheritance: ["inheritance", "succession", "estate", "will", "deceased", "property"],

  // Consumer
  consumer: ["consumer", "protection", "goods", "services", "product", "warranty", "refund"],
  refund: ["refund", "consumer", "goods", "defective", "return", "warranty"],
  scam: ["fraud", "deception", "false", "pretence", "consumer", "dishonest"],

  // Constitutional
  rights: ["rights", "freedom", "protection", "fundamental", "constitutional", "entitle"],
  freedom: ["freedom", "rights", "liberty", "expression", "assembly", "religion", "press"],
  discrimination: ["discrimination", "equality", "gender", "race", "religion", "women"],
  vote: ["vote", "election", "franchise", "political", "citizen", "democracy"],

  // Immigration
  immigration: ["immigration", "passport", "visa", "deportation", "permit", "alien", "citizen"],
  deport: ["deportation", "immigration", "removal", "alien", "expulsion"],
  citizenship: ["citizenship", "citizen", "nationality", "naturalization", "birth"],
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
