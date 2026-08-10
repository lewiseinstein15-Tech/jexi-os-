import { useState, useEffect, useRef } from 'react';
import { BookOpen, Folder, Brain, RefreshCw, CheckCircle2, Circle, Upload, Link2, Trash2, FileText, Loader2, AlertTriangle } from 'lucide-react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';
import PanelHeader from './PanelHeader';

const fmtKB = (n) => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(0)} KB` : `${n} B`;

export default function KnowledgePanel() {
  const [structure, setStructure] = useState(null);
  const [status, setStatus] = useState(null);
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { type: 'ok' | 'err', text }
  const [urlInput, setUrlInput] = useState('');
  const fileRef = useRef(null);
  const backendUrl = getBackendUrl();

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [structRes, statusRes, booksRes] = await Promise.all([
        jexiFetch(`${backendUrl}/api/knowledge/structure`),
        jexiFetch(`${backendUrl}/api/knowledge/status`),
        jexiFetch(`${backendUrl}/api/knowledge/books`)
      ]);
      setStructure(await structRes.json());
      setStatus(await statusRes.json());
      setBooks(await booksRes.json());
    } catch (e) {
      console.error('Failed to fetch knowledge', e);
    }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const toBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleFiles = async (files) => {
    for (const file of files) {
      setBusy(true);
      setMsg({ type: 'ok', text: `📖 Reading ${file.name}…` });
      try {
        const data = await toBase64(file);
        const resp = await jexiFetch(`${backendUrl}/api/knowledge/books/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, mime: file.type || '', data })
        });
        const json = await resp.json();
        if (!json.success) throw new Error(json.error || 'Upload failed');
        setMsg({ type: 'ok', text: `✓ "${json.name}" added to the library — ${Math.floor(json.chars / 1000)}k chars of knowledge.` });
      } catch (e) {
        setMsg({ type: 'err', text: `✗ ${file.name}: ${e.message}` });
      } finally {
        setBusy(false);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
    fetchAll();
  };

  const importFromUrl = async () => {
    const url = urlInput.trim();
    if (!url) return;
    setBusy(true);
    setMsg({ type: 'ok', text: '⬇️ Downloading the book from that link…' });
    try {
      const resp = await jexiFetch(`${backendUrl}/api/knowledge/books/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const json = await resp.json();
      if (!json.success) throw new Error(json.error || 'Import failed');
      setMsg({ type: 'ok', text: `✓ "${json.name}" downloaded — ${Math.floor(json.chars / 1000)}k chars.` });
      setUrlInput('');
    } catch (e) {
      setMsg({ type: 'err', text: `✗ ${e.message}` });
    } finally {
      setBusy(false);
      fetchAll();
    }
  };

  const removeBook = async (name) => {
    if (!window.confirm(`Remove "${name}" from the library?`)) return;
    try {
      const resp = await jexiFetch(`${backendUrl}/api/knowledge/books/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const json = await resp.json();
      setMsg(json.success
        ? { type: 'ok', text: `Removed "${name}".` }
        : { type: 'err', text: json.error || 'Could not remove.' });
    } catch (e) {
      setMsg({ type: 'err', text: `Could not remove: ${e.message}` });
    }
    fetchAll();
  };

  return (
    <div className="space-y-3">
      {/* ---------- MY BOOKS ---------- */}
      <div className="glass p-4 rounded-xl border border-[#00FF9D]/20">
        <PanelHeader
          icon={BookOpen}
          title="MY BOOKS — JEXI ANSWERS FROM THESE"
          color="text-[#00FF9D]"
          right={
            <span className="text-[8px] text-gray-500 bg-[#0a0a0a] px-2 py-1 rounded-full border border-[#1a1a1a]">
              PDF · TXT · MD
            </span>
          }
        />

        {msg && (
          <div className={`mt-2 mb-2 px-3 py-2 rounded-lg text-[10px] font-medium flex items-start gap-2 ${msg.type === 'ok' ? 'bg-[#00FF9D]/10 text-[#00FF9D] border border-[#00FF9D]/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
            {msg.type === 'ok' ? <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" /> : <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />}
            <span>{msg.text}</span>
          </div>
        )}

        {/* Upload row */}
        <div className="mt-3 flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,.md,.markdown"
            multiple
            className="hidden"
            onChange={(e) => e.target.files?.length && handleFiles([...e.target.files])}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-2 bg-[#00FF9D]/15 hover:bg-[#00FF9D]/25 border border-[#00FF9D]/40 text-[#00FF9D] text-[10px] font-bold py-2.5 rounded-lg transition-all active:scale-95 disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {busy ? 'ADDING…' : 'ADD A BOOK / PDF'}
          </button>
        </div>
        <p className="text-[8px] text-gray-600 mt-1.5">Max 15MB each · scanned/image-only PDFs need OCR (no text to read) · up to 6 books</p>

        {/* Add from link */}
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 bg-[#0a0a0a] rounded-lg border border-[#1a1a1a] px-2.5 py-2">
            <Link2 className="w-3 h-3 text-[#00d4ff]" />
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && importFromUrl()}
              placeholder="…or paste a direct link to a PDF / text file"
              className="bg-transparent text-[10px] text-gray-300 outline-none w-full placeholder-gray-600"
            />
          </div>
          <button
            onClick={importFromUrl}
            disabled={busy || !urlInput.trim()}
            className="px-3 py-2 bg-[#00d4ff]/10 hover:bg-[#00d4ff]/20 border border-[#00d4ff]/30 text-[#00d4ff] text-[10px] font-bold rounded-lg transition-all active:scale-95 disabled:opacity-40"
          >
            FETCH
          </button>
        </div>

        {/* Book list */}
        <div className="mt-3 space-y-1.5 max-h-[38vh] overflow-y-auto pr-1">
          {books.length === 0 && !loading && (
            <p className="text-center text-gray-600 text-[10px] py-3">No books yet. Add your first book above — JEXI will answer from it instead of guessing.</p>
          )}
          {books.map((book) => (
            <div key={book.name} className="flex items-center justify-between gap-2 bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg px-2.5 py-2 hover:border-[#00FF9D]/30 transition-colors">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-3.5 h-3.5 text-[#00d4ff] shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-gray-200 truncate">{book.name}</p>
                  <p className="text-[8px] text-gray-600">{fmtKB(book.size)} · {Math.floor(book.chars / 1000)}k chars · {new Date(book.date).toLocaleDateString()}</p>
                </div>
              </div>
              <button
                onClick={() => removeBook(book.name)}
                className="text-gray-600 hover:text-red-400 transition-colors shrink-0"
                title="Remove from library"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <p className="text-[8px] text-gray-600 mt-2 leading-relaxed">
          💡 Ask JEXI anything about these books — she reads them and answers with citations, before touching the internet.
        </p>
      </div>

      {/* ---------- KNOWLEDGE CORE STATS ---------- */}
      <div className="glass p-4 rounded-xl">
        <PanelHeader
          icon={Brain}
          title="KNOWLEDGE CORE"
          right={
            <button onClick={fetchAll} className="text-gray-500 hover:text-[#00FF9D] transition-colors" title="Refresh">
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            </button>
          }
        />

        {status && (
          <div className="grid grid-cols-3 gap-2 mt-3 mb-4">
            <div className="text-center bg-[#0a0a0a] p-2 rounded-lg">
              <p className="text-[#00FF9D] font-bold text-lg">{status.total + books.length}</p>
              <p className="text-[7px] text-gray-600">TOTAL FILES</p>
            </div>
            <div className="text-center bg-[#0a0a0a] p-2 rounded-lg">
              <p className="text-[#22c55e] font-bold text-lg">{status.filled + books.length}</p>
              <p className="text-[7px] text-gray-600">MASTERED</p>
            </div>
            <div className="text-center bg-[#0a0a0a] p-2 rounded-lg">
              <p className="text-[#f59e0b] font-bold text-lg">{status.empty}</p>
              <p className="text-[7px] text-gray-600">TO LEARN</p>
            </div>
          </div>
        )}
      </div>

      {/* ---------- LIBRARY STRUCTURE ---------- */}
      <div className="glass p-4 rounded-xl">
        <PanelHeader icon={Folder} title="LIBRARY STRUCTURE" color="text-[#00d4ff]" />

        {loading ? (
          <p className="text-center text-gray-600 text-xs py-4">Loading knowledge base...</p>
        ) : structure ? (
          <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
            {Object.entries(structure).map(([category, files]) => (
              <div key={category} className="bg-[#0a0a0a] rounded-lg border border-[#1a1a1a] overflow-hidden">
                <div className="flex items-center gap-2 p-2 bg-[#111]">
                  <Folder className="w-3 h-3 text-[#00FF9D]" />
                  <span className="text-[10px] font-bold text-gray-300">{category}</span>
                  {category === 'USER_BOOKS' && (
                    <span className="text-[8px] text-[#00FF9D] bg-[#00FF9D]/10 px-1.5 py-0.5 rounded-full font-bold">YOUR BOOKS</span>
                  )}
                </div>
                <div className="p-2 pl-4 space-y-1">
                  {files.map((file, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-[9px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <CheckCircle2 className="w-2.5 h-2.5 text-[#22c55e] shrink-0" />
                        <span className="text-gray-300 truncate">{file.name}</span>
                      </div>
                      <span className="text-[#22c55e] text-[8px] font-bold shrink-0">MASTERED</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center text-gray-600 text-xs py-4">Failed to load structure.</p>
        )}
      </div>
    </div>
  );
}
