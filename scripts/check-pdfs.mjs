/**
 * Diagnose which PDFs in pdfs-to-ingest/ have extractable text layers
 * vs which are scanned images that need OCR.
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_DIR = path.join(__dirname, "..", "pdfs-to-ingest");

const files = fs.readdirSync(PDF_DIR).filter((f) => f.toLowerCase().endsWith(".pdf"));

console.log(`\nChecking ${files.length} PDFs in ${PDF_DIR}\n`);
console.log("=".repeat(80));

for (const file of files) {
  const full = path.join(PDF_DIR, file);
  const buf = fs.readFileSync(full);
  const sizeKB = (buf.length / 1024).toFixed(0);
  try {
    const data = await pdfParse(buf);
    const chars = data.text.length;
    const status = chars > 2000 ? "TEXT_OK  " : chars > 200 ? "PARTIAL  " : "SCANNED  ";
    console.log(`${status} ${file}`);
    console.log(`         ${sizeKB} KB | ${data.numpages} pages | ${chars} chars`);
    if (chars > 0 && chars < 500) {
      console.log(`         Preview: ${data.text.slice(0, 200).replace(/\s+/g, " ")}`);
    }
  } catch (err) {
    console.log(`FAILED   ${file}: ${err.message}`);
  }
}
console.log("=".repeat(80));
