/**
 * P11 — SSR harness for the transcript components (SIM-20..23).
 *
 * Bundles the REAL .jsx components with esbuild (CJS, react/react-dom
 * external) and renders them with react-dom/server renderToStaticMarkup —
 * REAL component code, REAL DOM output, no mocks and no copies.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let esbuild = null;
try { esbuild = require(path.join(ROOT, 'node_modules', 'esbuild')); } catch { esbuild = null; }
if (!esbuild) {
  try { esbuild = require('esbuild'); } catch { /* unavailable */ }
}

// CSS imports (katex/highlight styles) must become no-ops in the SSR bundle —
// inlining them breaks the CJS output and the browser handles them anyway.
const cssStubPlugin = {
  name: 'css-stub',
  setup(build) {
    build.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: 'css-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => ({ contents: 'module.exports = {};', loader: 'js' }));
  },
};

const React = require(path.join(ROOT, 'node_modules', 'react'));
const ReactDOMServer = require(path.join(ROOT, 'node_modules', 'react-dom', 'server'));

const bundleCache = new Map();

async function renderComponent(relPath, props) {
  if (!esbuild) throw new Error('esbuild unavailable — cannot SSR the real components');
  const abs = path.join(ROOT, relPath);
  let bundled = bundleCache.get(relPath);
  if (!bundled) {
    const out = await esbuild.build({
      entryPoints: [abs],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      jsx: 'automatic',
      loader: { '.jsx': 'jsx', '.js': 'js' },
      external: ['react', 'react-dom', 'react/jsx-runtime', 'mermaid', 'katex', 'highlight.js'],
      plugins: [cssStubPlugin],
      outfile: path.join(ROOT, '.ssr-cache', `ssr-${relPath.replaceAll(/[^\w]/g, '_')}.cjs`),
      logLevel: 'silent',
      write: true,
    });
    if (out.errors && out.errors.length) throw new Error(`esbuild failed: ${out.errors.map((e) => e.text).join('; ')}`);
    bundled = path.join(ROOT, '.ssr-cache', `ssr-${relPath.replaceAll(/[^\w]/g, '_')}.cjs`);
    bundleCache.set(relPath, bundled);
  }
  delete require.cache[bundled]; // fresh module each render (state resets)
  const Comp = require(bundled).default;
  return ReactDOMServer.renderToStaticMarkup(React.createElement(Comp, props));
}

export { React, renderComponent };
