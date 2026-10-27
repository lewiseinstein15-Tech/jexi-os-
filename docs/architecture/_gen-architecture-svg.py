#!/usr/bin/env python3
"""Generates JEXI-ARCHITECTURE.svg — layered architecture of JEXI OS."""

W, H = 1600, 2090
MAIN_X, MAIN_W = 60, 1150
RIGHT_X, RIGHT_W = 1240, 310

BG = "#0a0b10"
BAND = "#12141c"
BAND_STROKE = "#262a38"
BOX = "#181b25"
TEXT = "#eef0f6"
MUTED = "#8e94a3"
DIM = "#6f7582"
VIOLET = "#8178ff"
CORAL = "#ff7848"
MINT = "#4fd1a5"
GOLD = "#e8b04b"

out = []
add = out.append

add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="title desc">')
add('<title id="title">JEXI OS architecture</title>')
add('<desc id="desc">A layered architecture: Surfaces, Executive Kernel, Orchestration and Work Graph, '
    'Agent Workforce, Brain and Mind, Tools and MCP, Runtimes. Commands flow down, evidence flows up; '
    'cross-cutting concerns span every layer.</desc>')
add('''<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#08090e"/><stop offset="1" stop-color="#12101a"/>
</linearGradient>
<linearGradient id="bandg" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#141722"/><stop offset="1" stop-color="#101219"/>
</linearGradient>
<linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#8178ff"/><stop offset="1" stop-color="#ff7848"/>
</linearGradient>
<marker id="down" markerWidth="11" markerHeight="11" refX="8" refY="5.5" orient="auto">
  <path d="M0 0L11 5.5L0 11Z" fill="#8178ff"/>
</marker>
<marker id="up" markerWidth="11" markerHeight="11" refX="8" refY="5.5" orient="auto">
  <path d="M0 0L11 5.5L0 11Z" fill="#4fd1a5"/>
</marker>
<marker id="side" markerWidth="10" markerHeight="10" refX="7" refY="5" orient="auto">
  <path d="M0 0L10 5L0 10Z" fill="#e8b04b"/>
</marker>
</defs>''')
add(f'<rect width="{W}" height="{H}" fill="url(#bg)"/>')
add('<circle cx="330" cy="-120" r="420" fill="#6c63ff" opacity=".07"/>')
add('<circle cx="1450" cy="900" r="380" fill="#ff7848" opacity=".05"/>')

FONT = 'font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif"'
MONO = 'font-family="ui-monospace,SFMono-Regular,Menlo,monospace"'


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def band(y, h, num, label, sub, color=VIOLET):
    add(f'<rect x="{MAIN_X}" y="{y}" width="{MAIN_W}" height="{h}" rx="18" fill="url(#bandg)" stroke="{BAND_STROKE}" stroke-width="1.5"/>')
    add(f'<rect x="{MAIN_X}" y="{y}" width="5" height="{h}" rx="2.5" fill="{color}"/>')
    add(f'<text x="{MAIN_X + 26}" y="{y + 34}" fill="{color}" {MONO} font-size="13" font-weight="700" letter-spacing="2">{esc(num)}</text>')
    add(f'<text x="{MAIN_X + 62}" y="{y + 35}" fill="{TEXT}" {FONT} font-size="19" font-weight="700" letter-spacing="1.2">{esc(label)}</text>')
    add(f'<text x="{MAIN_X + 62}" y="{y + 56}" fill="{DIM}" {FONT} font-size="12.5">{esc(sub)}</text>')


def box(x, y, w, h, title, lines, accent=VIOLET):
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{BOX}" stroke="#2b3040" stroke-width="1.2"/>')
    add(f'<rect x="{x}" y="{y}" width="{w}" height="3" rx="1.5" fill="{accent}" opacity=".85"/>')
    add(f'<text x="{x + 16}" y="{y + 28}" fill="{TEXT}" {FONT} font-size="14.5" font-weight="700">{esc(title)}</text>')
    yy = y + 50
    for ln in lines:
        add(f'<text x="{x + 16}" y="{yy}" fill="{MUTED}" {FONT} font-size="12">{esc(ln)}</text>')
        yy += 17


