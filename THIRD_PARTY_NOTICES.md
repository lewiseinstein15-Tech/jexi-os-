# THIRD_PARTY_NOTICES.md — Dependency Licenses (Phase 9 F)

Aggregated from `package.json` (repo root) and `server/package.json` — each
dependency's own declared `license` field as installed in `node_modules`.
Nothing here is invented: declarations missing from the installed packages are
explicitly flagged. Generated 2026-09-19 by
`scripts/phase9-f-notices.mjs` (re-runnable).

**Totals: 67 dependencies (root + server, deduped per manifest; 20 dev-only).**

| Group | Count |
|-------|-------|
| MIT | 49 |
| Apache | 12 |
| ISC | 3 |
| COPYLEFT (GPL family) | 1 |
| BSD | 1 |
| OTHER / NON-STANDARD | 1 |

> ## ⚠️ COPYLEFT ALERT — GPL-family licenses present
>
> These licenses can affect distribution of any binary/bundle that
> includes them. Review before shipping:
>
> - **ffmpeg-static** (server) — GPL-3.0-or-later

## MIT — 49

| Package | Version | Scope | Declared license |
|---------|---------|-------|------------------|
| @capacitor-community/file-opener | 8.0.1 | repo root | MIT |
| @capacitor/android | 8.5.0 | repo root | MIT |
| @capacitor/cli | 8.5.0 | repo root | MIT |
| @capacitor/core | 8.5.0 | repo root | MIT |
| @capacitor/filesystem | 8.1.2 | repo root | MIT |
| @capacitor/local-notifications | 8.3.0 | repo root | MIT |
| @capacitor/splash-screen | 8.0.2 | repo root | MIT |
| @capacitor/status-bar | 8.0.3 | repo root | MIT |
| @eslint/js *(dev)* | 10.0.1 | server | MIT |
| @libsql/client | 0.18.0 | server | MIT |
| @modelcontextprotocol/sdk | 1.30.0 | server | MIT |
| @types/react *(dev)* | 18.3.31 | repo root | MIT |
| @types/react-dom *(dev)* | 18.3.7 | repo root | MIT |
| @upstash/redis | 1.38.4 | server | MIT |
| @vitejs/plugin-react *(dev)* | 4.7.0 | repo root | MIT |
| autoprefixer *(dev)* | 10.5.4 | repo root | MIT |
| axios | 1.19.0 | repo root | MIT |
| axios | 1.19.0 | server | MIT |
| cheerio | 1.2.0 | server | MIT |
| concurrently *(dev)* | 10.0.4 | repo root | MIT |
| cors | 2.8.6 | server | MIT |
| eslint *(dev)* | 10.8.1 | server | MIT |
| express | 4.22.2 | server | MIT |
| express-rate-limit | 8.6.2 | server | MIT |
| framer-motion | 12.43.0 | repo root | MIT |
| globals *(dev)* | 17.11.0 | server | MIT |
| html-to-text | 10.0.0 | server | MIT |
| ioredis | 5.11.1 | server | MIT |
| jsdom *(dev)* | 24.1.3 | server | MIT |
| katex | 0.18.1 | repo root | MIT |
| mermaid | 11.16.1 | repo root | MIT |
| natural | 8.1.1 | server | MIT |
| node-fetch | 3.3.2 | server | MIT |
| postcss *(dev)* | 8.5.25 | repo root | MIT |
| react | 18.3.1 | repo root | MIT |
| react *(dev)* | 18.3.1 | server | MIT |
| react-dom | 18.3.1 | repo root | MIT |
| react-dom *(dev)* | 18.3.1 | server | MIT |
| react-markdown | 10.1.0 | repo root | MIT |
| rehype-highlight | 7.0.2 | repo root | MIT |
| rehype-katex | 7.0.1 | repo root | MIT |
| remark-gfm | 4.0.1 | repo root | MIT |
| remark-math | 6.0.0 | repo root | MIT |
| remark-toc | 9.0.0 | repo root | MIT |
| tailwindcss *(dev)* | 3.4.19 | repo root | MIT |
| unpdf | 1.8.0 | server | MIT |
| vite *(dev)* | 5.4.21 | repo root | MIT |
| youtube-transcript | 1.3.1 | server | MIT |
| zod | 4.4.3 | server | MIT |

## Apache — 12

| Package | Version | Scope | Declared license |
|---------|---------|-------|------------------|
| @capacitor-firebase/messaging | 8.4.0 | repo root | Apache-2.0 |
| @google/generative-ai | 0.24.1 | server | Apache-2.0 |
| @mediapipe/tasks-vision | 1.0.1 | repo root | Apache-2.0 |
| @mozilla/readability | 0.6.0 | server | Apache-2.0 |
| firebase | 12.17.1 | repo root | Apache-2.0 |
| groq-sdk | 1.5.0 | server | Apache-2.0 |
| playwright *(dev)* | 1.63.0 | repo root | Apache-2.0 |
| playwright | 1.62.1 | server | Apache-2.0 |
| playwright-core *(dev)* | 1.63.0 | repo root | Apache-2.0 |
| playwright-core *(dev)* | 1.62.1 | server | Apache-2.0 |
| typescript *(dev)* | 5.9.3 | server | Apache-2.0 |
| typescript-language-server *(dev)* | 4.4.1 | server | Apache-2.0 |

## ISC — 3

| Package | Version | Scope | Declared license |
|---------|---------|-------|------------------|
| jsonrepair | 3.15.0 | server | ISC |
| lucide-react | 0.400.0 | repo root | ISC |
| lucide-react *(dev)* | 0.400.0 | server | ISC |

## COPYLEFT (GPL family) — 1

| Package | Version | Scope | Declared license |
|---------|---------|-------|------------------|
| ffmpeg-static | 5.3.0 | server | GPL-3.0-or-later |

## BSD — 1

| Package | Version | Scope | Declared license |
|---------|---------|-------|------------------|
| highlight.js | 11.11.1 | repo root | BSD-3-Clause |

## OTHER / NON-STANDARD — 1

| Package | Version | Scope | Declared license |
|---------|---------|-------|------------------|
| web-push | 3.6.7 | server | MPL-2.0 |

---

Per-source DATA license table: see [DATA_SOURCES.md](DATA_SOURCES.md).
Repository code license (MIT + data carve-out): see [LICENSE](LICENSE).
