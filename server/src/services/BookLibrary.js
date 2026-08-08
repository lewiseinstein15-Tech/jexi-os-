import fs from 'fs';
import path from 'path';
import { DATA_DIR, KNOWLEDGE_DIR } from '../config.js';
import { extractPdfText, downloadBookFromUrl } from './Extractor.js';
import { saveBook, listSavedBooks, removeSavedBook } from './MemoryManager.js';

/**
 * JEXI OS Book Library
 * --------------------
 * The user's own books & PDFs. Anything added here becomes the FIRST place
 * JEXI looks when answering — grounded, accurate answers from the user's
 * materials instead of generic internet research.
 *
 * Storage:
 *   - Book text lives in memory (bookLibrary) → mirrored to Redis (REDIS_URL),
 *     so books survive redeploys/restarts on Render/HF.
 *   - Originals (uploads) are copied to DATA_DIR/books for download.
 *   - A markdown copy is written to the knowledge library (USER_BOOKS) so the
 *     file-based search + structure views include them too.
 */

const BOOKS_DIR = path.join(DATA_DIR, 'books');
const CATEGORY = 'USER_BOOKS';
const MAX_BOOK_CHARS = 150000;   // per-book text cap (~150k chars ≈ a few hundred pages)
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB per file

function slugify(name) {
  const base = String(name || 'book')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return base || 'book';
}

function cleanText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function persistBook(displayName, { text, mime, fileExt, original }) {
  const safe = slugify(displayName);
  const ext = fileExt || (String(mime || '').includes('pdf') ? 'pdf' : 'txt');
  const store = {
    name: String(displayName).slice(0, 140),
    file: `${safe}.${ext}`,
    chars: text.length,
    size: original ? original.length : Buffer.byteLength(text, 'utf-8'),
    date: new Date().toISOString(),
    text,
  };
  saveBook(store);

  // Markdown copy in the knowledge library (visible in structure + file search)
  const catDir = path.join(KNOWLEDGE_DIR, CATEGORY);
  fs.mkdirSync(catDir, { recursive: true });
  fs.writeFileSync(
    path.join(catDir, `${safe}.md`),
    `# ${store.name}\n> source: ${store.file} · ${store.chars} chars · added ${store.date}\n\n${text}`,
    'utf-8'
  );

  // Original file (uploads only) for download
  if (original) {
    fs.mkdirSync(BOOKS_DIR, { recursive: true });
    fs.writeFileSync(path.join(BOOKS_DIR, store.file), original);
  }

  return { success: true, name: store.name, file: store.file, chars: store.chars };
}

/** Add a book from an uploaded file (base64 in { name, mime, data }). */
export async function importBookBuffer({ name, mime, data } = {}) {
  if (!name) throw new Error('Book name is required.');
  let raw = String(data || '').trim();
  if (raw.includes(';base64,')) raw = raw.split(';base64,')[1];
  const buf = Buffer.from(raw, 'base64');
  if (!buf.length) throw new Error('Empty file — nothing to read.');
  if (buf.length > MAX_UPLOAD_BYTES) throw new Error('File too large (max 15MB).');

  const ext = (String(name).match(/\.([a-zA-Z0-9]+)$/) || [])[1]?.toLowerCase() || '';
  let text;
  if (ext === 'pdf' || String(mime || '').includes('pdf')) {
    text = await extractPdfText(buf);
  } else {
    text = buf.toString('utf-8');
  }
  text = cleanText(text);
  if (text.length < 40) throw new Error('No readable text found in this file (scanned/image PDFs need OCR).');
  if (text.length > MAX_BOOK_CHARS) text = text.slice(0, MAX_BOOK_CHARS);

  return persistBook(name, { text, mime, fileExt: ext || 'txt', original: buf });
}

/** Add a book by pasting a link (PDF or plain text/HTML). */
export async function importBookUrl({ url, name } = {}) {
  if (!url) throw new Error('A link is required.');
  const fetched = await downloadBookFromUrl(url);
  let text = cleanText(fetched.text);
  if (text.length < 40) throw new Error('No readable text found at this URL.');
  if (text.length > MAX_BOOK_CHARS) text = text.slice(0, MAX_BOOK_CHARS);
  const displayName = (name && name.trim()) ? name.trim() : fetched.name;
  return persistBook(displayName, { text, mime: fetched.mime, fileExt: undefined });
}

/** List the user's books (metadata only — no full text). */
export function listBooks() {
  return listSavedBooks().map(({ text, ...meta }) => meta);
}

/** Remove a book from the library (memory + files). */
export function deleteBook(name) {
  const removed = removeSavedBook(name);
  if (!removed) return { success: false, error: 'Book not found' };
  try { fs.unlinkSync(path.join(BOOKS_DIR, removed.file)); } catch (e) {}
  try { fs.unlinkSync(path.join(KNOWLEDGE_DIR, CATEGORY, `${slugify(removed.name)}.md`)); } catch (e) {}
  return { success: true };
}
