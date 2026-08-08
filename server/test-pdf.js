// Verifies PDF text extraction end-to-end with a minimal valid PDF.
// Run with:  node server/test-pdf.js
import fs from 'node:fs';
import { extractPdfText } from './src/services/Extractor.js';

const streamBody = 'BT /F1 18 Tf 72 700 Td (Photosynthesis happens in the chloroplasts of leaves.) Tj ET\n';
const objs = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  `<< /Length ${streamBody.length} >>\nstream\n${streamBody}endstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];

let pdf = '%PDF-1.4\n';
const offsets = [];
for (let i = 0; i < objs.length; i++) {
  offsets.push(pdf.length);
  pdf += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`;
}
const xrefStart = pdf.length;
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

fs.writeFileSync('/tmp/mini-book.pdf', pdf);
const text = await extractPdfText(fs.readFileSync('/tmp/mini-book.pdf'));
const clean = text.replace(/\s+/g, ' ').trim();
const ok = clean.toLowerCase().includes('photosynthesis') && clean.toLowerCase().includes('chloroplasts');
console.log(`extracted (${text.length} chars): ${clean.slice(0, 100)}`);
console.log(ok ? 'PDF EXTRACTION PASSED ✅' : 'PDF EXTRACTION FAILED ❌');
process.exit(ok ? 0 : 1);
