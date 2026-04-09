/**
 * Ingest the laws that failed in the first round.
 * These are confirmed text-extractable PDFs.
 */

import { createClient } from "@supabase/supabase-js";
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load env
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (val) process.env[key] = val;
    }
  }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DOCUMENTS = [
  {
    name: "Criminal Code (Act No. 25 of 1933)",
    url: "https://www.lawhubgambia.com/s/Criminal-Code-Act-No-25-of-1933.pdf",
  },
  {
    name: "Children's Act 2005",
    url: "http://www.rodra.co.za/images/countries/gambia/legislation/CHILDREN_S%20ACT,%202005.pdf",
  },
  {
    name: "Criminal Offences Act 2025",
    url: "https://moj.gov.gm/wp-content/uploads/2025/07/Assent-Copy-Criminal-Offences-Act-2025-Passed-28th-March-2025.pdf",
  },
  {
    name: "Criminal Procedure Act 2025",
    url: "https://moj.gov.gm/wp-content/uploads/2025/07/Assent-Copy-Criminal-Procedure-Act-2025-Passed-28th-March-2025.pdf",
  },
];

const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;

async function downloadPdf(url) {
  console.log(`  Downloading: ${url}`);
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Legal Research Bot)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function chunkText(text, docName) {
  const cleaned = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+/g, " ")
    .trim();

  const sectionPattern =
    /(?:PART|CHAPTER|SECTION|Article|Division)\s+[IVXLCDM0-9]+[.:) -]*/gi;
  const parts = cleaned.split(sectionPattern);

  const chunks = [];
  let chunkIndex = 0;

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length < 50) continue;

    if (trimmed.length <= CHUNK_SIZE) {
      const firstLine = trimmed.split("\n")[0]?.slice(0, 100) || "General";
      chunks.push({
        document_name: docName,
        section_title: firstLine.trim(),
        content: trimmed,
        chunk_index: chunkIndex++,
      });
    } else {
      for (let i = 0; i < trimmed.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
        const slice = trimmed.slice(i, i + CHUNK_SIZE);
        if (slice.length < 50) continue;
        const firstLine = slice.split(/[.\n]/)[0]?.slice(0, 100) || "Continued";
        chunks.push({
          document_name: docName,
          section_title: firstLine.trim(),
          content: slice,
          chunk_index: chunkIndex++,
        });
      }
    }
  }

  return chunks;
}

async function processDocument(doc) {
  console.log(`\nProcessing: ${doc.name}`);
  try {
    const buffer = await downloadPdf(doc.url);
    console.log(`  Downloaded: ${(buffer.length / 1024).toFixed(0)} KB`);

    const data = await pdfParse(buffer);
    console.log(`  Parsed: ${data.numpages} pages, ${data.text.length} chars`);

    if (data.text.length < 200) {
      console.log(`  SKIP: Too little text (likely scanned image)`);
      return 0;
    }

    const chunks = chunkText(data.text, doc.name);
    console.log(`  Chunked: ${chunks.length} chunks`);

    if (chunks.length === 0) return 0;

    // Delete existing chunks for re-ingestion
    await supabase.from("legal_chunks").delete().eq("document_name", doc.name);

    let inserted = 0;
    for (let i = 0; i < chunks.length; i += 50) {
      const batch = chunks.slice(i, i + 50);
      const { error } = await supabase.from("legal_chunks").insert(batch);
      if (error) {
        console.error(`  DB error at batch ${i}: ${error.message}`);
      } else {
        inserted += batch.length;
      }
    }

    console.log(`  Inserted: ${inserted} chunks`);
    return inserted;
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    return 0;
  }
}

async function main() {
  console.log("=== Ingesting Missing Legal Documents ===\n");

  let total = 0;
  let success = 0;

  for (const doc of DOCUMENTS) {
    const count = await processDocument(doc);
    total += count;
    if (count > 0) success++;
  }

  console.log(`\n=== DONE: ${success}/${DOCUMENTS.length} docs, ${total} chunks ===`);

  // Show final database state
  const { data } = await supabase.from("legal_chunks").select("document_name");
  const counts = {};
  data.forEach((d) => {
    counts[d.document_name] = (counts[d.document_name] || 0) + 1;
  });
  console.log("\n=== FULL DATABASE ===");
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, count]) => console.log(`  ${count} chunks | ${name}`));
  console.log(`  TOTAL: ${data.length} chunks`);
}

main().catch(console.error);
