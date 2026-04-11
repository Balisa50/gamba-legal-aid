/**
 * Run the ACTUAL app search pipeline against a single query
 * to see what chunks the model would receive.
 */
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

const { searchDocuments } = await import("../app/lib/embeddings.ts");

const query = process.argv[2] || "LAW ON IMMIGRATION";
console.log(`\nQuery: "${query}"\n${"=".repeat(70)}`);
const chunks = await searchDocuments(query, 8);
for (const [i, c] of chunks.entries()) {
  console.log(`${i + 1}. [${c.document_name}] score=${c.score ?? "?"}`);
  console.log(`   Title: ${c.section_title.slice(0, 80)}`);
  console.log(`   ${c.content.slice(0, 200).replace(/\s+/g, " ")}...`);
  console.log();
}
