/**
 * B133 — ATTACHMENT POLICY (DeepSeek Harness `packages/attachment` mirror).
 *
 * Upload validation before storage: size cap (25 MB), type allowlist
 * (documents, images, media, archives, data, code as TEXT), and hard reject
 * of executables/scripts that could run server-side. Returns a branded
 * attachment id for the chat body.
 */

import path from 'path';

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const ALLOWED_EXT = new Set([
  // documents
  'pdf', 'txt', 'md', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'rtf', 'odt',
  // images
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif',
  // media
  'mp3', 'mp4', 'wav', 'ogg', 'webm', 'mov', 'm4a', 'flac',
  // archives / data
  'zip', 'gz', 'json', 'xml', 'yaml', 'yml', 'toml', 'sql',
  // code as TEXT (never executed server-side)
  'js', 'jsx', 'ts', 'tsx', 'py', 'html', 'css', 'java', 'c', 'cpp', 'h', 'go', 'rb', 'rs', 'php', 'sh', 'kt', 'swift', 'vue', 'svelte', 'mjs', 'cjs',
]);

const DANGEROUS_EXT = new Set(['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'dll', 'so', 'dylib', 'bin', 'apk', 'jar', 'class']);

/** Validate an attachment name (and implied type). */
export function validateAttachmentName(name) {
  const n = String(name || '').trim();
  if (!n) return { ok: false, error: 'filename required' };
  if (n.includes('/') || n.includes('\\') || n.includes('..')) return { ok: false, error: 'unsafe filename' };
  const ext = path.extname(n).slice(1).toLowerCase();
  if (DANGEROUS_EXT.has(ext)) return { ok: false, error: `file type .${ext} is not allowed (executables are blocked)` };
  if (!ALLOWED_EXT.has(ext)) return { ok: false, error: `file type .${ext || '(none)'} is not in the allowed set` };
  return { ok: true, ext };
}

/** Validate a decoded upload payload. */
export function validateAttachment({ name, data, size }) {
  const v = validateAttachmentName(name);
  if (!v.ok) return v;
  const bytes = typeof size === 'number' ? size : (typeof data === 'string' ? Math.floor(Buffer.byteLength(data, 'base64')) : 0);
  if (bytes > MAX_ATTACHMENT_BYTES) return { ok: false, error: `file too large (${Math.round(bytes / 1048576)} MB > 25 MB)` };
  if (bytes === 0) return { ok: false, error: 'empty file' };
  return { ok: true, ext: v.ext, bytes };
}

/** Branded attachment id (DSH AttachmentId analog). */
export function attachmentId(fileName) {
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${String(fileName || 'f').replace(/[^a-z0-9.-]/gi, '_').slice(0, 30)}`;
}