def grid4(band_y, top_off, h, rows, accents=None):
    """rows: list of list-of-4 (title, lines)."""
    x0, gap, n = MAIN_X + 24, 16, 4
    w = (MAIN_W - 48 - gap * (n - 1)) / n
    for r, row in enumerate(rows):
        y = band_y + top_off + r * (h + 14)
        for i, (t, ls) in enumerate(row):
            a = (accents or [VIOLET] * 4)[i % 4] if accents else VIOLET
            box(x0 + i * (w + gap), y, w, h, t, ls, a)


# ---------------- header ----------------
add(f'<text x="{MAIN_X + 12}" y="58" fill="{TEXT}" {FONT} font-size="30" font-weight="800" letter-spacing="3">JEXI OS · SYSTEM ARCHITECTURE</text>')
add(f'<text x="{MAIN_X + 14}" y="86" fill="{MUTED}" {FONT} font-size="14">agentic operating system · Node.js 22 · local-first · v1.2.0</text>')
add(f'<rect x="{MAIN_X + 12}" y="100" width="150" height="4" rx="2" fill="url(#accent)"/>')
add(f'<text x="{W - 40}" y="58" fill="{VIOLET}" {FONT} font-size="13" font-weight="700" text-anchor="end">commands ▼ · evidence ▲</text>')
add(f'<text x="{W - 40}" y="80" fill="{DIM}" {FONT} font-size="12" text-anchor="end">every tool call returns a receipt</text>')

# ---------------- L1 surfaces ----------------
L1 = 128
band(L1, 208, "01", "SURFACES", "clients that submit intent and render the event stream", CORAL)
grid4(L1, 76, 112, [[
    ("Web Console", ["React 18 + Vite SPA / PWA", "chat · missions · graph", "settings · memory · tools"]),
    ("Android APK", ["Capacitor + Firebase FCM", "phone-first surface", "hamburger drawer nav"]),
    ("CLI", ["interfaces/cli/jexi.js", "terminal-driven brain", "install.sh / install.ps1"]),
    ("API · MCP clients", ["open REST + SSE stream", "external ask_jexi endpoint", "mcp-server.js"]),
]], accents=[CORAL, CORAL, CORAL, GOLD])

# ---------------- L2 kernel ----------------
L2 = 382
band(L2, 208, "02", "EXECUTIVE KERNEL", "one control layer: intent, policy, budgets, scheduling, recovery", VIOLET)
grid4(L2, 76, 112, [[
    ("Turn Entry + Intent Gate", ["deterministic fast path first", "regex cascade → 1 LLM classify", "runtime/kernel · daemon"]),
    ("Policy · Budgets · Admission", ["per-task call/token budgets", "admission control, rate limits", "destructive-op authorization"]),
    ("Scheduling · Steering", ["bounded concurrency", "mid-task replan + interrupt", "recovery · retries · breakers"]),
    ("Session + Lifecycle Hooks", ["30-event hook catalog (6 wired)", "PreToolUse · PostToolUse · Stop", "SessionStart · SessionEnd · Compact"]),
]], accents=[VIOLET] * 4)

# ---------------- L3 orchestration ----------------
L3 = 636
band(L3, 306, "03", "ORCHESTRATION · WORK GRAPH", "missions become graphs; nodes are executed, claimed, verified", VIOLET)
grid4(L3, 76, 104, [
    [
        ("Director", ["interpret → plan → staff", "delegate → supervise", "verify → report"]),
        ("Planner", ["schema-validated intent", "team plan, subtasks", "fast-path / fallback"]),
        ("Orchestrator · Lanes", ["SimpleTask · Graph · Director", "dispatch by intent", "agent loop per node"]),
        ("Capability Router", ["intent + query → min tools", "capability-matched routing", "no hardcoded mappings"]),
    ],
    [
        ("WorkGraph", ["nodes · edges · dependsOn", "claims + leases (TTL)", "atomic persist · resume"]),
        ("Scheduler", ["ready-work ordering", "priority desc, createdAt asc", "pause / resume"]),
        ("MissionRunner + Mission", ["state machine CREATED…DONE", "budgets · steering queue", "verification records"]),
        ("Subagents · Swarm", ["SubagentRuntime dispatch", "consensus · hive · topologies", "per-turn narration"]),
    ],
], accents=[VIOLET, VIOLET, VIOLET, CORAL])

