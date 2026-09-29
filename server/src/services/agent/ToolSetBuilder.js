/**
 * Building the tool set a turn actually offers.
 *
 * This is where "what can the model call" is decided, and the decision was
 * previously invisible: four separate filters ran in sequence inside the agent
 * loop, each with its own comment, and the only way to know what survived was
 * to read the loop. Two of them could contradict each other — a skill could
 * narrow the set to four tools and the code-mode path could add the whole
 * catalogue back afterwards.
 *
 * It is its own module so the rules can be tested directly, and so the order
 * they run in is stated once, in one place, instead of being implied by
 * vertical position.
 *
 * The order is deliberate:
 *   1. start from the plan's tools
 *   2. add the always-available control tools
 *   3. drop anything with no executable engine  (JEXI-017)
 *   4. add capability-routed MCP servers       (additive; never fatal)
 *   5. intersect with the active skill's set   (JEXI-021 — a hard constraint)
 *   6. cap a coding turn to the coding set     (JEXI-030)
 *   7. re-add code-mode tools last, so they survive 5 and 6
 *
 * Step 7 comes last on purpose: the coding set excludes code mode on
 * purpose, and a loop that can end up offering a model a 400-tool catalogue
 * after claiming to cap it is worse than no cap.
 */
import { buildNativeSchemas, resolveToolDef } from '../ToolRuntime.js';
import { listPluginTools } from '../PluginContext.js';
import { selectMcpToolset } from '../CapabilityRouter.js';
import { isCodingIntent, isCodingToolSchema, CODING_TOOL_PREFIXES } from './CodingLoop.js';
import { activeCodingSkill } from './IntentRouter.js';

/** Control-plane tools a model may always reach, whatever the plan says. */
export const ALWAYS_AVAILABLE = [
  'ask_user_question', 'exit_plan_mode', 'workflow', 'send_message',
  'interrupt_agent', 'get_goal', 'create_goal', 'update_goal',
];

const schemaNameOf = (sc) => String(sc?.name || sc?.function?.name || '').toLowerCase();

/**
 * Assemble the offered schemas for one turn.
 *
 * `emit` is optional; every rule below still applies when it is absent, so the
 * function is testable without an event stream.
 */
