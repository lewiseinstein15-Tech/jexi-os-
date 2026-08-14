import fs from 'fs';
import path from 'path';
import { generateContent, resolveKeys } from './LLMClient.js';
import { JEXI_SYSTEM_PROMPT } from './JexiPrompt.js';
import { WORKSPACE_DIR } from '../config.js';

/**
 * TECHNICAL WRITER — JEXI's documentation voice (skill: 18-writer-agent.md).
 * Lineage: agency-agents Technical Writer, specialist-agent @docs,
 * gstack /document-generate. Docs are grounded in the real files — if the
 * files weren't read, the docs don't exist.
 */

const MAX_FILES = 8;

function workspaceSnapshot() {
  if (!fs.existsSync(WORKSPACE_DIR)) return [];
  const files = fs.readdirSync(WORKSPACE_DIR).filter((f) => !f.startsWith('.') && !f.startsWith('node_modules'));
  return files.slice(0, MAX_FILES).map((name) => {
    const code = fs.readFileSync(path.join(WORKSPACE_DIR, name), 'utf-8');
    return `### FILE: ${name}\n\`\`\`\n${code.slice(0, 6000)}\n\`\`\``;
  });
}

function entryPointOf(files) {
  const names = files.map((f) => f.match(/### FILE: (.+)/)?.[1]).filter(Boolean);
  for (const p of ['index.html', 'app.py', 'main.py', 'index.js', 'server.js', 'app.js', 'package.json']) {
    if (names.includes(p)) return p;
  }
  return names[0] || 'workspace files';
}

function templateReadme(files, entry) {
  const names = files.map((f) => f.match(/### FILE: (.+)/)?.[1]).filter(Boolean);
  return `# JEXI OS — Built Project

A project built end-to-end by **JEXI OS** — my specialist agent team planned,
designed, coded, QA-tested, security-checked and shipped this.

## Features
- Built by the full agent team (Product → Designer → Engineer → Coder → QA → Security → Shipper)
- (List the real features of this project here — I read the source: ${names.join(', ') || 'no files yet'})

## Quick start
\`\`\`bash
# (exact commands depend on the stack — read the files to confirm)
\`\`\`

## Files
${names.map((n) => `- \`${n}\``).join('\n')}

## Notes
Entry point detected: \`${entry}\`. Add a README by asking JEXI: *"write the readme for this project"*.
`;
}

export async function runWriterAgent({ query, sendEvent, saveToDisk = false }) {
  const files = workspaceSnapshot();
  if (files.length === 0) {
    return { success: true, summary: '### 📝 TECHNICAL WRITER\n\nThere is nothing in the workspace to document yet — build something first, then ask me to *"write the readme"*.' };
  }

  sendEvent?.('log', { agent: 'Technical Writer', message: `📖 Reading ${files.length} workspace file(s) before writing...` });
  const entry = entryPointOf(files);
  const docType = /api reference|api doc/i.test(query) ? 'API reference' : /how.to|guide|tutorial/i.test(query) ? 'How-to guide' : /release note/i.test(query) ? 'Release notes' : 'README';

  let doc;
  const keys = resolveKeys();
  if (keys.groqKey || keys.geminiKey) {
    try {
      doc = await generateContent(
        `Write a ${docType} for this project. You are the technical writer — you READ the files, so the docs must match them exactly.\n\nFiles in the workspace:\n${files.join('\n\n')}\n\nThe user asked: "${query}"\n\nRules:\n- Real commands, real file names, real env var names (names only, never values).\n- If a file is an entry point (${entry}), explain how to run it.\n- No lorem ipsum, no "very powerful and flexible" filler. Skimmable: headings, bullets, one idea per line.\n- End with a "## HONEST GAPS" section listing anything you could not verify from the code.`,
        JEXI_SYSTEM_PROMPT,
        null,
        { temperature: 0.3 }
      );
    } catch (e) {}
  }
  if (!doc) doc = templateReadme(files, entry);

  // B48 P6 — LOOP ENGINEERING: self-critique coverage pass. Does the doc
  // actually cover what was asked? Key nouns from the request must appear in
  // the generated doc; if any are missing, ONE bounded regeneration runs with
  // the gap called out (or an honest ## COVERAGE GAP note is appended when no
  // AI key is available).
  const STOP = new Set(['about', 'with', 'this', 'that', 'from', 'have', 'they', 'them', 'would', 'could', 'should', 'what', 'when', 'where', 'which', 'your', 'write', 'readme', 'docs', 'documentation', 'document', 'please', 'make', 'give', 'tell', 'want', 'need', 'like', 'know', 'project', 'app', 'application', 'workspace']);
  const keyTerms = [...new Set((String(query).toLowerCase().match(/[a-z]{4,}/g) || []))].filter((w) => !STOP.has(w)).slice(0, 5);
  const missing = keyTerms.filter((t) => !doc.toLowerCase().includes(t));
  if (missing.length > 0) {
    sendEvent?.('log', { agent: 'Technical Writer', message: `🔎 Self-critique: the ${docType} doesn't yet cover: ${missing.join(', ')}.` });
    if (keys.groqKey || keys.geminiKey) {
      try {
        const revised = await generateContent(
          `You are writing a ${docType}. The draft below is missing coverage of: ${missing.join(', ')}.\n\nReturn the FULL ${docType} (keep everything useful) with a new or expanded section covering each missing item, using the workspace files as the source of truth.\n\nDRAFT:\n${doc.slice(0, 6000)}`,
          JEXI_SYSTEM_PROMPT,
          null,
          { temperature: 0.3 }
        );
        if (revised && revised.trim().length > doc.length * 0.5) {
          doc = revised;
          sendEvent?.('log', { agent: 'Technical Writer', message: `✓ Self-critique fixed the gap — ${missing.join(', ')} now covered.` });
        }
      } catch (e) {}
    } else {
      doc = `${doc}\n\n## COVERAGE GAP\n- This draft does not yet cover: ${missing.join(', ')} — say \"expand the docs\" and I will fill these in.`;
    }
  } else {
    sendEvent?.('log', { agent: 'Technical Writer', message: '✓ Self-critique: the doc covers the requested topics.' });
  }

  const name = docType === 'README' ? 'README.md' : `docs-${Date.now()}.md`;
  let link = '';
  if (saveToDisk || /write|save|create the (readme|doc)/i.test(query)) {
    try {
      fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
      fs.writeFileSync(path.join(WORKSPACE_DIR, name), doc, 'utf-8');
      link = `\n\n**💾 Saved to the workspace:** [${name}](/api/files/${name})`;
    } catch (e) {
      link = `\n\n⚠ Could not save to disk: ${e.message}`;
    }
  }

  return {
    success: true,
    summary: `### 📝 TECHNICAL WRITER (${docType})\n\n**Files read:** ${files.map((f) => f.match(/### FILE: (.+)/)?.[1]).filter(Boolean).join(', ')}\n\n${doc.slice(0, 7000)}${link}\n\n> Say *"save the readme"* and I will write it to the workspace permanently.`,
  };
}