# ---------------- L4 workforce ----------------
L4 = 988
band(L4, 200, "04", "AGENT WORKFORCE", "400 agents across 18 divisions, resolved through one registry", MINT)
grid4(L4, 76, 112, [[
    ("Workforce Registry", ["400 agents · 18 divisions", "capability inference", "trust levels"]),
    ("Registry Router", ["resolveAgent by capability", "no hardcoded agent lists", "legacy roster fallback"]),
    ("Prompt Architecture", ["layered constitution", "output-format contracts", "per-agent identity"]),
    ("Identity · Narration", ["JEXI voice from real events", "subagent spawning", "prompt defense baseline"]),
]], accents=[MINT, MINT, VIOLET, MINT])

# ---------------- L5 brain ----------------
L5 = 1234
band(L5, 292, "05", "BRAIN · MIND", "reasoning, context, memory, and the provider fabric", GOLD)
grid4(L5, 76, 96, [
    [
        ("Model Router", ["CapabilityRouter · TaskClass", "FallbackChain · CostOptimizer", "health-ordered walk"]),
        ("Provider Adapters", ["openai · anthropic · google", "groq · mistral · deepseek", "openrouter · ollama"]),
        ("LLMClient", ["one generateContent() seam", "retry + backoff + jitter", "retry-after · quarantine"]),
        ("Provider Registry", ["providers.yaml · models.yaml", "persistent health states", "structured telemetry"]),
    ],
    [
        ("Context Assembly", ["task-scoped assembly", "compaction engine", "memory loadout"]),
        ("Memory", ["hot · knowledge graph", "hybrid search · vector", "conversations · projects"]),
        ("Memory Protocol", ["5 frozen verbs (v1.0)", "envelope · versioning", "conformance suite"]),
        ("Dream Cycle · Evals", ["13 consolidation phases", "BrainBench P@5 / R@5", "self-model · instincts"]),
    ],
], accents=[GOLD, GOLD, GOLD, VIOLET])

# ---------------- L6 tools ----------------
L6 = 1572
band(L6, 200, "06", "TOOLS · MCP", "permission-gated capabilities that reach the world and return receipts", CORAL)
grid4(L6, 76, 112, [[
    ("Tool Registry", ["39 tools · 12 domains", "filesystem · terminal · git", "github · web · memory · lsp"]),
    ("Permission Gate", ["profiles: auto/ask/full", "× safe/medium/risky", "destructive ops gated"]),
    ("MCP Gateway", ["56 servers · 30 enabled", "542 directory tools", "breaker · lazy wake"]),
    ("Executor → Receipts", ["schema-validated I/O", "tool.started / completed", "evidence + provenance"]),
]], accents=[CORAL, CORAL, GOLD, MINT])

# ---------------- L7 runtimes ----------------
L7 = 1818
band(L7, 196, "07", "RUNTIMES · COMPUTER USE", "vision-grounded control of browser, desktop, and sandbox", CORAL)
grid4(L7, 76, 108, [[
    ("Browser Runtime", ["Playwright driver", "16-action vocabulary", "screenshot read-back"]),
    ("Desktop Runtime", ["observe → act → verify", "window / input control", "honest degradation"]),
    ("Sandbox", ["E2B isolated exec", "snapshot materialization", "fixture packages"]),
    ("Android · Remote", ["device bridge (ADB)", "remote worker channel", "FCM push"]),
]], accents=[CORAL, CORAL, VIOLET, CORAL])

# ---------------- flow arrows ----------------
pairs = [(L1 + 208, L2), (L2 + 208, L3), (L3 + 306, L4), (L4 + 200, L5), (L5 + 292, L6), (L6 + 200, L7)]
for i, (bot, nxt) in enumerate(pairs):
    x_dn, x_up = MAIN_X + 470, MAIN_X + 560
    add(f'<line x1="{x_dn}" y1="{bot + 8}" x2="{x_dn}" y2="{nxt - 8}" stroke="{VIOLET}" stroke-width="2.2" marker-end="url(#down)" opacity=".9"/>')
    add(f'<line x1="{x_up}" y1="{nxt - 8}" x2="{x_up}" y2="{bot + 8}" stroke="{MINT}" stroke-width="2.2" marker-end="url(#up)" opacity=".9"/>')
    mid = (bot + nxt) / 2
    add(f'<text x="{x_dn - 12}" y="{mid + 4}" fill="{VIOLET}" {FONT} font-size="11" font-weight="600" text-anchor="end">dispatch</text>')
    add(f'<text x="{x_up + 12}" y="{mid + 4}" fill="{MINT}" {FONT} font-size="11" font-weight="600">evidence</text>')