export async function buildOfferedTools({ plan, query, codeMode = false, emit = () => {} }) {
  const notes = [];

  /* Chicken-and-egg, and it produced a silent zero.
     `resolveToolDef` can only find `fs_read` / `pytest_run` once the domain
     registry exists, and the domain registry is registered lazily by the first
     dispatch. The tool set is built BEFORE any dispatch — so on a cold start
     every lookup missed, the skill's allowedTools resolved to nothing, and the
     model was handed an empty menu and answered in prose.

     Register the domains here, before anything is resolved. Cheap, idempotent,
     and it makes this function safe to call first thing in a process. */
  try {
    // `../../`, not `../`: this file lives in src/services/agent/, so a single
    // dot-dot resolved to src/services/tools/... which does not exist. The
    // first version swallowed that in a bare catch, so the bootstrap silently
    // did nothing and the tool set came back empty. A silent catch on a
    // correctness-critical step is the problem, not the solution.
    const { domainExecutor } = await import('../../tools/domains/executor.js');
    domainExecutor();
  } catch (e) {
    emit('agent.log', { message: `⚠ domain bootstrap failed: ${e.message} — the offered tool set may be incomplete.` });
  }


  // 1 — what the plan asked for
  // Resolved across registry, plugin AND domain — see `resolveToolDef`. Using
  // the static registry alone dropped every domain tool, which is to say all
  // of the ones a coding turn exists to call.
  const toolDefs = (plan.tools || []).map((slug) => resolveToolDef(slug)).filter(Boolean).slice(0, 12);

  // 2 — mounted plugin tools, which the planner has never seen
  let pluginTools = [];
  try { pluginTools = listPluginTools(); } catch { pluginTools = []; }
  for (const p of pluginTools.filter((p) => p && p.slug && !toolDefs.some((t) => t.slug === p.slug)).slice(0, 8)) {
    toolDefs.push(p);
  }

  // 3 — the control plane
  for (const slug of ALWAYS_AVAILABLE) {
    if (!toolDefs.some((t) => t.slug === slug)) {
      const def = resolveToolDef(slug);
      if (def) toolDefs.push(def);
    }
  }

  // 4 — schemas. This is also where JEXI-017's filter runs: only tools with a
  // registered engine survive.
  let schemas = buildNativeSchemas(toolDefs);
  const planned = toolDefs.length;
  const afterEngine = schemas.length;
  if (afterEngine < planned) {
    notes.push(`${planned - afterEngine} registry-only tool(s) dropped — no executable engine`);
  }

  // 5 — capability-routed MCP servers. Additive and never fatal: a broken
  // router must not take the turn's own tools down with it.
  let mcpCount = 0;
  try {
    const sel = selectMcpToolset(query, plan);
    if (sel.schemas.length) {
      schemas = [...schemas, ...sel.schemas];
      mcpCount = sel.schemas.length;
      emit('agent.log', {
        message: `🔌 Capability routing: ${sel.reason} → offering ${sel.schemas.length} MCP tools (${sel.servers.join(', ')}).`,
      });
    }
  } catch { /* MCP routing is additive — never break the loop */ }

  const coding = isCodingIntent(plan, query);
  let skill = null;
  let withheldCount = 0;

  if (coding) {
    // 6 — the skill's declared tools are a hard constraint
    skill = await activeCodingSkill(query);
    if (skill?.allowedTools?.length) {
      const allow = new Set(skill.allowedTools.map((t) => String(t).toLowerCase()));

      /* An ACTIVE SKILL IS ALSO A REQUEST FOR ITS TOOLS.
         Narrowing alone can only ever remove. If the planner's tool list did
         not happen to include `fs_read` or `pytest_run`, intersecting against
         the skill's declared set produced ZERO tools — the model was handed an
         empty menu, called nothing, and answered in prose while the failing
         test sat untouched. Observed live: "narrowed 36 → 0".

         So the declared tools are RESOLVED and added, then the whole set is
         intersected with them. The skill both supplies its tools and bounds
         them; it can no longer starve the turn it was written to serve. */
      const added = [];
      for (const slug of allow) {
        if (schemas.some((sc) => schemaNameOf(sc) === slug)) continue;
        const def = resolveToolDef(slug);
        if (!def) continue;
        const [schema] = buildNativeSchemas([def]);
        if (schema) { schemas.push(schema); added.push(slug); }
      }

      const before = schemas.length;
      schemas = schemas.filter((sc) => allow.has(schemaNameOf(sc)));

      // A skill that resolves to nothing is a bug, not a policy: the model
      // would silently degrade to prose. Say so loudly.
      if (schemas.length === 0) {
        emit('agent.log', {
          message: `🧩 skill "${skill.slug}" resolved to NO usable tools (allowedTools: ${skill.allowedTools.join(', ')}) — the coding tool set is being applied instead so the turn can still do its work.`,
        });
        schemas = buildNativeSchemas(
          CODING_TOOL_PREFIXES.map((p) => resolveToolDef(p.replace(/_$/, ''))).filter(Boolean),
        ).concat(buildNativeSchemas(
          ['fs_read', 'fs_write', 'fs_edit', 'fs_ls', 'fs_glob', 'fs_grep', 'pytest_run', 'test_run', 'term_execute', 'git_diff', 'git_status']
            .map((s) => resolveToolDef(s)).filter(Boolean),
        ));
      }

      if (before !== schemas.length || added.length) {
        emit('agent.log', {
          message: `🧩 skill "${skill.slug}" active: tool set ${added.length ? `+${added.length} declared (${added.join(', ')}), ` : ''}restricted to its allowedTools — ${schemas.length} tools (${[...allow].join(', ')}).`,
        });
      }
    }

    // 7 — and the coding cap
    const kept = [];
    const withheld = [];
    for (const sc of schemas) {
      if (isCodingToolSchema(sc)) kept.push(sc); else withheld.push(sc);
    }
    if (withheld.length) {
      withheldCount = withheld.length;
      schemas = kept;
      emit('agent.log', {
        message: `🧰 coding tool set: ${kept.length} tools (fs / terminal / test / git), ${withheld.length} withheld from the ${kept.length + withheld.length} offered — say "search the web" to reach them.`,
      });
    }
  }

  // 8 — code mode last, deliberately. It is a power tool: it composes the
  // others, and re-adding it after the cap keeps the cap honest.
  let codeModeTools = [];
  if (codeMode) {
    try {
      const { getCodeModeTools } = await import('../CodeMode.js');
      codeModeTools = getCodeModeTools();
      schemas = [...schemas, ...codeModeTools];
    } catch { /* code mode is optional */ }
  }

  return { schemas, toolDefs, skill, notes, withheldCount, mcpCount, coding, codeModeTools };
}
