import { useState, useEffect, useCallback } from 'react';
import { FolderGit2, Play, ExternalLink, Clock, FileText, RefreshCw } from 'lucide-react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';
import PanelHeader from './PanelHeader';

/**
 * PROJECTS (B128/B129) — the frontend face of JEXI's durable project memory.
 * Every autonomous build is saved as a capsule {slug, name, files, summary,
 * previewUrl, lastQuery, updatedAt}; this screen lists them and lets you
 * CONTINUE any project ("continue the <name>") straight from the chat.
 */

const timeAgo = (t) => {
  if (!t) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export default function ProjectsScreen({ onContinue }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null); // slug of expanded project

  const load = useCallback(async () => {
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/projects`);
      const d = await res.json();
      setProjects(d.projects || []);
    } catch (e) { /* noop */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-20 rounded-lg" />)}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PanelHeader icon={FolderGit2} title="PROJECTS — YOUR BUILDS, REMEMBERED" />
      <div className="rounded-lg border border-brand-line/50 bg-brand-dim/40 px-3 py-2">
        <p className="text-[9px] text-text-secondary leading-snug">
          Every app JEXI builds is saved as a project. From any conversation, say <span className="text-brand">"continue the &lt;project&gt;"</span> — she loads its files, summary and preview and keeps working on it.
        </p>
      </div>

      {projects.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-text-tertiary text-xs">No projects yet — ask JEXI to build something and it will appear here.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {projects.map((p) => (
            <div key={p.slug} className="surface-card p-3">
              <div className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-9 h-9 rounded-lg border border-brand-line/40 bg-brand-dim/30 flex items-center justify-center">
                  <FolderGit2 className="w-4 h-4 text-brand" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-text-primary capitalize flex items-center gap-1.5">
                    {p.name}
                    <span className="text-[8px] text-text-tertiary flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" /> {timeAgo(p.updatedAt)}</span>
                  </p>
                  <p className="text-[10px] text-text-tertiary leading-snug line-clamp-2 mt-0.5">
                    {(p.summary || '').replace(/[#*`>]/g, '').slice(0, 220)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className="text-[8px] text-text-tertiary bg-surface-2 border border-hairline rounded-full px-1.5 py-0.5 flex items-center gap-1">
                      <FileText className="w-2.5 h-2.5" /> {(p.files || []).length} files
                    </span>
                    {p.previewUrl && (
                      <a
                        href={p.previewUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[8px] font-bold text-brand bg-brand-dim/40 border border-brand-line/40 rounded-full px-1.5 py-0.5 flex items-center gap-1 hover:brightness-110"
                      >
                        <ExternalLink className="w-2.5 h-2.5" /> OPEN PREVIEW
                      </a>
                    )}
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => { onContinue && onContinue(`continue the ${p.name}`); }}
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-brand text-[#04140D] text-[9px] font-bold hover:brightness-110"
                    >
                      <Play className="w-2.5 h-2.5" /> CONTINUE
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(open === p.slug ? null : p.slug)}
                    className="mt-1.5 text-[8px] text-text-tertiary hover:text-brand"
                  >
                    {open === p.slug ? '▲ hide files' : '▼ files'}
                  </button>
                  {open === p.slug && (
                    <div className="mt-1 rounded-md bg-surface-2 border border-hairline p-2 max-h-32 overflow-y-auto">
                      {(p.files || []).map((f, i) => (
                        <p key={i} className="text-[9px] font-mono text-text-secondary py-0.5">
                          {typeof f === 'string' ? f : `${f.path || f.name || f}${f.operation ? ` · ${f.operation}` : ''}`}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-center pt-1">
        <button type="button" onClick={load} className="flex items-center gap-1.5 text-[9px] text-text-tertiary hover:text-brand font-bold tracking-wider">
          <RefreshCw className="w-3 h-3" /> REFRESH
        </button>
      </div>
    </div>
  );
}