# ---------------- right column: cross-cutting ----------------
add(f'<rect x="{RIGHT_X}" y="{L1}" width="{RIGHT_W}" height="{L7 + 196 - L1}" rx="18" fill="#101219" stroke="{BAND_STROKE}" stroke-width="1.5" stroke-dasharray="6 5"/>')
add(f'<text x="{RIGHT_X + 20}" y="{L1 + 34}" fill="{GOLD}" {FONT} font-size="16" font-weight="800" letter-spacing="1.4">CROSS-CUTTING</text>')
add(f'<text x="{RIGHT_X + 20}" y="{L1 + 55}" fill="{DIM}" {FONT} font-size="12">spans every layer</text>')
add(f'<line x1="{RIGHT_X + 20}" y1="{L1 + 70}" x2="{RIGHT_X + RIGHT_W - 20}" y2="{L1 + 70}" stroke="#2b3040" stroke-width="1"/>')

items = [
    ("Verification", ["Test / Build / Lint verifiers", "FileState byte compare", "AgentVerifier · auto-verify", "no evidence → no pass"], CORAL),
    ("Evidence · Provenance", ["a receipt per tool call", "HUD event taxonomy", "snapshot-pinned records", "claims vs. what happened"], MINT),
    ("Persistence", ["DATA_DIR JSON (atomic)", "Upstash Redis mirror", "Firebase service account", "hydrate-retry on boot"], VIOLET),
    ("Security", ["permission boundaries", "exec-bridge · shield", "scan pipeline", "owner auth"], CORAL),
    ("Harness", ["parity probes", "30-event hooks catalog", "forge · refine · hardening", "immutable fixtures"], GOLD),
    ("Observability", ["SelfMonitor boot/chat", "per-request metrics", "provider health snapshot", "crash reports"], MINT),
]
rail_top = L1 + 92
rail_bottom = L7 + 196 - 26
heights = [40 + 17 * len(ls) for _, ls, _ in items]
gap = (rail_bottom - rail_top - sum(heights)) / (len(items) - 1)
yy = rail_top
for (title, lines, col), bh in zip(items, heights):
    add(f'<rect x="{RIGHT_X + 18}" y="{yy}" width="{RIGHT_W - 36}" height="{bh}" rx="11" fill="{BOX}" stroke="#2b3040" stroke-width="1.1"/>')
    add(f'<rect x="{RIGHT_X + 18}" y="{yy}" width="3" height="{bh}" rx="1.5" fill="{col}"/>')
    add(f'<text x="{RIGHT_X + 34}" y="{yy + 24}" fill="{TEXT}" {FONT} font-size="13.5" font-weight="700">{esc(title)}</text>')
    ly = yy + 43
    for ln in lines:
        add(f'<text x="{RIGHT_X + 34}" y="{ly}" fill="{MUTED}" {FONT} font-size="11.5">{esc(ln)}</text>')
        ly += 17
    yy += bh + gap

# connector arrows from main column into the cross-cutting rail
for y in (L2 + 104, L4 + 100, L6 + 100):
    add(f'<line x1="{MAIN_X + MAIN_W + 4}" y1="{y}" x2="{RIGHT_X - 6}" y2="{y}" stroke="{GOLD}" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#side)" opacity=".8"/>')

# ---------------- footer ----------------
fy = L7 + 196 + 26
add(f'<text x="{MAIN_X + 12}" y="{fy}" fill="{DIM}" {FONT} font-size="12">'
    'Flow: a surface submits intent → the kernel gates and schedules it → orchestration builds a work graph → '
    'agents reason through the brain and act through gated tools → runtimes touch the world → '
    'receipts and evidence return to the kernel and the transcript.</text>')
add(f'<text x="{MAIN_X + 12}" y="{fy + 22}" fill="{DIM}" {FONT} font-size="12">'
    'Counts are read from this repository: 400 agents · 18 divisions · 39 tools · 12 domains · 1,164 skills · '
    '56 MCP servers · 30 hook events · 5 memory verbs · 13 dream-cycle phases.</text>')

add('</svg>')

svg = "\n".join(out)
with open("JEXI-ARCHITECTURE.svg", "w") as f:
    f.write(svg)
print("wrote JEXI-ARCHITECTURE.svg", len(svg), "bytes")
