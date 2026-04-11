/**
 * Quick retrieval sanity check for the newly ingested Acts.
 * Runs a handful of queries and prints top chunks so we can eyeball
 * whether the topic anchors are pulling the right provisions.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const QUERIES = [
  { q: "eviction notice landlord", target: "Rent" },
  { q: "protection order domestic violence", target: "Domestic Violence" },
  { q: "prohibited immigrant deportation", target: "Immigration" },
  { q: "rent increase tenant", target: "Rent" },
];

for (const { q, target } of QUERIES) {
  console.log(`\nQuery: "${q}"  (expecting top hit from ${target})`);
  console.log("-".repeat(70));
  const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const or = terms
    .map((t) => `content.ilike.%${t}%,section_title.ilike.%${t}%`)
    .join(",");
  const { data } = await supabase
    .from("legal_chunks")
    .select("document_name, section_title, content")
    .or(or)
    .limit(200);
  if (!data || data.length === 0) {
    console.log("  NO RESULTS");
    continue;
  }
  // crude scoring: count term hits
  const ranked = data
    .map((c) => {
      const text = (c.section_title + " " + c.content).toLowerCase();
      let score = 0;
      for (const t of terms) if (text.includes(t)) score += 1;
      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  for (const [i, c] of ranked.entries()) {
    console.log(`  ${i + 1}. [${c.document_name}] score=${c.score}`);
    console.log(`     ${c.content.slice(0, 180).replace(/\s+/g, " ")}...`);
  }
}
