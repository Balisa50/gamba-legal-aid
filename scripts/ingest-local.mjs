/**
 * Ingest legal Acts from local PDF files in pdfs-to-ingest/
 *
 * Usage: node scripts/ingest-local.mjs
 *
 * Drop named PDFs into pdfs-to-ingest/ and they'll be parsed, chunked,
 * and inserted into Supabase. Existing chunks for the same document_name
 * are deleted first so re-ingestion is idempotent.
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

// Map filename (WITHOUT extension) → canonical document name.
// The script accepts either .txt (from Google Docs OCR) or .pdf.
// Add new entries here as files land.
const FILE_TO_DOC = {
  "womens-act-2010": "Women's Act 2010",
  "domestic-violence-act-2013": "Domestic Violence Act 2013",
  "immigration-act": "Immigration Act",
  "rent-act-2014": "Rent Act 2014",
  "rent-amendment-act-2017": "Rent (Amendment) Act 2017",
  "rent-amendment-act-2024": "Rent (Amendment) Act 2024",
};

const PDF_DIR = path.join(__dirname, "..", "pdfs-to-ingest");
const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;

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

async function processFile(basename, docName) {
  // Try .txt first (Google Docs OCR output), then .pdf (text-layer PDFs)
  const txtPath = path.join(PDF_DIR, basename + ".txt");
  const pdfPath = path.join(PDF_DIR, basename + ".pdf");

  let fullPath = null;
  let isPdf = false;
  if (fs.existsSync(txtPath)) {
    fullPath = txtPath;
  } else if (fs.existsSync(pdfPath)) {
    fullPath = pdfPath;
    isPdf = true;
  }

  console.log(`\nProcessing: ${docName}`);
  if (!fullPath) {
    console.log(`  SKIP: neither ${basename}.txt nor ${basename}.pdf found`);
    return 0;
  }
  console.log(`  File: ${path.basename(fullPath)}`);

  try {
    let text;
    if (isPdf) {
      const buffer = fs.readFileSync(fullPath);
      console.log(`  Loaded PDF: ${(buffer.length / 1024).toFixed(0)} KB`);
      const data = await pdfParse(buffer);
      console.log(`  Parsed: ${data.numpages} pages, ${data.text.length} chars`);
      text = data.text;
    } else {
      text = fs.readFileSync(fullPath, "utf-8");
      console.log(`  Loaded TXT: ${(text.length / 1024).toFixed(0)} KB, ${text.length} chars`);
    }

    if (text.length < 2000) {
      console.log(`  FAIL: only ${text.length} chars (likely scanned image — needs OCR)`);
      return 0;
    }

    const chunks = chunkText(text, docName);
    console.log(`  Chunked: ${chunks.length} chunks`);

    if (chunks.length === 0) return 0;

    // Idempotent: delete existing chunks for this doc before re-inserting
    const { error: delErr } = await supabase
      .from("legal_chunks")
      .delete()
      .eq("document_name", docName);
    if (delErr) console.error(`  Delete error: ${delErr.message}`);

    let inserted = 0;
    for (let i = 0; i < chunks.length; i += 50) {
      const batch = chunks.slice(i, i + 50);
      const { error } = await supabase.from("legal_chunks").insert(batch);
      if (error) {
        console.error(`  Insert error at batch ${i}: ${error.message}`);
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
  console.log("=== Ingesting Local PDFs ===");
  console.log(`Source: ${PDF_DIR}\n`);

  if (!fs.existsSync(PDF_DIR)) {
    console.log("pdfs-to-ingest/ folder does not exist. Creating it.");
    fs.mkdirSync(PDF_DIR, { recursive: true });
    console.log("Drop your PDFs in there and re-run this script.");
    return;
  }

  const filesPresent = fs
    .readdirSync(PDF_DIR)
    .filter((f) => f.endsWith(".pdf") || f.endsWith(".txt"));
  console.log(`Files found in folder: ${filesPresent.length}`);
  for (const f of filesPresent) console.log(`  - ${f}`);
  console.log();

  let total = 0;
  let success = 0;
  for (const [basename, docName] of Object.entries(FILE_TO_DOC)) {
    const count = await processFile(basename, docName);
    total += count;
    if (count > 0) success++;
  }

  console.log(`\n=== DONE: ${success} docs ingested, ${total} new chunks ===`);

  // Final database state
  const { count: totalRows } = await supabase
    .from("legal_chunks")
    .select("*", { count: "exact", head: true });
  const all = [];
  for (let from = 0; from < totalRows; from += 1000) {
    const { data } = await supabase
      .from("legal_chunks")
      .select("document_name")
      .range(from, from + 999);
    if (data) all.push(...data);
  }
  const counts = {};
  all.forEach((d) => {
    counts[d.document_name] = (counts[d.document_name] || 0) + 1;
  });
  console.log("\n=== FULL DATABASE ===");
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, n]) => console.log(`  ${n.toString().padStart(4)} chunks  ${name}`));
  console.log(`  TOTAL: ${all.length} chunks across ${Object.keys(counts).length} documents`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
