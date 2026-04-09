/**
 * Downloads Gambian legal PDFs and chunks them into Supabase.
 *
 * Usage:
 *   node scripts/ingest-laws.mjs
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

// Legal documents to download
const DOCUMENTS = [
  {
    name: "Constitution of The Gambia (1997)",
    url: "https://faolex.fao.org/docs/pdf/gam129753.pdf",
  },
  {
    name: "Labour Act 2023",
    url: "https://natlex.ilo.org/dyn/natlex2/natlex2/files/download/116766/Labour%20Act%202023.pdf",
  },
  {
    name: "Criminal Code (Act No. 25 of 1933)",
    url: "https://www.policinglaw.info/assets/downloads/Gambian_Criminal_Code.pdf",
  },
  {
    name: "Children's Act 2005",
    url: "http://citizenshiprightsafrica.org/wp-content/uploads/2016/01/Gambia-Childrens-Act-2005.pdf",
  },
  {
    name: "Women's Act 2010",
    url: "http://www.rodra.co.za/images/countries/gambia/legislation/women%20act.pdf",
  },
  {
    name: "Consumer Protection Act 2014",
    url: "http://gcc.gm/wp-content/uploads/2018/05/GAMBIA-CONSUMER-PROTECTION-ACT-2014.pdf",
  },
  {
    name: "Immigration Act",
    url: "https://www.unodc.org/cld/uploads/res/document/gmb/1965/immigration_act_html/Immigration_Act.pdf",
  },
  {
    name: "Land Acquisition and Compensation Act",
    url: "https://faolex.fao.org/docs/pdf/gam204141.pdf",
  },
];

const CHUNK_SIZE = 1500; // characters per chunk
const CHUNK_OVERLAP = 200; // overlap between chunks

async function downloadPdf(url) {
  console.log(`  Downloading: ${url}`);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Legal Research Bot)",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return buffer;
}

function chunkText(text, docName) {
  // Clean text
  const cleaned = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+/g, " ")
    .trim();

  // Try to split by sections/articles first
  const sectionPattern =
    /(?:PART|CHAPTER|SECTION|Article|Division)\s+[IVXLCDM0-9]+[.:)  -]*/gi;
  const parts = cleaned.split(sectionPattern);

  const chunks = [];
  let chunkIndex = 0;

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length < 50) continue; // Skip tiny fragments

    if (trimmed.length <= CHUNK_SIZE) {
      // Try to extract a section title from the first line
      const firstLine = trimmed.split("\n")[0]?.slice(0, 100) || "General";
      chunks.push({
        document_name: docName,
        section_title: firstLine.trim(),
        content: trimmed,
        chunk_index: chunkIndex++,
      });
    } else {
      // Split long sections into overlapping chunks
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

    const chunks = chunkText(data.text, doc.name);
    console.log(`  Chunked: ${chunks.length} chunks`);

    if (chunks.length === 0) {
      console.log(`  WARNING: No chunks generated for ${doc.name}`);
      return 0;
    }

    // Delete existing chunks for this document (re-ingestion)
    await supabase.from("legal_chunks").delete().eq("document_name", doc.name);

    // Insert in batches of 50
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

    console.log(`  Inserted: ${inserted} chunks into Supabase`);
    return inserted;
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    return 0;
  }
}

async function main() {
  console.log("=== Gamba Legal Aid - Document Ingestion ===\n");
  console.log(`Target: ${DOCUMENTS.length} legal documents`);

  let totalChunks = 0;
  let successCount = 0;

  for (const doc of DOCUMENTS) {
    const count = await processDocument(doc);
    totalChunks += count;
    if (count > 0) successCount++;
  }

  console.log("\n=== DONE ===");
  console.log(
    `Documents processed: ${successCount}/${DOCUMENTS.length}`
  );
  console.log(`Total chunks inserted: ${totalChunks}`);
}

main().catch(console.error);
