// Quick self-test for the JEXI book library.
// Run with:  DATA_DIR=/tmp/jexi-books-test node server/test-books.js
import { importBookBuffer, importBookUrl, listBooks, deleteBook } from './src/services/BookLibrary.js';
import { searchKnowledge } from './src/services/MemoryManager.js';

const TEXT = `This is a story about photosynthesis. Photosynthesis is the process by which green plants convert light into chemical energy. It happens inside the chloroplasts of leaves. The overall equation is 6CO2 + 6H2O -> C6H12O6 + 6O2. Chlorophyll is the green pigment that captures sunlight.`;

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? '✅' : '❌'} ${label}`); if (!cond) failures++; };

// 1) Upload a text book (base64 like the frontend sends)
const up = await importBookBuffer({ name: 'My Biology Notes.txt', mime: 'text/plain', data: Buffer.from(TEXT).toString('base64') });
ok(up.success && up.chars > 40, `upload txt → ${up.file}, ${up.chars} chars`);

// 2) List
const list = listBooks();
ok(list.length === 1 && list[0].name === 'My Biology Notes.txt', 'listBooks returns 1 book');
ok(!('text' in list[0]), 'listBooks hides the full text (metadata only)');

// 3) Search — books are found with an excerpt centered on the match
const hits = searchKnowledge('photosynthesis chloroplast', 1);
ok(hits.length >= 1, 'searchKnowledge finds the book');
ok(hits[0].title === 'My Biology Notes.txt' && hits[0].source === 'book', `search hit: ${hits[0].title} (${hits[0].source})`);
ok(hits[0].content.includes('photosynthesis'), 'excerpt contains the match');

// 4) Delete
const del = deleteBook('My Biology Notes.txt');
ok(del.success, 'deleteBook works');
ok(listBooks().length === 0, 'library empty after delete');

// 5) Best-effort: import a PDF straight from a URL (network dependent)
try {
  const pdf = await importBookUrl({ url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', name: 'W3C Dummy Guide.pdf' });
  ok(pdf.success && pdf.chars > 10, `PDF from URL → ${pdf.name}, ${pdf.chars} chars`);
  const pdfHits = searchKnowledge('pdf file format', 1);
  console.log(`   (pdf search hits: ${pdfHits.length})`);
  deleteBook(pdf.name);
} catch (e) {
  console.log(`⚠️  PDF-from-URL test skipped (network/parse): ${e.message}`);
}

console.log(failures === 0 ? '\nALL BOOK TESTS PASSED ✅' : `\n${failures} TEST(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
