import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { planner } from './src/services/Planner.js';
import { orchestrator } from './src/services/Orchestrator.js';
import { runSimpleTask } from './src/services/SimpleTask.js'; // B66 — Orchestrator-Workers SIMPLE fast path
import { workerRoster, executeNativeToolCalls } from './src/services/WorkerRouter.js'; // B69/B124 — coworker structure + gated plugin-tool executor for the direct path
import { normalizeFinalAnswer } from './src/services/Formatting.js'; // B66 — normalize every final answer
import { generateContent, resolveKeys, testAllProviders , generateWithToolsLoop } from './src/services/LLMClient.js';
import { learnFromExchange } from './src/services/PreferenceLearner.js';
import { rollingConversationSummary, getRollingSummary } from './src/services/MemoryManager.js';
import {
  recordBoot, recordChat, recordVision, recordError,
  collectSystemStatus, readSourceFile,
} from './src/services/SelfMonitor.js';
import { loadSettings, saveSettings } from './src/services/SettingsManager.js';
import { providerHealthSnapshot } from './src/services/ProviderRouter.js';
// B78 — event-sourced logging: the durable, ordered event log is the source of
// truth for what happened per session (user messages, orchestrator decisions,
// coworker calls/results, tool calls/results, compactions, errors).
import { appendEvent, getEvents, eventLogStats, hydrateEventLogFromRedis } from './src/services/EventLog.js';
import { chatEventLogger } from './src/services/ChatEventLogger.js'; // B78 — /api/chat user_message + error events into the event log
import { AGENT_ROSTER, SKILL_REGISTRY, ROSTER_COUNT, SKILL_COUNT, getAgent } from './src/services/AgentRoster.js';
import { executionModel } from './src/services/Reachability.js';
import { DesktopManager, ensureBrowser, browserStatus, restartBrowser } from './src/services/DesktopManager.js';
import {
  addChat, getChatHistory, clearMemory, updateUserProfile, loadMemory, saveMemory,
  saveInternetKnowledge, saveCodingKnowledge, searchInternetKnowledge, searchCodingKnowledge,
  saveKnowledgeFile, searchKnowledge, getKnowledgeStructure, getKnowledgeStatus,
  hydrateFromRedis, isRedisActive, semanticRecall, backfillEmbeddings,
  resolveConversationalQuery,
  // B66 — per-session conversation memory + persistence probe
  // B68 — redisConnectionInfo for truthful health reporting
  setActiveSession, clearActiveSession, memoryPersistenceProbe, redisConnectionInfo,
} from './src/services/MemoryManager.js';
import { TOOL_REGISTRY } from './src/services/ToolRegistry.js';
import { skillFolder, SKILL_META } from './src/services/SkillChain.js'; // B50 P1 — progressive skill folders
import { getSkillBody, listSkillCatalog, discoverySummary, createUserSkill, invalidateSkillCache, startSkillWatcher, SKILL_NAME_RE } from './src/services/SkillDiscovery.js'; // B98 — dsh-style skill auto-discovery
import { maybeCompact, compactNow, compactionStatus, compactionAwareHistory, isCompactionEvent } from './src/services/CompactionEngine.js'; // B100 — dsh-style compaction of long sessions
import { listSpills, spillStats } from './src/services/SpillStore.js'; // B100 — spilled oversized tool results
import { resolvePreset } from './src/services/PresetManager.js'; // B102 — dsh agent presets (standard/ptc/minimal/creator)
import { buildTrace } from './src/services/SessionTrace.js'; // B102 — per-conversation session trace
import { setRequestTimeZone } from './src/services/TimeContext.js'; // B104 — every LLM call knows the user's date/time (dsh time-context)
import { setJobExecutor } from './src/services/BackgroundJobs.js'; // B106 — model-launched background jobs (dsh tool-jobs)
import { addFeedback, listFeedback, feedbackStats, addCommandFeedback } from './src/services/FeedbackStore.js'; // B106/B132 — message + command feedback
import { registerCommand, listCommands, tryExecuteCommand, helpText } from './src/services/CommandRegistry.js'; // B133 — dsh commands
import { anonymousUserId } from './src/services/AnonymousId.js'; // B133 — dsh anonymous-user-id
import { validateAttachment } from './src/services/AttachmentPolicy.js'; // B133 — dsh attachment policy
import { checkConversationInvariants, invariantStatus } from './src/services/SessionInvariants.js'; // B133 — dsh invariants
import { recentSessionsBlock, exportConversation } from './src/services/SessionConversations.js'; // B106 — session references + export
import { listMarketplace, marketplaceStats, installSkill, uninstallSkill } from './src/services/SkillMarketplace.js'; // B107 — skills marketplace
import { maybeAutoTitle, titleUntitledSweep, setStoredTitle } from './src/services/SessionTitles.js'; // B108 — LLM conversation titles
import { resolveSessionReferences } from './src/services/SessionReference.js'; // B109 — dsh session-reference mentions (@[label](dsh-session:…))
import { setPlanMode, isPlanMode, planModePromptSection, approvePlan, currentPlan, APPROVE_PLAN_RE } from './src/services/PlanMode.js'; // B110/B112 — dsh plan-mode (plan → approve → implement)
import { getPending, takeAnswers, formatAnswers, clearPending, answerPending } from './src/services/PendingQuestions.js'; // B110 — dsh tool-ask-user
import { runRetention } from './src/services/SpillStore.js'; // B104 — spill retention
import { knowledgeStatus, loadProjectKnowledge, knowledgeLoad } from './src/services/KnowledgeBase.js'; // B50 P2 — project knowledge
import { getToolCatalog, TOOL_PROFILES, activeToolProfile, setToolProfile, executeTool, buildNativeSchemas } from './src/services/ToolRuntime.js'; // B124 — plugin tools in the direct path
import { runAgentLoop } from './src/services/AgentLoop.js';
import { listWorkspace, readWorkspace, writeWorkspace, createCheckpoint, listCheckpoints, diffCheckpoint, rollbackCheckpoint } from './src/services/WorkspaceRuntime.js';
import { listProcesses, getProcessLog, startProcess, stopProcess, deleteProcess, onProcessEvent } from './src/services/ProcessManager.js';
import { verifyDomainAnswer, detectDomain, deterministicChecks } from './src/services/DomainVerifier.js';
import { runSubagents, decomposeQuery } from './src/services/SubagentRuntime.js';
import { listHooks, addHook, updateHook, removeHook } from './src/services/HookEngine.js';
import { listPlugins as listRegistryPlugins, togglePlugin } from './src/services/PluginRegistry.js';
import { loadPlugins, setActivePluginContext, getActivePluginContext, listPluginTools, listPluginSkills } from './src/services/PluginContext.js'; // B97 — deepseek-harness-style plugin seam
import { notify, listNotifications, unreadCount, markAllRead, markRead, clearNotifications, setNotifyBroadcaster } from './src/services/NotificationCenter.js';
import { modelRoutingTable, providerPreferenceForIntent } from './src/services/ModelRouting.js';
import { MCP_PORT, MCP_TOOL_ALLOWLIST, listMcpTools } from './mcp-server.js';
import {
  registerConnectors, getConnectorStatus, saveConnectorConfig, callConnector, handleConnectorWebhook, getConnectorToolSchemas, setInboundReplyGenerator,
} from './src/connectors/index.js'; // B56 — connector system (B66 — email reply loop; messaging connector removed)
import { listInbound, listConversations } from './src/services/ConnectorInbox.js'; // B59 — provable inbound webhook log (B62 adds chat-thread conversations)
import { trustStatus, setTrustMode, allowPattern, denyPattern, removeDecision, clearTrust, trustFolder } from './src/services/RiskGuard.js';
import { computerStatus, runtimeCall } from './src/services/ComputerRuntime.js';
import { listTasks, getTask, updateTask, deleteTask, taskStats as taskRegistryStats } from './src/services/TaskRegistry.js';
import { analyzeMessage } from './src/services/ConversationManager.js';
import { activateTaskWorkspace, archiveTaskWorkspace } from './src/services/WorkspaceRuntime.js'; // B53 P2 — per-task workspace isolation
import { decide, applyDecision } from './src/services/DecisionEngine.js';
import { recordDecision, retrieveDecisions, memoryStats as decisionMemoryStats } from './src/services/DecisionMemory.js';
import { metricsSummary, startTrace, endTrace, emitMetric, scoreProviderHealth } from './src/services/ObservabilityAgent.js';
import { scanPromptSafety, forceSafeMode, toolAllowed, blockExplanation, isSafeMode } from './src/services/GuardrailAgent.js';
import { routeDecision, checkLocalBackend } from './src/services/OfflineAgent.js';
import { voiceStatus } from './src/services/VoiceAgent.js';
import { listPlugins as listPluginPackages, pluginSkillSlugs, pluginToolSlugs } from './src/services/PluginAgent.js';
import { listLocks, getWorkspaceId } from './src/services/ConcurrencyAgent.js';
import { chaosEnabled, listInjections } from './src/services/ChaosAgent.js';
import { importBookBuffer, importBookUrl, listBooks, deleteBook } from './src/services/BookLibrary.js';
import { mountMcp } from './mcp-server.js';
import { taskManager } from './src/services/TaskManager.js';
import { taskScheduler } from './src/services/TaskScheduler.js';
import { PORT, WORKSPACE_DIR, DATA_DIR, SERVER_ROOT } from './src/config.js';
import { resolveInside } from './src/services/PathSafety.js'; // security: one path-escape check for every workspace route/writer
import { GoalEngine } from './src/services/GoalEngine.js'; // autonomy: goal-level execution with info-asking + resume
import { rateLimiterStatus } from './src/services/ProviderRateLimiter.js'; // free-tier pacing status
import { touchSession, listSessions } from './src/services/SessionStore.js'; // session registry (isolation observability)
import { appendConversationEvent, listConversations as listSessionConversations, loadConversationEvents, forkConversation, deleteConversation, searchConversations } from './src/services/SessionConversations.js'; // B96 — DSH-style append-only conversation logs
import { JEXI_IDENTITY, IDENTITY_ANSWER, buildCapabilityLines, buildLimitationLines } from './src/services/JexiIdentity.js'; // canonical identity (name / creator / capabilities)
import { JEXI_NORMAL_PROMPT, IDENTITY_QUESTION_RE } from './src/services/JexiPrompt.js'; // B103 — normal-mode prompt + deterministic identity-question detection
import { isDirectIntent } from './src/services/Planner.js'; // B114 — AUTO mode: JEXI decides direct vs agent
import { runDshResearch } from './src/services/DshResearch.js'; // B125 — dsh-style model-driven research (replaces the research team pipeline)
import { runAutonomousCoding } from './src/services/AutonomousCoding.js'; // B126 — dsh-style autonomous coding (replaces the coding team)
import { recordTelemetry, readTelemetry, telemetryStats } from './src/services/Telemetry.js'; // B132 — dsh session-telemetry
import { maybeCheckpoint, listSessionCheckpoints, latestCheckpoint } from './src/services/SessionCheckpoints.js'; // B132 — dsh checkpoint-policy
import { saveProjectCapsule, findProjectCapsule, listProjectCapsules, capsuleContext, normalizeProjectName } from './src/services/ProjectCapsules.js'; // B128 — durable project memory (continue any project from any conversation)
import { setGoalEngine } from './src/services/PromptAssembly.js'; // B119 — goal state in prompts
import { lifecycleUserMessage } from './src/services/SessionLifecycle.js'; // B119 — dsh lifecycle events
import { DoAnythingAgent } from './src/services/DoAnythingAgent.js'; // B89 — free-form autonomous agent loop
import { TravelBookingAgent, parseBookingQuery } from './src/services/TravelBookingAgent.js'; // B90 — browser booking flow
import { aggregateSearch } from './src/services/SearchEngine.js'; // B90 — travel web-search alternatives
import { UniversalLinkAgent } from './src/services/UniversalLinkAgent.js'; // B91 — any link: video/social/article + instruction
import { BuilderAgent } from './src/services/BuilderAgent.js'; // B91 — autonomous project builder → GitHub push
import { enqueueGoal, enqueueChat, enqueueDoAnything, answerJob, getJob as getGoalJob, getJobEvents, subscribe as subscribeJob, listJobs, setGoalExecutor, setChatExecutor, setDoExecutor, setGoalNotifier, hydrateGoalJobsFromRedis } from './src/services/GoalJobQueue.js'; // Phase 2 — durable background goal jobs (B85 — durable chat, B89 — do anything)
import { notifyGoalComplete, setGoalCallConnector, goalReportStats } from './src/services/GoalNotifier.js'; // Phase 4 — goal completion notifications + email reports
import { getVapidPublicKey, addSubscription, removeSubscription, broadcastPush, listSubscriptions, hydratePushSubsFromRedis, recordPushDiag, listPushDiag, hydratePushDiagFromRedis } from './src/services/PushManager.js'; // B84 — web push notifications (closed-app delivery)
import { addFcmToken, removeFcmToken, listFcmTokens, fcmStatus, broadcastFcm, hydrateFcmTokensFromRedis } from './src/services/FcmManager.js'; // B86 — FCM push for the installed APK


// If REDIS_URL is set, pull JEXI's memory core from Redis so she remembers
// everything across restarts/redeploys (non-blocking).
hydrateFromRedis().catch((e) => { recordError('memory', (e && e.message) || String(e)); });
// B78 — the event log uses the SAME Redis-backed persistence as the memory
// core, so the audit trail survives redeploys too (non-blocking hydrate).
hydrateEventLogFromRedis().catch((e) => { recordError('events', (e && e.message) || String(e)); });

// Vector layer (TencentDB-Agent-Memory pattern): embed memories saved before
// the vector layer existed. Non-blocking; no-op without a Groq key.
backfillEmbeddings().catch((e) => { recordError('memory', (e && e.message) || String(e)); });

// Phase 4b — schedules + goal jobs mirror to Redis so they survive redeploys
// on ephemeral-disk hosts (Render free). Non-blocking hydrations.
taskScheduler.hydrateFromRedis().catch((e) => { recordError('schedule', (e && e.message) || String(e)); });
hydrateGoalJobsFromRedis().catch((e) => { recordError('goals', (e && e.message) || String(e)); });

// B97 — PLUGIN SEAM: load plugins (deepseek-harness style) at boot. Plugins
// register tools/skills/events into the shared context; every plugin tool
// runs through the gated ToolRuntime. Reversible: unloading removes effects.
(async () => {
  try {
    const { ctx, loaded, failed } = await loadPlugins({
      services: {
        planner, orchestrator, generateContent, executeTool,
        memory: { loadMemory, saveMemory, semanticRecall },
        conversations: { appendConversationEvent, searchConversations },
      },
    });
    setActivePluginContext(ctx);
    console.log(`[Plugins] ✓ Loaded ${loaded.length} plugin(s)${loaded.length ? ': ' + loaded.map((p) => p.name).join(', ') : ''}${failed.length ? ' | failed: ' + failed.map((f) => f.file).join(', ') : ''}`);
  } catch (e) {
    console.error('[Plugins] boot load error:', e.message);
  }
})();

// B98 — SKILL AUTO-DISCOVERY: watch all skill roots (project/user/bundled)
// so skills added at runtime are picked up without a restart. mtime rescans
// catch anything the watcher misses.
try {
  const n = startSkillWatcher();
  const s = discoverySummary();
  console.log(`[Skills] ✓ Watcher on ${n} root(s); discovered ${s.total} skill(s): ${Object.entries(s.bySource).map(([k, v]) => `${k}=${v}`).join(', ')}`);
} catch (e) {
  console.error('[Skills] watcher start error:', e.message);
}

// B108 — boot sweep: title the most recent untitled conversations in the
// background (bounded; existing chats get smart titles after a redeploy).
titleUntitledSweep({ max: 8 }).then((r) => {
  if (r.titled > 0) console.log(`[Titles] ✓ Auto-titled ${r.titled} conversation(s) at boot`);
}).catch(() => {});

// B104 — SPILL RETENTION (dsh output-retention): spilled files age out
// (7 days) and per-owner budgets cap growth. Runs at boot + hourly.
try {
  const bootRet = runRetention();
  console.log(`[Spills] ✓ Retention ran at boot — deleted ${bootRet.deleted} file(s), freed ${bootRet.freedBytes} bytes`);
  setInterval(() => {
    try { const r = runRetention(); if (r.deleted > 0) console.log(`[Spills] ✓ Retention — deleted ${r.deleted} file(s), freed ${r.freedBytes} bytes`); } catch (e) { /* noop */ }
  }, 60 * 60 * 1000).unref();
} catch (e) {
  console.error('[Spills] retention boot error:', e.message);
}

// B133 — COMMAND REGISTRY: the chat route runs these BEFORE the model.
try {
  registerCommand({ name: 'help', description: 'List every JEXI command.', run: async () => ({ summary: helpText() }) });
  registerCommand({ name: 'plan', description: 'Plan then execute automatically (or /plan off).', run: async (q, c) => ({ summary: 'Use /plan <task> or /plan on — the main chat flow handles it.' }) });
  registerCommand({ name: 'build', description: 'Build an app autonomously.', run: async (q) => ({ summary: 'Send /build <what> — the autonomous coder handles it.' }) });
  registerCommand({ name: 'compact', description: 'Compress this conversation into a checkpoint.', run: async (q, c) => ({ summary: 'The chat flow handles /compact automatically.' }) });
  registerCommand({ name: 'goal', description: 'Start a goal.', run: async (q) => ({ summary: 'Send /goal <what> — the goal engine handles it.' }) });
  registerCommand({ name: 'do', description: 'Do anything with the full toolset.', run: async (q) => ({ summary: 'Send /do <task> — the Do-Anything agent handles it.' }) });
  console.log(`[Commands] ✓ ${listCommands().length} slash command(s) registered`);
} catch (e) { console.error('[Commands] register error:', e.message); }

// B106 — BACKGROUND JOBS: the model's run_in_background tool executes the
// native agent loop in-process; results are collected later with
// jobs_collect (dsh tool-jobs mirror).
setJobExecutor({
  run: async ({ task, session, profile, signal }) => {
    const out = await runAgentLoop({ query: task, sendEvent: () => {}, opts: { profile, spillOwner: session, signal, codeMode: true } });
    return { answer: out.answer };
  },
});
// B86-fix — push device tokens + subscriptions survive redeploys (ephemeral disk).
hydrateFcmTokensFromRedis().catch((e) => { recordError('push', (e && e.message) || String(e)); });
hydratePushSubsFromRedis().catch((e) => { recordError('push', (e && e.message) || String(e)); });
hydratePushDiagFromRedis().catch((e) => { recordError('push', (e && e.message) || String(e)); });

// Self-monitoring: she keeps a live error log and can diagnose her own system.
recordBoot();
process.on('uncaughtException', (e) => { recordError('process', e.message, e.stack); console.error('[FATAL]', e); process.exit(1); });
process.on('unhandledRejection', (e) => { recordError('process', (e && e.message) || String(e)); });

// B56 — register every connector (github / email) from saved
// config + env. Agents reach them through the gated `connector-call`
// tool; providers reach JEXI through /webhooks/connectors/<name>.
registerConnectors();

// B61/B66 — Email auto-reply loop: when a verified inbound email arrives,
// JEXI generates the reply and sends it back automatically via the
// connector's reply() (same thread — Re:, In-Reply-To + References). B62
// made it FAST: Groq leads the provider order and generation is capped at
// 12s — if the LLM is slow or down, a short fallback ack is sent instead of
// silence, so every sender always gets a response.
//
// B66 — creator recognition: email from lewiseinstein15@gmail.com is JEXI's
// creator (Lewis) and gets creator-aware tone/priority in the prompt.
const CREATOR_EMAIL = process.env.JEXI_CREATOR_EMAIL || 'lewiseinstein15@gmail.com';
setInboundReplyGenerator(async (event) => {
  const keys = resolveKeys();
  if (!keys.groqKey && !keys.geminiKey && !keys.openrouterKey && !keys.deepseekKey && !keys.xaiKey) return null;
  const from = String(event.from || '').replace(/^[^<]*<([^>]+)>$/, '$1').trim().toLowerCase();
  const isCreator = from === String(CREATOR_EMAIL).toLowerCase();
  const senderLine = isCreator
    ? 'This message is from LEWIS (lewiseinstein15@gmail.com) — JEXI\'s creator and owner. Treat this as a direct instruction from your creator: respond with appropriate priority and directness, acknowledge their questions/instructions plainly, and do not pad the reply. Safety and approval rules still apply exactly as for any other sender.'
    : `This message is from ${from || 'a sender'} — a regular user. Respond helpfully as JEXI OS.`;
  const prompt = `Reply to this email from ${from || 'the sender'}. Subject: ${String(event.subject || '').slice(0, 200)}\n\n${senderLine}\n\nMessage:\n"${String(event.text || '').slice(0, 1500)}"\n\nReply in plain text (no markdown), max 3 short paragraphs, first person as JEXI. Be concise and directly address the message.`;
  const system = 'You are JEXI OS, an AI operating system owned by Lewis Einstein. Reply in the first person as JEXI. Keep it short, clear, and helpful.';
  try {
    return await Promise.race([
      generateContent(prompt, system, null, { prefer: 'groq', temperature: 0.4 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('reply generation exceeded 12s budget')), 12000)),
    ]);
  } catch (e) {
    // Never leave a sender unanswered — graceful fallback ack (B62).
    return 'Thanks for emailing JEXI OS! I got your message — a proper reply is on the way shortly.';
  }
});

const app = express();

// === API ACCESS CONTROL (optional but recommended for production) ===
// Set JEXI_API_KEY in the host env (Render dashboard) and every AI-spend / data
// endpoint requires the `x-jexi-key` header (the Settings panel has a matching
// field).
//
// FAIL-CLOSED BY DEFAULT (security hardening): a key-less server is remotely
// exploitable — anyone can reach /api/processes (arbitrary shell commands),
// /preview (file reads) and /api/chat (unlimited AI spend). Therefore:
//   - NODE_ENV=production + no key            → the server REFUSES to start.
//   - local dev (no NODE_ENV) + no key        → binds to 127.0.0.1 ONLY.
//   - JEXI_ALLOW_UNLOCKED=1                   → restores the old wide-open
//     behavior (never use on a public host).
const API_KEY = process.env.JEXI_API_KEY || '';
const ALLOW_UNLOCKED = ['1', 'true', 'yes'].includes(String(process.env.JEXI_ALLOW_UNLOCKED || '').toLowerCase());
if (!API_KEY && !ALLOW_UNLOCKED && process.env.NODE_ENV === 'production') {
  console.error([
    '\n[FATAL] JEXI OS refused to start: JEXI_API_KEY is not set and NODE_ENV=production.',
    'A key-less server on the public internet is remotely exploitable (shell access via',
    '/api/processes, file reads via /preview, unlimited AI spend via /api/chat).',
    '',
    'Fix: set JEXI_API_KEY to a strong random string in your host environment, then',
    'restart. (To deliberately run unlocked in production, set JEXI_ALLOW_UNLOCKED=1',
    '— NOT recommended.)',
    '',
  ].join('\n'));
  process.exit(1);
}
const keyMatches = (sent) => {
  if (!API_KEY || !sent) return false;
  const a = Buffer.from(String(sent));
  const b = Buffer.from(API_KEY);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

// CORS: when CORS_ORIGINS is set (comma-separated origins), only browsers from
// those origins may call the API. Unset → open (local dev / curl / mobile).
// The Android/iOS Capacitor app and local dev tools always call from "localhost"
// origins (http://localhost on Android, capacitor://localhost and https://localhost
// on iOS). A remote attacker cannot spoof those — their Origin is their own domain —
// so they are always allowed. Without this, the app is silently CORS-blocked while
// the website works (the classic "website fine, app broken" failure).
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const NATIVE_APP_ORIGINS = ['http://localhost', 'https://localhost', 'capacitor://localhost', 'ionic://localhost'];
const CORS_ALLOWLIST = CORS_ORIGINS.length ? [...new Set([...CORS_ORIGINS, ...NATIVE_APP_ORIGINS])] : true;
app.use(cors({ origin: CORS_ALLOWLIST }));

// Cheap, always-open endpoints the infra + onboarding path needs. Everything
// else under /api/* (chat, vision, knowledge, memory, desktop, settings write,
// APK proxy) is gated when JEXI_API_KEY is set.
// NOTE: mounted on the app root (not '/api') so req.path keeps its full form.
const OPEN_PATHS = ['/api/health', '/api/health/memory', '/api/settings/status', '/api/metrics', '/api/update/apk', '/api/update/version', '/api/events', '/api/identity', '/api/rate/status', '/api/sessions', '/api/goals', '/api/goals/email-stats', '/api/push/vapid-key', '/api/push/fcm-status', '/api/push/diag', '/api/push/fcm-token', '/api/push/fcm-unregister', '/api/push/subscribe', '/api/push/unsubscribe', '/api/conversations', '/api/conversations/search']; // B70 — health/memory + the APK update proxy/version probe are read-only infra (no secrets, no AI spend); a locked backend must stay observable and still deliver app updates. B78 — the event log is GET-only, read-only, sanitized (no raw keys), and the same class of debug surface as the connector inbound log, so it stays open for browser inspection. Goal/identity/rate/sessions are read-only or owner-triggered (POST /api/goals is NOT in this list — it is key-gated like chat).
app.use((req, res, next) => {
  if (!API_KEY || req.method === 'OPTIONS') return next();
  if (!req.path.startsWith('/api')) return next();
  if (OPEN_PATHS.includes(req.path)) return next();
  // B57 — connector status + per-connector health are GET-only, read-only,
  // never return secrets (masked), and fire the real provider call inside the
  // deployed process where the env vars live — same class as /api/health, so
  // they stay open for browser verification with no shell access. Connector
  // sends/config/toggle stay API-key gated.
  if (req.method === 'GET' && (req.path.startsWith('/api/connectors') || req.path === '/api/memory/persistence')) return next();
  if (keyMatches(req.headers['x-jexi-key'])) return next();
  res.status(401).json({ error: 'Unauthorized — this server is locked. Set the JEXI access key in Settings → System.' });
});

// Rate limiting: protects your AI quota from runaway loops / abuse.
const aiLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests — JEXI is throttling to protect your quota. Try again in a minute.' } });
const generalLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false });
app.use(['/api/chat', '/api/vision', '/api/knowledge/search', '/api/agent'], aiLimiter);
app.use('/api', generalLimiter);

// B56 — CONNECTOR WEBHOOKS. Mounted BEFORE express.json because GitHub /
// Resend signatures are HMACs over the RAW request body — parsing it first
// would break verification. Mounted OUTSIDE /api so provider webhooks
// (GitHub, Resend) are not gated by JEXI_API_KEY or the API rate limiter.
// Each provider's POST returns 200 immediately after verification +
// normalization; failures are logged, never fabricated.
const connectorWebhooks = express.Router();
// B57 fix: scope the raw-body parser to the webhook paths ONLY. Unscoped, the
// router-level `type: () => true` consumed EVERY request body on the server
// (including /api/* POSTs), so express.json() below could never parse chat /
// task / connector-call bodies. Webhook HMAC verification still gets the
// untouched raw body; everything else parses normally.
connectorWebhooks.use('/webhooks/connectors', express.raw({ type: () => true, limit: '10mb' }));
const webhookFor = (name) => async (req, res) => {
  let body = null;
  if (req.body && req.body.length) {
    const ct = req.headers['content-type'] || '';
    if (!/multipart\/form-data/i.test(ct)) {
      try { body = JSON.parse(req.body.toString('utf8')); } catch (e) { body = null; }
    }
  }
  let result;
  try {
    result = await handleConnectorWebhook(name, {
      rawBody: req.body ? req.body.toString('utf8') : '',
      headers: req.headers,
      query: req.query,
      body,
    });
  } catch (e) {
    // E.g. a webhook arrives but no secret is configured — answer with a real
    // HTTP status instead of hanging the provider's retry.
    return res.status(500).json({ ok: false, error: (e && e.message) || String(e) });
  }
  if (result.kind === 'handshake') {
    if (result.verified) return res.status(200).send(result.challenge);
    return res.status(403).send(result.reason || 'Verification failed');
  }
  if (result.kind === 'rejected') return res.status(403).json({ ok: false, error: result.error });
  return res.status(200).json({ ok: true, events: result.events || [], verified: true });
};
connectorWebhooks.post('/webhooks/connectors/github', webhookFor('github'));
connectorWebhooks.post('/webhooks/connectors/email', webhookFor('email'));
app.use(connectorWebhooks);

app.use(express.json({ limit: '30mb' })); // Room for base64 book uploads + code files + images
// B78 — record every /api/chat user_message and terminal error into the
// durable event log (mounted before routes; never throws).
app.use(chatEventLogger());

// === MODEL CONTEXT PROTOCOL (MCP) — let Claude Desktop / Cursor / any MCP
// client connect to JEXI's tools and data at /mcp (read-only + ask_jexi only).
mountMcp(app);

// Every instance has its own id (Render injects RENDER_INSTANCE_ID automatically).
// A load balancer can see which instance answered, and you can verify stickiness.
const INSTANCE_ID = process.env.RENDER_INSTANCE_ID || Math.random().toString(36).slice(2, 8);

fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

// === VIRTUAL DESKTOP ROUTES (JEXI's eyes & hands) ===
const dm = new DesktopManager('playwright');

app.get('/api/desktop/coder/screenshot', async (req, res) => {
  try { res.json({ success: true, image: await dm.takeScreenshot('coder') }); }
  catch (e) { recordError('desktop', e.message); res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/desktop/coder/click', async (req, res) => {
  try { await dm.click('coder', req.body.x, req.body.y); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/coder/type', async (req, res) => {
  try { await dm.type('coder', req.body.text); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/coder/press', async (req, res) => {
  try { await dm.pressKey('coder', req.body.key); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/coder/write-file', async (req, res) => {
  try {
    const out = await dm.writeFile('coder', req.body.filename, req.body.content);
    res.json({ success: true, output: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/coder/execute', async (req, res) => {
  try { res.json({ success: true, output: await dm.executeCommand('coder', req.body.command) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// --- New browser actions (JEXI's eyes) ---
app.post('/api/desktop/coder/goto', async (req, res) => {
  try { res.json({ success: true, ...(await dm.goto('coder', req.body.url)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/coder/page-text', async (req, res) => {
  try { res.json({ success: true, text: await dm.pageText('coder') }); }
  catch (e) { res.status(500).json({ error: e.message, text: '' }); }
});

app.post('/api/desktop/coder/click-text', async (req, res) => {
  try { res.json({ success: await dm.clickText('coder', req.body.text) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/desktop/coder/elements', async (req, res) => {
  try { res.json({ success: true, ...(await dm.interactiveMap('coder')) }); }
  catch (e) { res.status(500).json({ error: e.message, elements: [] }); }
});

app.post('/api/desktop/coder/click-index', async (req, res) => {
  try { res.json({ success: true, ...(await dm.clickIndex('coder', req.body.index)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/coder/type-index', async (req, res) => {
  try { res.json({ success: true, ...(await dm.typeIndex('coder', req.body.index, req.body.text)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/coder/scroll', async (req, res) => {
  try { res.json({ success: true, ...(await dm.scroll('coder', req.body.direction)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/coder/back', async (req, res) => {
  try { res.json({ success: true, ...(await dm.back('coder')) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/coder/forward', async (req, res) => {
  try { res.json({ success: true, ...(await dm.forward('coder')) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/coder/screenshot-json', async (req, res) => {
  try { res.json({ success: true, image: await dm.takeScreenshot('coder') }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Stage 19 — UI verification + persistent screenshots.
app.post('/api/desktop/coder/snapshot', async (req, res) => {
  try { res.json({ success: true, snapshot: await dm.snapshot('coder') }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/coder/verify', async (req, res) => {
  try { res.json({ success: true, ...(await dm.verifyChange('coder', req.body && req.body.before)) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/desktop/coder/save-screenshot', async (req, res) => {
  try { res.json(await dm.saveScreenshot('coder')); }
  catch (e) { res.status(500).json({ saved: false, error: e.message }); }
});

app.get('/api/desktop/screenshots', (req, res) => {
  try { res.json({ screenshots: dm.listScreenshots('coder', Number(req.query.limit) || 12) }); }
  catch (e) { res.status(500).json({ screenshots: [] }); }
});

// Serve saved screenshots (used by the Tasks/terminal detail views).
app.get('/api/desktop/screenshots/:file', (req, res) => {
  const safe = String(req.params.file).replace(/[^a-zA-Z0-9._-]/g, '');
  const p = path.join(DATA_DIR, 'screenshots', safe);
  if (!safe || !p.startsWith(path.join(DATA_DIR, 'screenshots'))) return res.status(400).json({ error: 'bad file' });
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'not found' });
  res.sendFile(p);
});

app.get('/api/desktop/status', (req, res) => res.json({ ok: true, ...browserStatus() }));

// Alias under /coder/ — ComputerUseAgent pings this path. Without it the agent
// ALWAYS believed the browser was offline (404) and never attempted real navigation.
app.get('/api/desktop/coder/status', (req, res) => res.json({ ok: true, ...browserStatus() }));
app.post('/api/desktop/coder/status', (req, res) => res.json({ ok: true, ...browserStatus() }));

// Force-restart JEXI's eyes (self-heal button in the Virtual Desktop viewer).
app.post('/api/desktop/restart', async (req, res) => {
  try {
    const result = await restartBrowser();
    res.json({ success: true, ...result });
  } catch (e) {
    recordError('desktop', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// === FILE VIEWER & PREVIEW ENDPOINTS ===
app.get('/api/files/:filename', (req, res) => {
  try {
    // resolveInside throws on any escape (.., absolute, NUL) → 400, never a read.
    const filePath = resolveInside(WORKSPACE_DIR, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(req.params.filename).substring(1);
    res.send(`<!DOCTYPE html><html><head><title>JEXI Workspace - ${req.params.filename}</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{background:#0a0a0a;color:#eee;font-family:monospace;padding:20px;margin:0}h2{color:#00FF9D;font-family:sans-serif}.toolbar{display:flex;gap:10px;margin-bottom:15px;align-items:center}a{color:#00d4ff;text-decoration:none;padding:8px 15px;background:#1a1a1a;border-radius:5px;font-family:sans-serif}a:hover{background:#00d4ff;color:#000}pre{background:#111;padding:15px;border-radius:8px;overflow-x:auto;border:1px solid #333;font-size:14px}.meta{color:#888;font-size:12px;margin-bottom:10px;font-family:sans-serif}</style></head><body><div class="toolbar"><h2>📄 ${req.params.filename}</h2><a href="/">← Back to JEXI</a></div><div class="meta">Type: ${ext} | Size: ${content.length} chars</div><pre><code>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre></body></html>`);
  } catch (e) { res.status(500).send('Error: ' + e.message); }
});

app.get('/preview/:filename', (req, res) => {
  try {
    // resolveInside throws on any escape (.., absolute, NUL) → 400, never a read.
    const filePath = resolveInside(WORKSPACE_DIR, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(req.params.filename).substring(1);
    if (ext === 'html') res.type('text/html');
    else if (ext === 'css') res.type('text/css');
    else if (ext === 'js') res.type('application/javascript');
    else res.type('text/plain');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(content);
  } catch (e) { res.status(500).send('Error: ' + e.message); }
});

app.get('/workspace', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  try {
    let files = [];
    if (fs.existsSync(WORKSPACE_DIR)) {
      files = fs.readdirSync(WORKSPACE_DIR).map(name => {
        const stat = fs.statSync(path.join(WORKSPACE_DIR, name));
        return { name, size: stat.size, modified: stat.mtime };
      });
    }
    res.send(`<!DOCTYPE html><html><head><title>JEXI Workspace</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{background:#0a0a0a;color:#eee;font-family:sans-serif;padding:20px;margin:0}h2{color:#00FF9D}.toolbar{display:flex;gap:10px;margin-bottom:20px;align-items:center}a{color:#00d4ff;text-decoration:none}.file-list{display:grid;gap:10px}.file-item{display:flex;justify-content:space-between;align-items:center;background:#111;padding:15px;border-radius:8px;border:1px solid #222;transition:0.2s}.file-item:hover{border-color:#00FF9D;background:#1a1a1a}.file-item a{color:#fff;text-decoration:none;font-size:16px;flex:1}.file-meta{color:#888;font-size:12px}.empty{text-align:center;color:#666;padding:40px}</style></head><body><div class="toolbar"><h2>📁 JEXI WORKSPACE</h2><a href="/">← Back to JEXI</a></div>${files.length === 0 ? '<div class="empty">No files generated yet.</div>' : `<div class="file-list">${files.map(f => `<div class="file-item"><a href="/api/files/${f.name}">📄 ${f.name}</a><span class="file-meta">${(f.size/1024).toFixed(1)} KB</span></div>`).join('')}</div>`}</body></html>`);
  } catch (e) { res.status(500).send('Error: ' + e.message); }
});

// === SETTINGS ENDPOINTS ===
app.get('/api/settings', (req, res) => res.json(loadSettings()));
app.post('/api/settings', (req, res) => res.json({ success: saveSettings(req.body) }));

// Reports WHERE each credential is configured (env / settings file / none) so the
// Settings panel can show "ACTIVE — from Render environment" instead of an empty
// input. NEVER returns actual key values.
app.get('/api/settings/status', (req, res) => {
  const settings = loadSettings();
  const statusOf = (envVars, settingKey) => {
    const envVal = envVars.map(v => process.env[v]).find(Boolean);
    if (envVal) return { configured: true, source: 'env' };
    if (settings[settingKey]) return { configured: true, source: 'settings' };
    return { configured: false, source: 'none' };
  };
  res.json({
    groq: statusOf(['GROQ_API_KEY'], 'groqKey'),
    gemini: statusOf(['GEMINI_API_KEY'], 'geminiKey'),
    openrouter: statusOf(['OPENROUTER_API_KEY'], 'openrouterKey'),
    huggingface: statusOf(['HF_TOKEN'], 'hfKey'),
    cerebras: statusOf(['CEREBRAS_API_KEY'], 'cerebrasKey'),
    deepinfra: statusOf(['DEEPINFRA_API_KEY'], 'deepinfraKey'),
    mistral: statusOf(['MISTRAL_API_KEY'], 'mistralKey'),
    xai: statusOf(['XAI_API_KEY'], 'xaiKey'),
    deepseek: statusOf(['DEEPSEEK_API_KEY'], 'deepseekKey'), // B66 — coding coworker
    nvidia: statusOf(['NVIDIA_API_KEY'], 'nvidiaKey'), // B75 — no-card free tier
    sambanova: statusOf(['SAMBANOVA_API_KEY'], 'sambanovaKey'), // B75 — no-card free tier
    github: statusOf(['GITHUB_TOKEN', 'GH_TOKEN'], 'githubToken'),
  });
});

// === TOOL RUNTIME (roadmap stage 9 — unified tool runtime) ===
// Catalog: every tool with its schema + permission level. Profiles: how much
// JEXI may auto-run (Auto = safe+medium, Ask = safe only, Full = everything).
app.get('/api/tools', (req, res) => {
  res.json({ tools: getToolCatalog(), profiles: TOOL_PROFILES, activeProfile: activeToolProfile() });
});

app.post('/api/tools/profile', (req, res) => {
  try { res.json({ success: true, ...setToolProfile(req.body.profile) }); }
  catch (e) { res.status(400).json({ success: false, error: (e && e.message) || String(e) }); }
});

// Execute one tool with full gating (permission profile → validation → engine).
// NOTE: the permission profile is a SERVER-side setting — a client-supplied
// `profile` is ignored here. Accepting it from the request body would let
// anyone self-grant "full" and bypass the approval gates for risky/external
// tools.
app.post('/api/tools/execute', async (req, res) => {
  const { slug, args } = req.body || {};
  if (!slug) return res.status(400).json({ ok: false, error: 'No tool slug provided' });
  const result = await executeTool({ slug, args: args || {} });
  res.json(result);
});

// === AGENT LOOP (roadmap stage 12 — tool-calling loop) ===
// Orchestrator v2: plan → generate → call tools → feed results back → final
// answer. Streams agent.plan / agent.log / tool.start / tool.result / agent.done.
app.post('/api/agent', async (req, res) => {
  const { query, image, profile } = req.body || {};
  if (!query || !String(query).trim()) return res.status(400).json({ success: false, error: 'No query provided' });

  // B78 — the incoming request is the first event in the log (source: agent).
  try { appendEvent('user_message', { source: 'agent', image: !!image, text: String(query).slice(0, 2000) }); } catch (e) {}

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  const sendEvent = (type, data) => { try { res.write(JSON.stringify({ type, ...data }) + '\n'); } catch (e) {} };
  const heartbeat = setInterval(() => { try { res.write('{"type":"heartbeat"}\n'); } catch (e) {} }, 10000);

  let finished = false;
  const finish = () => { clearInterval(heartbeat); try { res.end(); } catch (e) {} };
  const deadline = setTimeout(() => {
    if (finished) return;
    finished = true;
    sendEvent('agent.done', { answer: '⏱ The agent loop exceeded its time budget. Ask me to continue.', stats: { error: 'deadline' } });
    finish();
  }, 10 * 60 * 1000);

  try {
    // B104 — user timezone for the agent loop's LLM calls.
    setRequestTimeZone(req.headers['x-jexi-tz']);
    // B102 — preset-aware code mode (default: ptc → code mode on).
    const preset = resolvePreset(String(req.headers['x-jexi-preset'] || '').toLowerCase());
    const codeModeHeader = String(req.headers['x-jexi-code-mode'] || (preset.codeMode ? '1' : '0')).toLowerCase();
    const codeMode = codeModeHeader !== '0' && codeModeHeader !== 'off' && codeModeHeader !== 'false';
    await runAgentLoop({ query, image, profile, sendEvent, opts: { codeMode, presetFlavor: preset.flavor } });
    finished = true;
    clearTimeout(deadline);
    finish();
  } catch (e) {
    if (!finished) {
      finished = true;
      clearTimeout(deadline);
      try { appendEvent('error', { component: 'agent', message: String((e && e.message) || e).slice(0, 400) }); } catch (err) {}
      sendEvent('agent.done', { answer: `The agent loop failed: ${(e && e.message) || e}`, stats: { error: true } });
    }
    finish();
  }
});

// === WORKSPACE RUNTIME (roadmap stage 10 — checkpoints, diffs, rollback) ===
app.get('/api/workspace', (req, res) => {
  res.json({ files: listWorkspace(1000), checkpoints: listCheckpoints() });
});

app.get('/api/workspace/file', (req, res) => {
  try { res.json({ success: true, name: req.query.name, content: readWorkspace(req.query.name) }); }
  catch (e) { res.status(404).json({ success: false, error: (e && e.message) || String(e) }); }
});

app.put('/api/workspace/file', (req, res) => {
  try {
    const { name, content } = req.body || {};
    if (!name) return res.status(400).json({ success: false, error: 'No file name' });
    res.json({ success: true, ...writeWorkspace(name, content) });
  } catch (e) { res.status(400).json({ success: false, error: (e && e.message) || String(e) }); }
});

app.post('/api/workspace/checkpoint', (req, res) => {
  res.json({ success: true, ...createCheckpoint((req.body || {}).label) });
});

app.get('/api/workspace/diff', (req, res) => {
  try { res.json({ success: true, id: req.query.id, diffs: diffCheckpoint(req.query.id) }); }
  catch (e) { res.status(404).json({ success: false, error: (e && e.message) || String(e) }); }
});

app.post('/api/workspace/rollback', (req, res) => {
  try {
    const { id, file } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'No checkpoint id' });
    res.json({ success: true, ...rollbackCheckpoint(id, file || null) });
  } catch (e) { res.status(400).json({ success: false, error: (e && e.message) || String(e) }); }
});

// === PROCESS SUBSYSTEM (roadmap stage 11 — persistent, observable terminal) ===
// Start, list, watch and stop shell processes. Logs are captured server-side
// and survive restarts; running processes are honestly marked interrupted.
const processStreams = new Map(); // id → Set of response writers
onProcessEvent(({ type, ...data }) => {
  if (!data || !data.id) return;
  const writers = processStreams.get(data.id);
  if (!writers) return;
  for (const w of writers) { try { w.write(JSON.stringify({ type, ...data }) + '\n'); } catch (e) {} }
});

app.get('/api/processes', (req, res) => res.json({ processes: listProcesses() }));

app.post('/api/processes', (req, res) => {
  const { command, cwd, label, timeoutMs } = req.body || {};
  if (!command || !String(command).trim()) return res.status(400).json({ success: false, error: 'No command provided' });
  const p = startProcess(String(command).trim(), { cwd, label, timeoutMs });
  res.json({ success: true, process: p });
});

// NDJSON live stream of process.* events (replays existing log first).
app.get('/api/processes/:id/stream', (req, res) => {
  const id = req.params.id;
  const log = getProcessLog(id);
  if (log === null) return res.status(404).json({ success: false, error: 'Process not found' });
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.write(JSON.stringify({ type: 'process.log', id, chunk: log }) + '\n');
  if (!processStreams.has(id)) processStreams.set(id, new Set());
  processStreams.get(id).add(res);
  req.on('close', () => { processStreams.get(id)?.delete(res); if (processStreams.get(id)?.size === 0) processStreams.delete(id); });
});

app.get('/api/processes/:id/logs', (req, res) => {
  const log = getProcessLog(req.params.id);
  if (log === null) return res.status(404).json({ success: false, error: 'Process not found' });
  res.json({ success: true, log });
});

app.post('/api/processes/:id/stop', (req, res) => res.json(stopProcess(req.params.id)));
app.delete('/api/processes/:id', (req, res) => res.json(deleteProcess(req.params.id)));

// === BUILD 47 — CONTEXT / INTELLIGENCE OBSERVABILITY ===
// The task registry + decision memory behind continuation/topic-switch logic.
app.get('/api/context', (req, res) => {
  res.json({
    tasks: listTasks().slice(0, 30),
    taskStats: taskRegistryStats(),
    decisionMemory: retrieveDecisions({ limit: 15 }),
    decisionStats: decisionMemoryStats(),
  });
});
app.post('/api/context/tasks/:id/status', (req, res) => {
  const status = String(req.body && req.body.status || '');
  const t = getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'task not found' });
  if (!['active', 'paused', 'completed', 'failed'].includes(status)) return res.status(400).json({ error: 'bad status' });
  res.json(updateTask(t.id, { status }));
});
app.delete('/api/context/tasks/:id', (req, res) => res.json(deleteTask(req.params.id)));

// === NOTIFICATION CENTER (roadmap stage 23 remainder) ===
// Scheduled-mission completions land here; the UI bell polls this.
app.get('/api/notifications', (req, res) => res.json({ notifications: listNotifications(Number(req.query.limit) || 50), unread: unreadCount() }));
app.post('/api/notifications/read', (req, res) => {
  if (req.body && req.body.id) res.json(markRead(req.body.id));
  else res.json(markAllRead());
});
app.post('/api/notifications/clear', (req, res) => res.json(clearNotifications()));

// === WEB PUSH (B84) — notifications even when the app is closed ===
// Public VAPID key so clients can subscribe (read-only, open like /api/identity).
app.get('/api/push/vapid-key', (req, res) => res.json({ publicKey: getVapidPublicKey(), subject: 'mailto:lewiseinstein15@gmail.com' }));

// Register this device for web push. { endpoint, keys: { p256dh, auth }, ua }
app.post('/api/push/subscribe', (req, res) => {
  const { endpoint, keys, ua } = req.body || {};
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ ok: false, error: 'endpoint + keys.p256dh + keys.auth required' });
  }
  const result = addSubscription({ endpoint, keys, ua });
  res.json(result.ok ? { ok: true, count: result.count } : result);
});

app.post('/api/push/unsubscribe', (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ ok: false, error: 'endpoint required' });
  res.json(removeSubscription(endpoint));
});

// Debug: how many devices are registered (read-only, no secrets).
app.get('/api/push/subscriptions', (req, res) => res.json({ count: listSubscriptions().length }));

// === FCM (B86) — push to the installed Android app even when closed ===
// Register this device's FCM token (from @capacitor-firebase/messaging).
app.post('/api/push/fcm-token', (req, res) => {
  const { token, ua } = req.body || {};
  if (!token || typeof token !== 'string') return res.status(400).json({ ok: false, error: 'FCM token required' });
  const result = addFcmToken(token, ua);
  res.json(result.ok ? { ok: true, count: result.count } : result);
});

app.post('/api/push/fcm-unregister', (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ ok: false, error: 'FCM token required' });
  res.json(removeFcmToken(token));
});

// Status: configured + device count (read-only, no secrets).
app.get('/api/push/fcm-status', (req, res) => res.json(fcmStatus()));

// Client-side push/FCM diagnostics — the app reports on-device failures so
// they are visible here (GET open/read-only; POST is key-gated like other writes).
app.get('/api/push/diag', (req, res) => res.json({ diag: listPushDiag() }));
app.post('/api/push/diag', (req, res) => {
  const { step, error, platform, permission, ua } = req.body || {};
  res.json(recordPushDiag({ step, error, platform, permission, ua }));
});

// === MODEL ROUTING (roadmap stage 24 — per-domain provider preference) ===
// Exposes the intent → provider map; AgentLoop honors it via opts.prefer.
app.get('/api/models', (req, res) => {
  res.json({
    routing: modelRoutingTable(), // legacy preference table (back-compat)
    preferenceFor: (intent) => providerPreferenceForIntent(intent),
    // B69 — the REAL Orchestrator-Workers structure: task type → coworker →
    // exact provider/model chain (WorkerRouter). The UI leads with this.
    workers: workerRoster(),
  });
});

// === RISK GUARD / TRUST (roadmap stage 17) ===
// Argument-level risk classification + folder-trust store; gates tool calls.
app.get('/api/trust', (req, res) => res.json(trustStatus()));
app.post('/api/trust/mode', (req, res) => {
  try { res.json(setTrustMode(String(req.body && req.body.mode || ''))); }
  catch (e) { res.status(400).json({ error: (e && e.message) || String(e) }); }
});
app.post('/api/trust/allow', (req, res) => res.json(allowPattern(req.body || {})));
app.post('/api/trust/deny', (req, res) => res.json(denyPattern(req.body || {})));
app.post('/api/trust/folder', (req, res) => res.json(trustFolder(req.body && req.body.folder)));
app.delete('/api/trust/decision/:id', (req, res) => res.json(removeDecision(req.params.id)));
app.post('/api/trust/clear', (req, res) => res.json(clearTrust()));

// === COMPUTER RUNTIME (roadmap stage 18) ===
// Provider-independent computer layer: local / remote (in-process or VIRTUAL_API) / docker / mock.
app.get('/api/computer/status', (req, res) => res.json(computerStatus()));
app.post('/api/computer/call', async (req, res) => {
  try {
    const { endpoint, payload, provider } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
    res.json(await runtimeCall(String(endpoint), payload || {}, provider));
  } catch (e) {
    res.status(500).json({ error: (e && e.message) || String(e) });
  }
});

// === MCP MANAGEMENT (roadmap stage 20) ===
app.get('/api/mcp/status', (req, res) => {
  res.json({
    mounted: true,
    endpoint: '/mcp',
    port: MCP_PORT,
    // B55 P4 — built-in allowlist + any generic MCP tools attached via
    // registerMcpTool() (each carries its risk tier).
    tools: listMcpTools(),
    allowlist: MCP_TOOL_ALLOWLIST || [],
    docs: 'Any MCP client can connect to /mcp and call the allowlisted tools. Generic MCP tools can be attached via registerMcpTool (EXTERNAL tier only — approval required).'
  });
});

// === CONNECTOR SYSTEM (B56 — github / email; messaging connector removed in B66) ===
// User-initiated sends from the Connectors UI are themselves the human
// approval; agent-initiated sends go through the `connector-call` tool which
// is EXTERNAL-tier and always pauses for ONE explicit approval first.
app.get('/api/connectors', async (req, res) => {
  try { res.json({ connectors: await getConnectorStatus(), tools: getConnectorToolSchemas() }); }
  catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || String(e) }); }
});

// Save connector config (auth keys + enabled). Keys are stored in settings
// and masked in every response; env vars always win at call time.
app.post('/api/connectors/:name/config', (req, res) => {
  try {
    const saved = saveConnectorConfig(req.params.name, req.body || {});
    res.json({ ok: true, connector: saved.name, enabled: saved.enabled, auth: maskConnectorAuth(saved.auth) });
  } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
});

// Toggle a connector on/off without touching its saved keys.
app.post('/api/connectors/:name/toggle', (req, res) => {
  try {
    const enabled = !!(req.body && req.body.enabled);
    const saved = saveConnectorConfig(req.params.name, { enabled });
    res.json({ ok: true, name: saved.name, enabled: saved.enabled });
  } catch (e) { res.status(400).json({ ok: false, error: (e && e.message) || String(e) }); }
});

// Open per-connector health check (GET, read-only, no secrets) — lets the
// owner verify connectors from a browser without shell access; the real
// provider call runs inside this process where the env vars live.
app.get('/api/connectors/:name/health', async (req, res) => {
  try {
    const result = await callConnector(req.params.name, { method: 'health' });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || String(e) }); }
});

// Open inbound log (GET, read-only) — recent verified webhook events + Meta
// handshake records per connector, so live inbound deliveries are provable
// from a browser (same class as the open health endpoints; no secrets).
app.get('/api/connectors/:name/inbound', (req, res) => {
  try {
    res.json({ ok: true, name: req.params.name, ...listInbound(req.params.name, req.query.limit) });
  } catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || String(e) }); }
});

// B62 — open chat-thread conversations (GET, read-only): the same inbox
// grouped per partner with both sides of the exchange (inbound + our replies)
// so the app can render a real chat view.
app.get('/api/connectors/:name/conversations', (req, res) => {
  try {
    res.json({ ok: true, name: req.params.name, ...listConversations(req.params.name, req.query.limit) });
  } catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || String(e) }); }
});

// User-initiated connector action (send / receive / health / authenticate).
// The human clicked the button = the approval for outbound sends.
app.post('/api/connectors/:name/call', async (req, res) => {
  try {
    const { method = 'send', payload = {} } = req.body || {};
    const result = await callConnector(req.params.name, { method, payload });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) { res.status(500).json({ ok: false, error: (e && e.message) || String(e) }); }
});

function maskConnectorAuth(auth = {}) {
  const out = {};
  for (const [k, v] of Object.entries(auth)) {
    out[k] = /token|secret|key|password|private/i.test(k) && v ? `••••${String(v).slice(-4)}` : v;
  }
  return out;
}

// === PLUGIN SYSTEM (roadmap stage 21 — feature bundles) ===
// Built-in plugins contribute agents/skills/tools; toggle them at runtime.
app.get('/api/plugins', (req, res) => res.json({ plugins: listRegistryPlugins() }));
app.post('/api/plugins/:id/toggle', (req, res) => {
  try { res.json({ success: true, ...togglePlugin(req.params.id) }); }
  catch (e) { res.status(400).json({ success: false, error: (e && e.message) || String(e) }); }
});

// B97 — RUNTIME PLUGIN SEAM: what's actually mounted + which live tools/skills
// each plugin contributed (read-only, no secrets).
app.get('/api/plugins/runtime', (req, res) => {
  const ctx = getActivePluginContext();
  res.json({
    ctxActive: !!ctx,
    pluginTools: listPluginTools().map((t) => ({ slug: t.slug, name: t.name, desc: String(t.desc || '').slice(0, 120) })),
    pluginSkills: listPluginSkills().map((sk) => ({ slug: sk.slug, name: sk.name || sk.slug })),
    totalPluginTools: listPluginTools().length,
  });
});

// === HOOK ENGINE (roadmap stage 22 — lifecycle gates) ===
// Hooks fire before/after tools and tasks; only an explicit deny blocks.
app.get('/api/hooks', (req, res) => res.json({ hooks: listHooks() }));
app.post('/api/hooks', (req, res) => {
  try { res.json({ success: true, hook: addHook(req.body || {}) }); }
  catch (e) { res.status(400).json({ success: false, error: (e && e.message) || String(e) }); }
});
app.patch('/api/hooks/:id', (req, res) => {
  try { res.json({ success: true, hook: updateHook(req.params.id, req.body || {}) }); }
  catch (e) { res.status(404).json({ success: false, error: (e && e.message) || String(e) }); }
});
app.delete('/api/hooks/:id', (req, res) => {
  try { res.json({ success: true, ...removeHook(req.params.id) }); }
  catch (e) { res.status(404).json({ success: false, error: (e && e.message) || String(e) }); }
});

// === SUBAGENT RUNTIME (roadmap stage 14 — parallel, cancel, aggregate) ===
// POST /api/subagents  { tasks: [{name, query}], query?: auto-decompose }
// Streams subagent.plan/start/done + subagent.aggregate as NDJSON.
app.post('/api/subagents', async (req, res) => {
  const { tasks, query } = req.body || {};
  let jobs = Array.isArray(tasks) && tasks.length ? tasks : [];
  if (!jobs.length && query) {
    jobs = decomposeQuery(query).map((q) => ({ name: q.slice(0, 40), query: q }));
  }
  if (!jobs.length) return res.status(400).json({ success: false, error: 'Provide tasks or a compound query' });

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  const sendEvent = (type, data) => { try { res.write(JSON.stringify({ type, ...data }) + '\n'); } catch (e) {} };
  const heartbeat = setInterval(() => { try { res.write('{"type":"heartbeat"}\n'); } catch (e) {} }, 10000);
  const finish = () => { clearInterval(heartbeat); try { res.end(); } catch (e) {} };
  try {
    await runSubagents({ tasks: jobs, sendEvent });
    finish();
  } catch (e) {
    sendEvent('subagent.aggregate', { answer: `Subagent run failed: ${(e && e.message) || e}`, counts: { ok: 0, failed: 1 } });
    finish();
  }
});

// === DOMAIN VERIFICATION (roadmap stage 16) ===
// Verify a draft answer against its domain's rules: deterministic structural
// checks always run (no AI), and a domain critic runs when keys are present.
app.post('/api/verify', async (req, res) => {
  const { query, draft, domain, sources } = req.body || {};
  if (!draft || !String(draft).trim()) return res.status(400).json({ success: false, error: 'No draft to verify' });
  const detected = detectDomain(query || '', draft);
  const result = await verifyDomainAnswer({ query: query || '', draft, domain: domain || detected, sources: sources || [] });
  res.json({ success: true, detected, ...result });
});

// === AGENT ROSTER (the 79-specialist catalog + 226-skill registry) ===
// Static catalog — memoized for 60s (stage 27: performance).
let rosterCache = { json: null, at: 0 };
app.get('/api/roster', (req, res) => {
  if (!rosterCache.json || Date.now() - rosterCache.at > 60000) {
    rosterCache = { json: JSON.stringify({ agents: AGENT_ROSTER, skills: SKILL_REGISTRY, agentCount: AGENT_ROSTER.length, skillCount: SKILL_REGISTRY.length }), at: Date.now() };
  }
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.type('json').send(rosterCache.json);
});

// === FIRST-CLASS SKILLS (roadmap stage 13) ===
// The 495-skill registry is user-invocable: browse it (grouped by category,
// searchable), then invoke one — the invoke call resolves the owning agent and
// plan so the UI can announce what will run, and returns a ready-to-send
// query for the pipeline (the "/skill" command, no typing required).
// Skills + tools catalogs are static after boot — memoized (stage 27).
let skillsCache = { json: null, at: 0 };
app.get('/api/skills', (req, res) => {
  if (!skillsCache.json || Date.now() - skillsCache.at > 60000) {
    const groups = {};
    for (const s of SKILL_REGISTRY) { (groups[s.category || 'Other'] ||= []).push(s); }
    const byCategory = Object.entries(groups)
      .map(([category, items]) => ({ category, count: items.length, skills: items }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
    // B50 P1 — progressive-disclosure pipeline skills (folders with SKILL.md +
    // reference.md; planning sees name+description only, body loads on execution).
    const progressiveSlugs = Object.keys(SKILL_META).filter((slug) => !!skillFolder(slug));
    skillsCache = { json: JSON.stringify({ skills: SKILL_REGISTRY, byCategory, total: SKILL_REGISTRY.length, catalogSize: SKILL_COUNT, progressiveSlugs }), at: Date.now() };
  }
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.type('json').send(skillsCache.json);
});

// === B98 — SKILL AUTO-DISCOVERY (deepseek-harness tool-skill mirror) ===
// Ranked roots: project .jexi/skills (100) → .agents/skills (200) →
// plugin skills (300) → user DATA_DIR/skills (400) → bundled server/skills
// (600). SKILL.md folders or flat <name>.md; frontmatter name+description
// required; catalog = metadata only (progressive); body loads on demand.
app.get('/api/skills/discovery', (req, res) => {
  res.json({ ...discoverySummary(), skills: listSkillCatalog() });
});

app.get('/api/skills/discovery/:name', (req, res) => {
  const name = String(req.params.name || '').trim();
  if (!SKILL_NAME_RE.test(name)) return res.status(400).json({ success: false, error: 'invalid skill name' });
  const skill = getSkillBody(name);
  if (!skill) return res.status(404).json({ success: false, error: `skill "${name}" not found` });
  res.json({ success: true, skill });
});

// User-authored skill → DATA_DIR/skills/<name>/ (rank 400) → auto-discovered.
app.post('/api/skills/discovery', (req, res) => {
  try {
    const { name, description, whenToUse, body, reference } = req.body || {};
    const created = createUserSkill({ name, description, whenToUse, body, reference });
    res.status(201).json({ success: true, ...created });
  } catch (e) {
    res.status(400).json({ success: false, error: (e && e.message) || String(e) });
  }
});

// Manual rescan (the watcher normally invalidates on file events).
app.post('/api/skills/discovery/invalidate', (req, res) => {
  invalidateSkillCache();
  res.json({ success: true, ...discoverySummary() });
});

// === B50 P2 — PROJECT KNOWLEDGE (always-on JEXI.md + progressive folders) ===
app.get('/api/knowledge/project', (req, res) => {
  const status = knowledgeStatus();
  const alwaysOn = loadProjectKnowledge();
  const categories = (status.categories || []).map((c) => {
    const loaded = knowledgeLoad(c);
    const head = String(loaded?.md || '').split('\n').find((l) => /^#/.test(l)) || '';
    return { name: c, head: head.replace(/^#+\s*/, '').slice(0, 90), chars: (loaded?.md || '').length };
  });
  res.json({
    alwaysOn: { chars: status.alwaysOn, head: String(alwaysOn).split('\n').find((l) => /^#/.test(l)) || 'Project Knowledge', preview: String(alwaysOn).slice(0, 400) },
    categories,
  });
});

app.get('/api/skills/search', (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  res.json({ results: q ? SKILL_REGISTRY.filter((s) => `${s.name} ${s.desc} ${s.slug} ${s.category}`.toLowerCase().includes(q)).slice(0, 30) : [] });
});

app.post('/api/skills/invoke', async (req, res) => {
  const { slug, task } = req.body || {};
  const skill = SKILL_REGISTRY.find((s) => s.slug === slug);
  if (!skill) return res.status(404).json({ success: false, error: `Unknown skill: ${slug}` });
  const query = `Use your "${skill.name}" skill (${skill.desc}). Task: ${String(task || '').trim() || 'run this skill for me'}`;
  let plan = null;
  try { plan = await planner.analyzeIntent(query); } catch (e) {}
  res.json({
    success: true,
    skill: { slug: skill.slug, name: skill.name, category: skill.category, desc: skill.desc, agent: skill.agent },
    query,
    plan: plan ? { intent: plan.intent, team: plan.teamSlugs || [], steps: plan.steps || [], tools: plan.tools || [] } : null,
  });
});

// === MEMORY CORE ENDPOINTS (JEXI's mind) ===
app.get('/api/memory', (req, res) => res.json(loadMemory()));

// B66 — persistence probe: evidence that memory survives a restart/redeploy
// (previous boot stamps still present in DATA_DIR = persistent disk). GET,
// read-only, no secrets — same class as /api/health.
app.get('/api/memory/persistence', async (req, res) => res.json(await memoryPersistenceProbe()));
app.post('/api/memory/clear', (req, res) => { clearMemory(); res.json({ success: true }); });
app.post('/api/memory/user', (req, res) => { updateUserProfile(req.body); res.json({ success: true }); });

// Stage 15: exportable + editable memory surfaces.
// Export the whole memory core as a downloadable JSON file.
app.get('/api/memory/export', (req, res) => {
  const mem = loadMemory();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="jexi-memory-${stamp}.json"`);
  res.send(JSON.stringify(mem, null, 2));
});

// Delete ONE memory entry: { kind, index } — kind must be a known array field.
const MEMORY_ARRAY_KINDS = ['userFacts', 'chatHistory', 'internetKnowledge', 'codingKnowledge', 'learnedAnswers', 'bookLibrary', 'episodes'];
app.post('/api/memory/delete', (req, res) => {
  const { kind, index } = req.body || {};
  if (!MEMORY_ARRAY_KINDS.includes(kind)) return res.status(400).json({ success: false, error: `Unknown memory kind: ${kind}` });
  const mem = loadMemory();
  const list = mem[kind];
  if (!Array.isArray(list) || index < 0 || index >= list.length) {
    return res.status(400).json({ success: false, error: `Invalid index ${index} for ${kind}` });
  }
  const removed = list.splice(index, 1)[0];
  saveMemory();
  res.json({ success: true, kind, index, removed: String((removed && (removed.fact || removed.topic || removed.question || removed.text)) || '').slice(0, 80) });
});

// Semantic memory search — hybrid vector + keyword recall across everything
// JEXI remembers (TencentDB-Agent-Memory pattern). Requires ?q= (min 3 chars).
app.get('/api/memory/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.json({ query: q, results: [] });
  const results = await semanticRecall(q, { limit: 5 });
  res.json({ query: q, results });
});
app.post('/api/chat/add', (req, res) => {
  try { addChat(req.body.role, req.body.text); res.json({ success: true }); }
  catch (e) { res.json({ success: false }); }
});
// B66 — history is session-scoped (per conversation id), never a shared blob.
app.get('/api/chat/history', (req, res) => {
  setActiveSession(conversationId(req));
  try { res.json(getChatHistory(Number(req.query.n) || 50)); }
  finally { clearActiveSession(); }
});

// B78 — EVENT LOG (event-sourced logging): read the durable, ordered event
// log per session — the source of truth for what happened, in order. GET,
// read-only, sanitized (payloads are truncated, never raw keys) — same class
// as the connector inbound log.
//   GET /api/events?session=X&limit=50&type=orchestrator_decision
app.get('/api/events', (req, res) => {
  try {
    const events = getEvents({ session: req.query.session, type: req.query.type, limit: req.query.limit });
    res.json({ ok: true, count: events.length, events, stats: eventLogStats() });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e && e.message) || String(e) });
  }
});

// === KNOWLEDGE LIBRARY ENDPOINTS ===
app.get('/api/knowledge/structure', (req, res) => res.json(getKnowledgeStructure()));
app.get('/api/knowledge/status', (req, res) => res.json(getKnowledgeStatus()));
app.get('/api/knowledge/search', (req, res) => res.json(searchKnowledge(req.query.query || '')));
app.post('/api/knowledge/save', (req, res) => {
  try {
    const file = saveKnowledgeFile(req.body.category, req.body.filename, req.body.content);
    res.json({ success: true, file });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// === THE USER'S OWN BOOK LIBRARY (PDF / TXT / Markdown → knowledge) ===
app.post('/api/knowledge/books/upload', async (req, res) => {
  try { res.json(await importBookBuffer(req.body || {})); }
  catch (e) { recordError('knowledge', e.message); res.status(400).json({ success: false, error: e.message }); }
});

app.post('/api/knowledge/books/url', async (req, res) => {
  try { res.json(await importBookUrl(req.body || {})); }
  catch (e) { recordError('knowledge', e.message); res.status(400).json({ success: false, error: e.message }); }
});

app.get('/api/knowledge/books', (req, res) => res.json(listBooks()));

app.delete('/api/knowledge/books/:name', (req, res) => {
  try { res.json(deleteBook(req.params.name)); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

app.get('/api/knowledge/books/:name/file', (req, res) => {
  try {
    const file = path.basename(req.params.name); // basename blocks path traversal
    const fp = path.join(DATA_DIR, 'books', file);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Original file not stored (only link-imported books lack a local copy).' });
    res.download(fp, file);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// === APK UPDATE PROXY (in-app updates for the Android app) ===
// GitHub's release-asset server does NOT send CORS headers, so a fetch of the
// APK straight from the app's WebView is blocked by the browser. This route
// streams the newest APK through the backend (CORS is fully open here), so the
// JEXI app can download it into its own storage and open the Android package
// installer directly — no browser download step, no missing install prompt.
const APK_DOWNLOAD_URL = 'https://github.com/lewiseinstein15-Tech/jexi-os-/releases/latest/download/app-debug.apk';

app.get('/api/update/apk', async (req, res) => {
  try {
    const upstream = await axios({
      method: 'GET',
      url: APK_DOWNLOAD_URL,
      responseType: 'stream',
      timeout: 90000,
      maxRedirects: 5,
      headers: { 'User-Agent': 'JEXI-OS-Update/1.0' },
    });
    const len = upstream.headers['content-length'];
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'application/vnd.android.package-archive');
    if (len) res.setHeader('Content-Length', len);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'attachment; filename="app-debug.apk"');
    upstream.data.on('error', (e) => res.destroy(e));
    upstream.data.pipe(res);
  } catch (e) {
    recordError('update', e.message);
    res.status(502).json({ success: false, error: 'Could not fetch the newest APK: ' + e.message });
  }
});

// B70 — version probe for the in-app update checker. The app compares its
// baked-in build tag against the newest GitHub Release; this server-side probe
// is the fallback when api.github.com is rate-limited or unreachable from the
// phone's IP (unauthenticated GitHub API is capped at 60 req/hr). Read-only
// public release metadata — open class. Cached 60s so the phone never hammers
// GitHub through the proxy.
let cachedReleaseVersion = null;
let cachedReleaseVersionAt = 0;
app.get('/api/update/version', async (req, res) => {
  try {
    if (cachedReleaseVersion && Date.now() - cachedReleaseVersionAt < 60000) {
      return res.json(cachedReleaseVersion);
    }
    const upstream = await axios({
      method: 'GET',
      url: 'https://api.github.com/repos/lewiseinstein15-Tech/jexi-os-/releases/latest',
      timeout: 15000,
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'JEXI-OS-Update/1.0' },
    });
    const d = upstream.data || {};
    const tag = String(d.tag_name || '');
    const m = tag.match(/(\d+)/);
    cachedReleaseVersion = { tag, number: m ? parseInt(m[1], 10) : 0, date: d.published_at || null, notes: d.name || '' };
    cachedReleaseVersionAt = Date.now();
    res.json(cachedReleaseVersion);
  } catch (e) {
    res.status(502).json({ error: 'Could not fetch the newest release: ' + (e && e.message) });
  }
});

// === CHAT API ===
// === VISION ENDPOINT (JEXI's camera eyes) ===
// Accepts a base64 image from the user's webcam and asks the AI to describe it.
// Works with either a Groq (llama-4-scout is multimodal) or Gemini key.
app.post('/api/vision', async (req, res) => {
  try {
    const { image, prompt } = req.body;
    recordVision();
    if (!image) return res.status(400).json({ success: false, error: 'No image provided' });
    const { groqKey, geminiKey } = resolveKeys();
    if (!groqKey && !geminiKey && !process.env.OPENROUTER_API_KEY) {
      return res.status(400).json({ success: false, error: 'No AI keys configured. Add GROQ_API_KEY, GEMINI_API_KEY or OPENROUTER_API_KEY (Render env or Settings).' });
    }
    const text = await generateContent(
      prompt || 'Describe what you see in this image in 2-3 warm sentences.',
      'You are JEXI OS, created by Lewis Einstein (an AI & ML Engineer). You now have eyes through the user\'s camera. ' +
      'Describe what you see warmly and precisely: who or what is in frame, expressions, lighting, surroundings. ' +
      'Be honest if the image is unclear or if no face is visible. Keep it natural and short (2-4 sentences).',
      image,
      // prefer Gemini first — its vision (gemini-2.5-flash) is far sharper than
      // Groq's llama-4-scout, and it is a key the user already has. Seed-family
      // vision (via OpenRouter) is tried last when OPENROUTER_API_KEY is set.
      { prefer: 'gemini', temperature: 0.5 }
    );
    res.json({ success: true, text });
  } catch (e) {
    recordError('vision', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// --- CONTINUATION MEMORY ---
// Lets a follow-up "yes / go ahead / do it" RESUME the user's original task
// instead of re-planning the bare confirmation (which matched no intent and
// made JEXI fall into research — "she searched again" instead of acting).
// The original request is kept for ~15 minutes so conversations flow naturally:
//   user: "I want to track my water intake" → JEXI offers to build it
//   user: "yes"                            → JEXI builds the app (resumes task)
//   user: "no / never mind"                → pending task cleared, no search
// P5/P9 — conversation-scoped store replaces the old module-level singleton,
// so concurrent chats from different users/sessions never race.
import { saveOffer, loadOffer, clearOffer, saveRun, loadRun, clearRun, saveResult, loadResult, clearResult, recordRecoveryEvent } from './src/services/SessionStore.js';
import { preferencesBlock } from './src/services/PreferenceLearner.js';
const RESUME_TTL_MS = Number(process.env.RESUME_TTL_MS) || 45 * 60 * 1000; // B105 — "continue" works for long tasks (was 15min)

/** Trivial small talk — never feed the fact/preference loadout to the planner
 * for greetings/thanks (Build 48, P2: the root cause of fabricated-memory
 * answers is irrelevant memory reaching the model). Same rule as the
 * orchestrator's conversationContext. */
const TRIVIAL_QUERY_RE = /^(hi+|hii+|hey+|hello+|yo+|hiya+|howdy+|good (morning|afternoon|evening)|what'?s up|sup|how (are|r) you|thanks|thank you|thx|ty|ok+|okay+|k+|kk+|yes+|yeah+|yep+|yup+|sure+|alright|right|cool|nice|great|bye+|goodbye|see (ya|you)|later|no+|nope+|haha|lol)\b[\s.,!?]*$/i;

/**
 * P6 — build the compact memory slice the PLANNER sees before classifying:
 * profile facts, user facts, learned preferences, and semantic recall hits.
 * Best-effort; never blocks planning. (Memory is still injected per-specialist
 * later by the orchestrator's memoryRead node — this is the pre-planner slice.)
 */
async function buildPlannerMemory(query) {
  const mem = loadMemory();
  const parts = [];
  const trivial = TRIVIAL_QUERY_RE.test(String(query || '').trim());
  if (!trivial) {
    const profile = mem.userProfile || {};
    if (profile.name) parts.push(`User's name: ${profile.name}`);
    if (profile.location) parts.push(`User's location: ${profile.location}`);
    const facts = (mem.userFacts || []).slice(0, 4)
      .map((f) => (typeof f === 'string' ? f : (f && (f.fact || f.text)) || ''))
      .filter(Boolean);
    if (facts.length) parts.push(`Known facts: ${facts.join(' | ')}`);
    try {
      const prefs = preferencesBlock(3);
      if (prefs) parts.push(prefs);
    } catch (e) {}
  }
  try {
    if (!trivial && String(query || '').trim().length > 3) {
      const learned = await semanticRecall(query, { limit: 2, noCode: true }); // B53 P5 — planner sees preferences/facts, never another task's code
      if (learned.length) {
        parts.push('Prior knowledge: ' + learned.map((l) => `${l.label}: ${String(l.text).slice(0, 180)}`).join(' | '));
      }
    }
  } catch (e) {}
  return parts.join('\n');
}

/** Stable per-conversation id: explicit header wins, else the client address.
 *  Sanitized so a crafted header can never create odd session keys, and every
 *  touch is recorded in the session registry (isolation observability). */
function conversationId(req) {
  const raw = String(req.headers['x-jexi-session'] || req.headers['x-forwarded-for'] || req.ip || 'default');
  const clean = raw.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64) || 'default';
  touchSession(clean);
  return clean;
}

const CONFIRM_RE = /^(yes|yeah|yep|yup|sure|ok|okay|k|go ahead|do it|do that|do it now|please|please do|yes please|absolutely|alright|alrighty|proceed|sounds good|fine|make it|build it|go on|sure do it|yes do it)\b[\s.,!?]*$/i;
const DECLINE_RE = /^(no|nope|never ?mind|cancel|stop|forget it|skip|don'?t|no thanks)\b[\s.,!?]*$/i;

// === GOAL ENGINE (autonomy) — goal-level execution with info-asking ===
const goalEngine = new GoalEngine({
  planner,
  orchestrator,
  generateContent,
  store: { saveRun, loadRun, clearRun },
});
// Phase 2 — goals run as durable background jobs (survive restarts).
setGoalExecutor(goalEngine);
setGoalEngine(goalEngine); // B119 — goal state renders into prompts (dsh goal section)
// Phase 4 — when a goal finishes, JEXI notifies (bell) and emails the report
// when GOAL_REPORT_EMAIL / Settings → goalReportEmail is set.
setGoalNotifier(notifyGoalComplete);
setGoalCallConnector(callConnector);
// B85 — durable chat: long chat tasks run on the same queue as goals, so
// they survive restarts; confirmations park the job and a reply in chat
// resumes it (RunState persisted via SessionStore, same as the sync path).
setDoExecutor({
  run: async ({ task, session, sendEvent }) => {
    const agent = new DoAnythingAgent({ generateContent, executeTool });
    return agent.run({ task, session, sendEvent });
  },
});
// B90 — the booking agent uses the real browser (DesktopManager) + web search.
const travelBookingAgent = new TravelBookingAgent({
  desktopManager: dm,
  webSearch: async (q) => {
    try {
      const r = await aggregateSearch(q);
      return (r && r.results) || [];
    } catch { return []; }
  },
});
// B91 — universal link agent: videos (frame-by-frame + transcript), social
// (browser), articles (deep-read) — then applies the user's instruction.
const universalLinkAgent = new UniversalLinkAgent({
  analyzeVideo: async (url, ev) => {
    const { analyzeVideo } = await import('./src/services/VideoAnalyzer.js');
    return analyzeVideo(url, ev);
  },
  readPage: async (url) => {
    const { analyzeLink, extractContent } = await import('./src/services/Extractor.js');
    try {
      const r = await analyzeLink(url);
      return { title: r.title, text: r.content || r.text || '' };
    } catch {
      // Lenient fallback (plain fetch + readability, JS off).
      const r = await extractContent(url);
      return { title: r.title, text: r.content || r.text || '' };
    }
  },
  generateContent,
});
// B91 — autonomous builder: plan → write → run → fix (loop+graph) → GitHub.
const builderAgent = new BuilderAgent({
  planProject: async (q) => (await import('./src/services/Architect.js')).planProject(q),
  runFile: async (name, onOut) => (await import('./src/services/Runner.js')).runFile(name, onOut),
  fixError: async (q, err) => (await import('./src/services/Architect.js')).applyFix(q, err),
  generateContent,
});
// Pending builder sessions (token/repo ask → resume): session → build context.
const pendingBuilds = new Map();
setChatExecutor({
  run: async ({ query, session, sendEvent }) => {
    let paused = false;
    const plan = await planner.analyzeIntent(query, {});
    const opts = {
      onPause: async (pausedState) => {
        paused = true;
        saveRun(session, { plan, query, state: pausedState });
      },
    };
    const results = plan.complexity === 'SIMPLE'
      ? await runSimpleTask(plan, query, sendEvent, opts)
      : await orchestrator.executePlan(plan, query, sendEvent, opts);
    return paused ? { ...results, paused: true } : results;
  },
  resume: async ({ session, answer, sendEvent }) => {
    const entry = loadRun(session);
    if (entry && entry.state && entry.plan) {
      const resumed = await orchestrator.executePlan(entry.plan, entry.query, sendEvent, { resumeState: entry.state, confirmed: true });
      clearRun(session);
      return resumed;
    }
    return { success: false, error: 'No paused chat task found in this session.' };
  },
});
// B84/B86 — every notification pushes to web-push devices AND FCM (installed APK).
setNotifyBroadcaster((n) => {
  broadcastPush(n.title, n.body, n.link).catch(() => {});
  broadcastFcm(n.title, n.body, n.link).catch(() => {});
});

// GET /api/goals — durable goal job records (read-only, no secrets).
app.get('/api/goals', (req, res) => res.json({ goals: listJobs() }));

// GET /api/goals/email-stats — observable record of every goal-report email
// send (read-only, no secrets — lets the owner verify deliveries).
app.get('/api/goals/email-stats', (req, res) => res.json(goalReportStats()));

// GET /api/goals/:id — one goal job record.
app.get('/api/goals/:id', (req, res) => {
  const g = getGoalJob(String(req.params.id).slice(0, 80));
  if (!g) return res.status(404).json({ error: 'goal not found' });
  res.json({ goal: g });
});

// GET /api/goals/:id/stream — live NDJSON stream for a goal job. Replays the
// persisted event log, then streams new events; closes when the job finishes.
app.get('/api/goals/:id/stream', (req, res) => {
  const id = String(req.params.id).slice(0, 80);
  // Headers FIRST — subscribeJob replays the persisted log synchronously and
  // a write before setHeader would throw ERR_HTTP_HEADERS_SENT.
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  const sendEvent = (event) => { try { res.write(JSON.stringify(event) + '\n'); } catch (e) {} };
  const sub = subscribeJob(id, sendEvent);
  if (!sub.ok) return res.status(404).json({ error: sub.error });
  if (sub.finished) return res.end();
  const heartbeat = setInterval(() => { try { res.write('{"type":"heartbeat"}\n'); } catch (e) {} }, 10000);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearInterval(poll);
    try { if (sub.unsubscribe) sub.unsubscribe(); } catch (e) {}
    try { res.end(); } catch (e) {}
  };
  const poll = setInterval(() => {
    const j = getGoalJob(id);
    if (j && (j.status === 'done' || j.status === 'failed')) close();
  }, 2000);
  req.on('close', close);
  const j0 = getGoalJob(id);
  if (j0 && (j0.status === 'done' || j0.status === 'failed')) close();
});

// POST /api/goals — enqueue an autonomous goal. Returns { ok, jobId }
// immediately (202); the worker runs it in the background and the job
// survives restarts. autonomy: 'ask' (pause at confirmations, default) |
// 'full' (preflight questions once, then run end-to-end).
app.post('/api/goals', (req, res) => {
  const { goal, autonomy, mode } = req.body || {};
  if (!goal || !String(goal).trim()) return res.status(400).json({ success: false, error: 'No goal provided' });
  const convId = conversationId(req);
  const { id } = enqueueGoal({ goal: String(goal).trim(), session: convId, autonomy: String(autonomy || 'ask').toLowerCase(), mode: String(mode || 'agent').toLowerCase() });
  res.status(202).json({ ok: true, jobId: id, status: 'queued', stream: `/api/goals/${id}/stream` });
});

// === FILE UPLOADS (B91) — users can attach any file (not just photos) ===
// POST /api/upload  { name, data(base64) } → { id, name, size, kind, preview }
// Files land in DATA_DIR/uploads; chat attachments reference the id.
app.post('/api/upload', async (req, res) => {
  try {
    const { name, data } = req.body || {};
    const safeName = String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    if (!data || typeof data !== 'string') return res.status(400).json({ ok: false, error: 'No file data (base64 string)' });
    // B133 — attachment policy: validate BEFORE storage (type allowlist, executables blocked).
    const v = validateAttachment({ name: safeName, data, size: Math.floor(Buffer.byteLength(data, 'base64')) });
    if (!v.ok) return res.status(400).json({ ok: false, error: v.error });
    const buf = Buffer.from(data, 'base64');
    if (buf.length > 25 * 1024 * 1024) return res.status(400).json({ ok: false, error: 'File too large (max 25 MB)' });
    fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(path.join(DATA_DIR, 'uploads', `${id}-${safeName}`), buf);
    const ext = path.extname(safeName).toLowerCase();
    let kind = 'text';
    let preview = '';
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
      kind = 'image';
      preview = `[image ${safeName} — use vision to analyze it]`;
    } else if (ext === '.pdf') {
      try {
        const { extractPdfText } = await import('./src/services/Extractor.js');
        preview = String(await extractPdfText(buf)).slice(0, 4000);
        kind = 'pdf';
      } catch { kind = 'pdf'; preview = '[pdf — could not extract text (scanned?)]'; }
    } else {
      preview = buf.toString('utf-8').slice(0, 4000);
    }
    res.json({ ok: true, id, name: safeName, size: buf.length, kind, preview: preview.slice(0, 4000) });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e && e.message) || String(e) });
  }
});

// === TRAVEL BOOKING (B90) — search flights/hotels, present ranked options ===
app.post('/api/travel/search', async (req, res) => {
  const { query, selected } = req.body || {};
  if (!query || !String(query).trim()) return res.status(400).json({ success: false, error: 'No query provided' });
  const convId = conversationId(req);
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  const sendEvent = (type, data) => { try { res.write(JSON.stringify({ type, ...data }) + '\n'); } catch (e) {} };
  const heartbeat = setInterval(() => { try { res.write('{"type":"heartbeat"}\n'); } catch (e) {} }, 10000);
  const finish = () => { clearInterval(heartbeat); try { res.end(); } catch (e) {} };
  try {
    const out = await travelBookingAgent.run({ query: String(query).trim(), session: convId, sendEvent, opts: { selected } });
    if (out.needInfo && out.needInfo.length) {
      sendEvent('travel.need-info', { questions: out.needInfo });
      sendEvent('done', { success: true, parked: true, summary: `### 📋 One quick thing\n\n${out.needInfo.map((q, i) => `${i + 1}. **${q.question}**`).join('\n')}` });
    } else {
      sendEvent('done', { success: out.success !== false, summary: normalizeFinalAnswer(out.summary || ''), options: out.options || [], selected: out.selected || null });
    }
  } catch (e) {
    sendEvent('done', { success: false, summary: `### ⚠ JEXI OS\n\n${e.message}` });
  }
  finish();
});

// === DURABLE CHAT (B85) ===
// POST /api/chat/async — run a chat task as a durable background job.
// Returns { ok, jobId } immediately; stream events via
// GET /api/chat/async/:id/stream; a reply in /api/chat resumes a parked job.
app.post('/api/chat/async', (req, res) => {
  const { query } = req.body || {};
  if (!query || !String(query).trim()) return res.status(400).json({ success: false, error: 'No query provided' });
  const convId = conversationId(req);
  const { id } = enqueueChat({ query: String(query).trim(), session: convId });
  res.status(202).json({ ok: true, jobId: id, status: 'queued', stream: `/api/chat/async/${id}/stream` });
});

app.get('/api/chat/async/:id/stream', (req, res) => {
  const id = String(req.params.id).slice(0, 80);
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  const sendEvent = (event) => { try { res.write(JSON.stringify(event) + '\n'); } catch (e) {} };
  const sub = subscribeJob(id, sendEvent);
  if (!sub.ok) return res.status(404).json({ error: sub.error });
  if (sub.finished) return res.end();
  const heartbeat = setInterval(() => { try { res.write('{"type":"heartbeat"}\n'); } catch (e) {} }, 10000);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearInterval(poll);
    try { if (sub.unsubscribe) sub.unsubscribe(); } catch (e) {}
    try { res.end(); } catch (e) {}
  };
  const poll = setInterval(() => {
    const j = getGoalJob(id);
    if (j && (j.status === 'done' || j.status === 'failed')) close();
  }, 2000);
  req.on('close', close);
  const j0 = getGoalJob(id);
  if (j0 && (j0.status === 'done' || j0.status === 'failed')) close();
});

// POST /api/goals/:id/info — answer a parked goal's questions. Streams the
// resumed run as NDJSON (or use /api/chat — a message in the goal's session
// is auto-routed to the parked goal).
app.post('/api/goals/:id/info', (req, res) => {
  const { answer } = req.body || {};
  const id = String(req.params.id).slice(0, 80);
  if (!answer || !String(answer).trim()) return res.status(400).json({ ok: false, error: 'No answer provided' });
  const ack = answerJob(id, String(answer).trim());
  if (!ack.ok) return res.status(400).json(ack);
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  const sendEvent = (type, data) => { try { res.write(JSON.stringify({ type, ...data }) + '\n'); } catch (e) {} };
  const heartbeat = setInterval(() => { try { res.write('{"type":"heartbeat"}\n'); } catch (e) {} }, 10000);
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearInterval(poll);
    try { if (sub.unsubscribe) sub.unsubscribe(); } catch (e) {}
    try { res.end(); } catch (e) {}
  };
  const sub = subscribeJob(id, sendEvent, { replay: false });
  const poll = setInterval(() => {
    const j = getGoalJob(id);
    if (j && (j.status === 'done' || j.status === 'failed')) finish();
  }, 1500);
  req.on('close', finish);
});

// GET /api/identity — who JEXI is, who built her, what she can do (read-only,
// generated from the live registries, always available even with no AI key).
app.get('/api/identity', (req, res) => {
  res.json({
    name: JEXI_IDENTITY.name,
    fullName: JEXI_IDENTITY.fullName,
    tagline: JEXI_IDENTITY.tagline,
    createdBy: JEXI_IDENTITY.createdBy,
    createdByTitle: JEXI_IDENTITY.createdByTitle,
    counts: { agents: ROSTER_COUNT, skills: SKILL_COUNT, tools: TOOL_REGISTRY.length },
    capabilities: buildCapabilityLines(),
    limitations: buildLimitationLines(),
    autonomy: ['ask', 'full'],
    answer: IDENTITY_ANSWER,
  });
});

// GET /api/rate/status — free-tier pacing status (read-only, no secrets).
app.get('/api/rate/status', (req, res) => res.json(rateLimiterStatus()));

// GET /api/sessions — which conversations exist and when they were active
// (read-only; proves per-session history is never mixed).
app.get('/api/sessions', (req, res) => res.json({ sessions: listSessions() }));

// === CONVERSATIONS (B96 — DSH-style session model) ===
// List all conversations with titles + activity (read-only).
app.get('/api/conversations', (req, res) => res.json({ conversations: listSessionConversations() }));

// Search across ALL conversations (read-only).
app.get('/api/conversations/search', (req, res) => {
  const q = String(req.query.q || '');
  res.json({ query: q, results: searchConversations(q, { limit: Number(req.query.limit) || 5 }) });
});

// One conversation's full event log (read-only).
app.get('/api/conversations/:id', (req, res) => {
  const id = String(req.params.id).slice(0, 80);
  const events = loadConversationEvents(id, Number(req.query.limit) || 500);
  res.json({ id, events });
});

// B100 — compaction status for one conversation (pressure + last checkpoint).
app.get('/api/conversations/:id/compact/status', (req, res) => {
  const id = String(req.params.id).slice(0, 80);
  res.json(compactionStatus(id));
});

// B100 — force compaction now (dsh compactNow / the app's COMPACT button).
app.post('/api/conversations/:id/compact', async (req, res) => {
  const id = String(req.params.id).slice(0, 80);
  try {
    const r = await compactNow(id);
    if (!r) return res.json({ ok: true, compacted: false, error: 'not large enough to compact yet', status: compactionStatus(id) });
    res.json({ ok: r.compacted, compacted: r.compacted, error: r.error || null, summary: r.summary ? String(r.summary).slice(0, 4000) : null, status: compactionStatus(id) });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e && e.message) || String(e) });
  }
});

// B102 — session trace: the durable event log + compaction checkpoints
// for one conversation (dsh web session explorer mirror).
app.get('/api/conversations/:id/trace', (req, res) => {
  const id = String(req.params.id).slice(0, 80);
  res.json(buildTrace(id, { limit: Number(req.query.limit) || 200 }));
});

// B106 — session-log-export (dsh session-query/session-log-export mirror).
app.get('/api/conversations/:id/export', (req, res) => {
  const id = String(req.params.id).slice(0, 80);
  const fmt = String(req.query.format || 'jsonl').toLowerCase() === 'md' ? 'md' : 'jsonl';
  const out = exportConversation(id, fmt);
  if (!out.ok) return res.status(404).json(out);
  res.setHeader('Content-Type', fmt === 'md' ? 'text/markdown' : 'application/x-ndjson');
  res.setHeader('Content-Disposition', `attachment; filename="conversation-${id}.${fmt === 'md' ? 'md' : 'jsonl'}"`);
  res.send(out.content);
});

// B108 — rename a conversation (manual title) + force regenerate.
app.post('/api/conversations/:id/rename', (req, res) => {
  const id = String(req.params.id).slice(0, 80);
  const r = setStoredTitle(id, String((req.body || {}).title || '').slice(0, 80));
  res.status(r.ok ? 200 : 400).json(r);
});
app.post('/api/conversations/:id/title', async (req, res) => {
  const id = String(req.params.id).slice(0, 80);
  try {
    const r = await maybeAutoTitle(id);
    res.json({ ok: r, titled: r });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e && e.message) || String(e) });
  }
});

// B110 — pending questions (dsh tool-ask-user): read + answer.
app.get('/api/questions/:conv', (req, res) => {
  const conv = String(req.params.conv).slice(0, 80);
  res.json(getPending(conv) || { questions: [] });
});
app.post('/api/questions/answer', (req, res) => {
  try {
    const { conv, answers } = req.body || {};
    const r = answerPending(String(conv || '').slice(0, 80), answers);
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: (e && e.message) || String(e) });
  }
});
// B128 — project memory: durable capsules for continuing builds.
app.get('/api/projects', (req, res) => {
  res.json({ projects: listProjectCapsules() });
});

// B133 — commands, anonymous identity, session invariants.
app.get('/api/commands', (req, res) => res.json({ commands: listCommands() }));
app.get('/api/identity/id', (req, res) => res.json({ userId: anonymousUserId() }));
app.get('/api/invariants', (req, res) => {
  const conv = String(req.query.conv || '');
  if (conv) return res.json(checkConversationInvariants(conv));
  res.json(invariantStatus(Number(req.query.limit) || 50));
});

// B132 — telemetry (read-only, no secrets) + checkpoint policy + command feedback.
app.get('/api/telemetry', (req, res) => {
  res.json({ events: readTelemetry(Number(req.query.limit) || 200), stats: telemetryStats() });
});
app.get('/api/checkpoints', (req, res) => {
  res.json({ checkpoints: listSessionCheckpoints(String(req.query.conv || '')) });
});
app.post('/api/feedback/command', (req, res) => {
  try {
    const { command, result, note } = req.body || {};
    const r = addCommandFeedback({ command, result, note });
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: (e && e.message) || String(e) });
  }
});

// B110 — plan-mode: approve a presented plan (frontend APPROVE button).
app.post('/api/plan/:conv/approve', (req, res) => {
  const conv = String(req.params.conv).slice(0, 80);
  try {
    approvePlan(conv);
    setPlanMode(conv, false);
    res.json({ ok: true, approved: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e && e.message) || String(e) });
  }
});

// B106 — message feedback (dsh message-feedback mirror).
app.post('/api/feedback', (req, res) => {
  try {
    const { conversation, seq, rating, note } = req.body || {};
    const r = addFeedback({ conversation: conversation || conversationId(req), seq, rating, note });
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) {
    res.status(400).json({ ok: false, error: (e && e.message) || String(e) });
  }
});
app.get('/api/feedback', (req, res) => {
  res.json({ feedback: listFeedback(String(req.query.conversation || ''), Number(req.query.limit) || 50) });
});
app.get('/api/feedback/stats', (req, res) => {
  res.json(feedbackStats());
});

// B107 — SKILLS MARKETPLACE: browse + one-tap install curated skills
// (installs into the user root → auto-discovered by B98).
app.get('/api/skills/marketplace', (req, res) => {
  res.json({ skills: listMarketplace(), stats: marketplaceStats() });
});
app.post('/api/skills/marketplace/:name/install', (req, res) => {
  const r = installSkill(String(req.params.name || '').toLowerCase());
  res.status(r.ok ? 200 : 400).json(r);
});
app.delete('/api/skills/marketplace/:name', (req, res) => {
  const r = uninstallSkill(String(req.params.name || '').toLowerCase());
  res.status(r.ok ? 200 : 400).json(r);
});

// B100 — spilled (oversized) tool results for a session (metadata only).
app.get('/api/spills', (req, res) => {
  const owner = String(req.query.owner || 'agent').slice(0, 60);
  res.json({ owner, spills: listSpills(owner), stats: spillStats(owner) });
});

// Fork a conversation: seed a new one from an existing log (DSH fork).
app.post('/api/conversations/:id/fork', (req, res) => {
  const id = String(req.params.id).slice(0, 80);
  const f = forkConversation(id);
  res.json(f.ok ? { ok: true, id: f.id, parentSession: f.parentSession, seedLength: f.seedLength } : { ok: false, error: f.error });
});

// Delete a conversation's log.
app.delete('/api/conversations/:id', (req, res) => {
  const id = String(req.params.id).slice(0, 80);
  res.json(deleteConversation(id));
});

// Build 48, P5 — when the NDJSON stream drops (proxy drop, backgrounded app,
// host restart), the server-side mission keeps running. The frontend polls this
// endpoint to AUTO-RECOVER the finished result instead of asking the user to
// manually say "continue".
app.get('/api/chat/result', (req, res) => {
  // B48 P7.2 — every recovery poll is observable: did the stream actually drop
  // (poll with no fresh task running) and did the result exist to be recovered?
  const convId = conversationId(req);
  const result = loadResult(convId);
  recordRecoveryEvent({ convId, cause: 'poll', recovered: !!result });
  res.json({ result });
});

/** B112 — the last REAL user task message of a conversation (approval resume
 *  fallback). Approval utterances and /plan commands are skipped so the
 *  resume target is the original task, never "approve the plan" itself. */
function lastUserChatText(convId) {
  try {
    const events = loadConversationEvents(convId, 500);
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.role !== 'user' || e.kind !== 'chat') continue;
      const t = String(e.text || '');
      if (APPROVE_PLAN_RE.test(t)) continue;
      if (/^\/plan\b/.test(t)) continue;
      return t.slice(0, 3000);
    }
  } catch { /* noop */ }
  return '';
}

function conversationSummaryContext(convId) {
  try {
    // B100 — compaction-aware: if this conversation has a checkpoint, render
    // checkpoint + retained tail instead of the ever-growing transcript.
    if (convId) {
      const { checkpoint, tail } = compactionAwareHistory(convId, { limit: 100 });
      if (checkpoint) {
        const tailText = tail.filter((e) => e.role === 'jexi' || e.role === 'user')
          .slice(-6).map((e) => `${e.role === 'user' ? 'You' : 'JEXI'}: ${String(e.text).replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
        return `\n\n[Earlier in this conversation — compacted checkpoint: ${String(checkpoint.text).slice(0, 2000)}]\n[Recent turns retained verbatim:\n${tailText.slice(0, 1500)}]`;
      }
    }
    const s = getRollingSummary();
    const base = s ? `\n\n[Earlier in this conversation: ${String(s).slice(0, 600)}]` : '';
    // B106 — session-reference: the model knows OTHER past conversations exist.
    return base + recentSessionsBlock(convId, 5);
  } catch { return ''; }
}

app.post('/api/chat', async (req, res) => {
  const { query, image, files } = req.body;
  recordChat();
  if (!query && !image) return res.status(400).json({ success: false, error: 'No query provided' });

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Any done event is ALSO persisted to the result store (B48 P5) — so every
  // real terminal path (success, deadline-overshoot finish, catch) is
  // recoverable after a stream drop, regardless of which call site emits it.
  // Interim markers (recoverable: true, e.g. the 15-min deadline notice) are
  // NOT persisted — the store only ever holds a REAL outcome.
  // B113 — /plan = PLAN-AND-EXECUTE: no approval pause, no question cards.
  // While true, plan.review events become plain update logs instead of a card.
  let planAutoExecute = false;
  const sendEvent = (type, data) => {
    if (type === 'done' && data && !data.recoverable) { try { saveResult(convId, data); } catch (e) {} }
    if (type === 'plan.review' && planAutoExecute) {
      type = 'log';
      data = { agent: 'Planner', message: '📋 Plan ready — executing now.' };
    }
    try { res.write(JSON.stringify({ type, ...data }) + '\n'); } catch (e) {}
  };

  // Stable per-conversation id for this request (hoisted so the deadline and
  // the result store can use it too).
  const convId = conversationId(req);
  // B104 — the user's real timezone rides every request (x-jexi-tz); the LLM
  // system prompts then carry the correct local date/time.
  setRequestTimeZone(req.headers['x-jexi-tz']);
  // B66 — per-session conversation memory: chat history reads/writes for this
  // request are scoped to this conversation (never the shared global blob).
  setActiveSession(convId);
  // A fresh run must never serve a stale previous result during recovery.
  clearResult(convId);
  // done = emit the terminal event; persistence is handled by sendEvent above.
  const done = (payload) => {
    // B96 — persist JEXI's answer into the conversation log too.
    if (payload && payload.summary) {
      try { appendConversationEvent(convId, { role: 'jexi', text: String(payload.summary).slice(0, 20000), kind: 'chat' }); } catch (e) {}
    }
    sendEvent('done', payload);
    // B100 — automatic compaction pressure check (dsh compactIfNeeded):
    // long conversations are summarized in the background, never blocking
    // the reply the user is waiting for.
    if (payload && payload.success && !payload.recoverable) {
      maybeCompact(convId).then((r) => {
        if (r && r.compacted) { try { sendEvent('log', { agent: 'Memory', message: `📦 Auto-compacted this conversation — ${r.status.lastCheckpoint.shadowed.events} older turns → one checkpoint (${r.status.lastCheckpoint.shadowed.chars.toLocaleString()} chars shadowed).` }); } catch (e) {} }
      }).catch(() => {});
      // B108 — auto-title this conversation once it has enough content
      // (dsh session-title mirror; one-shot, never blocks the reply).
      maybeAutoTitle(convId).catch(() => {});
    }
  };

  // Heartbeat: Cloudflare's proxy in front of Render kills streams that stay
  // silent too long (deep-reads and LLM calls pause for 10-30s). A tiny event
  // every 10s keeps the connection alive — the frontend ignores unknown types.
  const heartbeat = setInterval(() => { try { res.write('{"type":"heartbeat"}\n'); } catch (e) {} }, 10000);

  // Hard deadline: no single request may hold the connection forever (a
  // pathological research pass, browser hang, or provider stall). On fire it
  // emits a readable done event instead of leaving the UI spinning forever.
  const CHAT_DEADLINE_MS = Number(process.env.CHAT_DEADLINE_MS) || 25 * 60 * 1000; // B105 — 25min budget (was 15): long research tasks must not drop
  let finished = false;
  const finish = () => { clearInterval(heartbeat); try { res.end(); } catch (e) {} };
  const deadline = setTimeout(() => {
    if (finished) return;
    finished = true;
    recordError('chat', 'request exceeded 15min deadline');
    // B48 P7.2 — observable deadline event: a recovery poll should follow and
    // find the real outcome once the server-side mission finishes.
    recordRecoveryEvent({ convId, cause: 'deadline', recovered: false, detail: 'request exceeded 15min deadline — result store keeps the terminal outcome' });
    sendEvent('log', { agent: 'System', message: '⏱ Deadline reached (15 min) — the task is still running server-side. The result will appear here automatically when it finishes.' });
    done({ recoverable: true, success: false, error: 'The task exceeded the 15-minute safety deadline. It may still be running server-side — the result will appear here automatically when it finishes.', summary: '⏱ **Deadline reached.** This task ran longer than 15 minutes, so the connection was closed as a safety valve. The work is still completing on the server — the result will appear here automatically.' });
    finish();
  }, CHAT_DEADLINE_MS);

  try {
    let raw = String(query || '').trim();
    // B96 — append the user message to the conversation's durable log.
    try { appendConversationEvent(convId, { role: 'user', text: raw, kind: 'chat' }); } catch (e) {}
    // B119 — dsh lifecycle: the user message is also a typed session event.
    try { lifecycleUserMessage(convId, 1, raw); } catch { /* noop */ }
    // B116-fix — HOIST preset+mode BEFORE any use: the auto-routing block and
    // /plan handling reference `mode`, so declaring it later crashed every
    // chat request with "Cannot access 'mode' before initialization" (TDZ).
    const preset = resolvePreset(String(req.headers['x-jexi-preset'] || '').toLowerCase());
    // B121-fix — the dsh PRESET must NOT force agent mode (ptc/creator had
    // mode:'agent', which silently disabled AUTO routing → every message ran
    // the search/agent pipeline). Only the minimal preset forces direct
    // answers; standard/ptc/creator now route AUTO (JEXI decides).
    const mode = String(req.body.mode || req.headers['x-jexi-mode'] || (preset.mode === 'normal' ? 'normal' : 'auto')).toLowerCase();
    // B133 — slash commands run before the model sees the message.
    {
      const cmd = await tryExecuteCommand(raw, { convId, sendEvent });
      if (cmd) {
        if (!cmd.ok) {
          sendEvent('log', { agent: 'JEXI', message: `⚠ ${cmd.error}` });
          done({ success: false, query: raw, summary: `### ⚠ JEXI OS\n\n${cmd.error}` });
        } else if (cmd.result && cmd.result.summary) {
          done({ success: true, query: raw, summary: cmd.result.summary });
        }
        // matched but no summary → fall through so the flow can handle it
        if (cmd.ok && cmd.result && cmd.result.summary) return;
      }
    }
    // B113 — /plan = PLAN-AND-EXECUTE: plan first, then do the work
    // AUTOMATICALLY. No approval pause, no question cards, no "should I
    // continue" — updates stream as she works.
    if (/^\/plan\b/.test(raw)) {
      const rest = raw.replace(/^\/plan\b/, '').trim();
      if (/^off\b/i.test(rest)) {
        setPlanMode(convId, false);
        sendEvent('log', { agent: 'Planner', message: '📋 Plan mode OFF — executing tasks directly.' });
        done({ success: true, query: raw, summary: '### 📋 Plan mode OFF\n\nI will execute tasks directly again.' });
        return;
      }
      // ON (bare, "on", or "/plan <task>") → plan then execute automatically.
      setPlanMode(convId, true);
      planAutoExecute = true;
      const task = rest.replace(/^on\b/i, '').trim();
      if (task) {
        raw = task; // the real task flows through the whole pipeline
        try { appendConversationEvent(convId, { role: 'user', text: raw, kind: 'chat' }); } catch (e) {}
        sendEvent('log', { agent: 'Planner', message: `📋 /plan — planning first, then executing automatically: “${String(raw).slice(0, 80)}”` });
      } else {
        sendEvent('log', { agent: 'Planner', message: '📋 Plan mode ON — I will plan first, then execute automatically and stream updates. No approval needed.' });
        done({ success: true, query: raw, summary: '### 📋 Plan mode ON\n\nI will plan first and then execute immediately — no approval needed. Updates stream here as I work.' });
        return;
      }
    }
    // B113 — a normal message while plan mode is still on also auto-executes.
    if (!planAutoExecute) planAutoExecute = isPlanMode(convId);
    // B114 — AUTO MODE: classify; conversational/direct intents get the fast
    // direct answer, everything else falls through to the agent pipeline.
    let autoDirect = false;
    let autoPlan = null;
    if (mode === 'auto') {
      try {
        const dec = await planner.analyzeIntent(raw);
        autoPlan = dec || null;
        // B121 — deterministic classifications carry no confidence; treat
        // them as trusted. LLM ones need >= 0.5 sanity. Simple questions
        // must NOT fall through to search/agents.
        autoDirect = !!dec && isDirectIntent(dec.intent) && (dec.confidence === undefined || dec.confidence >= 0.5);
        if (autoDirect) sendEvent('log', { agent: 'JEXI', message: dec && dec.plugin
          ? `⚡ Auto mode — answering with the ${dec.plugin} plugin, no search needed.`
          : '⚡ Auto mode — this is a conversation question, answering directly (agent pipeline not needed).' });
        else sendEvent('log', { agent: 'Planner', message: `🛰 Auto mode — routed to the agent pipeline (intent: ${dec ? dec.intent : 'deterministic'}).` });
      } catch { autoDirect = false; }
    }
    // B128 — project memory: a continuation/change query targeting a known
    // project loads its capsule into the turn (files, summary, preview URL).
    let projectCapsuleCtx = '';
    if (/^(continue|keep going|go back to|update|upgrade|modify|change|add to|finish|resume|improve|fix|extend|work on|make (it|the)|build on)\b/i.test(raw) || /\b(again|next|dark mode|add a|add an|change the|make it|update it)\b/i.test(raw)) {
      try {
        const cctx = capsuleContext(raw);
        if (cctx) {
          projectCapsuleCtx = cctx;
          const cap = findProjectCapsule(raw);
          if (cap) sendEvent('log', { agent: 'Memory', message: `💾 Continuing project "${cap.name}" — its files, summary and preview are loaded.` });
        }
      } catch { /* noop */ }
    }
    // B110 — pending user answers (from ask_user_question) inject into this turn.
    const pendingAnswers = formatAnswers(takeAnswers(convId));
    // B109 — SESSION REFERENCES (dsh session-reference): @[label](dsh-session:…)
    // mentions in the query resolve to read-only snapshots injected into the
    // prompt (security-wrapped, bounded to 3 refs / 64 KB).
    let sessionRefInjected = '';
    try {
      const refRes = resolveSessionReferences(raw);
      if (refRes.injected) {
        sessionRefInjected = `\n\n${refRes.injected}\n`;
        sendEvent('log', { agent: 'Memory', message: `🔗 Resolved ${refRes.resolved} referenced session(s) from your message — read-only context injected.` });
      }
    } catch { /* best-effort */ }
    // B100 — /compact command (dsh command-compact mirror): summarize the
    // older range of THIS conversation into a structured checkpoint now.
    if (/^\/compact\b/.test(raw)) {
      sendEvent('log', { agent: 'Memory', message: '📦 Compacting this conversation — older turns become a structured checkpoint (the tail stays verbatim).' });
      const r = await compactNow(convId);
      if (r && r.compacted) {
        sendEvent('log', { agent: 'Memory', message: `📦 Compaction complete — ${r.status.lastCheckpoint.shadowed.events} older turns shadowed into one checkpoint; ${r.status.events} turns retained verbatim.` });
        done({ success: true, query: raw, summary: '### 📦 Conversation compacted\n\nOlder turns were summarized into a structured checkpoint so JEXI keeps full context without growing the prompt forever.\n\n```markdown\n' + String(r.summary).slice(0, 3000) + '\n```' });
      } else {
        const why = (r && r.error) || 'this conversation is not large enough to compact yet';
        sendEvent('log', { agent: 'Memory', message: `📦 Compaction skipped — ${why}.` });
        done({ success: true, query: raw, summary: `### 📦 Conversation compaction\n\nNothing to compact: ${why}.` });
      }
      return;
    }
    // B103 — DETERMINISTIC IDENTITY ANSWERS: "who are you / what can you do /
    // who built you" are answered from the canonical profile with NO LLM call —
    // always correct, always instant, in both agent and normal mode.
    if (!image && raw.length <= 140 && IDENTITY_QUESTION_RE.test(raw)) {
      sendEvent('log', { agent: 'JEXI', message: '🪪 Identity question — answering from my canonical profile (no tools needed).' });
      done({ success: true, query: raw, summary: IDENTITY_ANSWER, statistics: { executionTime: 0, agentsUsed: 0, complexity: 'IDENTITY', confidence: 100 } });
      return;
    }
    // B91 — attachments: load uploaded files and inject their previews into
    // the query so the planner and every agent see them.
    let attachmentContext = '';
    if (Array.isArray(files) && files.length) {
      const parts = [];
      for (const f of files.slice(0, 5)) {
        try {
          const fp = path.join(DATA_DIR, 'uploads', String(f.id || '').replace(/[^a-zA-Z0-9._-]/g, ''));
          if (!fp.startsWith(path.join(DATA_DIR, 'uploads')) || !fs.existsSync(fp)) continue;
          const preview = fs.readFileSync(fp, 'utf-8').slice(0, 4000);
          parts.push(`[Attached file "${String(f.name || 'file')}":\n${preview}]`);
        } catch { /* skip unreadable */ }
      }
      if (parts.length) attachmentContext = `\n\n${parts.join('\n\n')}`;
      sendEvent('log', { agent: 'Files', message: `📎 ${files.length} attachment(s) received and attached to this task.` });
    }
    const effectiveRaw = raw + attachmentContext;
    const pendingOffer = loadOffer(convId);
    const hasPending = Boolean(pendingOffer);

    // GOAL ENGINE (Phase 2) — the durable background job queue. Two paths:
    //   1) "/goal <text>" (or "goal: <text>") starts an autonomous goal job;
    //   2) a parked (need-info) goal in this session is waiting for details —
    //      the next message IS the answer. Both stream live through the job's
    //      event log, so they survive restarts and never mix sessions.
    // B91 — ANY LINK in the message (or a bare link): universal agent.
    const LINK_RE = /(https?:\/\/[^\s]+)/i;
    const linkMatch = image ? null : raw.match(LINK_RE);
    if (linkMatch && !/^\/\w+/.test(raw)) {
      const url = linkMatch[1].replace(/[),.!?]+$/, '');
      const instruction = raw.replace(LINK_RE, '').trim();
      sendEvent('log', { agent: 'Link Agent', message: `🔗 Processing ${url.slice(0, 60)}…` });
      const out = await universalLinkAgent.run({ url, instruction, sendEvent });
      done({ success: out.success !== false, query: raw, summary: normalizeFinalAnswer(out.summary || ''), sources: out.meta ? [{ title: out.meta.title || url.slice(0, 60), link: url }] : [] });
      return;
    }

    // B91 — /build <prompt>: autonomous project builder.
    const BUILD_RE = /^\/build\s+([\s\S]+)$/i;
    const buildMatch = image ? null : raw.match(BUILD_RE);
    if (buildMatch) {
      const prompt = buildMatch[1].trim();
      sendEvent('log', { agent: 'Builder', message: '📦 Autonomous build started — planning, writing, running, fixing…' });
      const out = await builderAgent.run({ prompt, session: convId, sendEvent });
      if (out.needInfo && out.needInfo.length) {
        pendingBuilds.set(convId, { prompt, buildId: out.buildId, dir: out.dir, entry: out.entry, lastOutput: out.lastOutput, runClean: out.runClean, written: out.written, rounds: out.rounds });
        sendEvent('builder.need-info', { questions: out.needInfo });
        done({ success: true, parked: true, summary: out.summary || 'Need your GitHub details.' });
      } else {
        done({ success: out.success !== false, query: raw, summary: normalizeFinalAnswer(out.summary || ''), repoUrl: out.repoUrl || null });
      }
      return;
    }
    // Resume a pending build: the next message is "repo-name <token>".
    const pendingBuild = pendingBuilds.get(convId);
    if (pendingBuild && !image && raw.trim()) {
      const parts = raw.trim().split(/\s+/);
      const repo = parts[0].replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40);
      const token = parts[1] || '';
      if (repo && token) {
        sendEvent('log', { agent: 'Builder', message: `🚀 Pushing to GitHub as ${repo}…` });
        const out = await builderAgent.run({ prompt: pendingBuild.prompt, session: convId, sendEvent, opts: { resumeBuild: pendingBuild, repo, token } });
        pendingBuilds.delete(convId);
        done({ success: out.success !== false, query: raw, summary: normalizeFinalAnswer(out.summary || ''), repoUrl: out.repoUrl || null });
      } else {
        done({ success: false, query: raw, summary: '### 📦 Builder\n\nSend the **repo name** and the **token** separated by a space, e.g. `my-app github_pat_...`' });
      }
      return;
    }

    // B90 — TRAVEL: /book, /flights, /hotels → the browser booking flow.
    const TRAVEL_RE = /^(?:\/book|\/flights|\/hotels?|book (?:me )?(?:a |an |the )?(?:flight|hotel|room|ticket|trip|car)|flights? (?:from|to)|hotels? (?:in|near|for))\b.*$/i;
    const travelMatch = image ? null : raw.match(TRAVEL_RE);
    if (travelMatch) {
      const out = await travelBookingAgent.run({ query: raw, session: convId, sendEvent });
      if (out.needInfo && out.needInfo.length) {
        sendEvent('travel.need-info', { questions: out.needInfo });
        done({ success: true, parked: true, summary: `### 📋 One quick thing\n\n${out.needInfo.map((q, i) => `${i + 1}. **${q.question}**`).join('\n')}\n\nAnswer here and I'll search right away.` });
      } else {
        done({ success: out.success !== false, query: raw, summary: normalizeFinalAnswer(out.summary || ''), options: out.options || [] });
      }
      return;
    }
    // B90 — "pick 2" / "the second one" after a travel search opens that option.
    const PICK_RE = /^(?:pick|choose|open|the)\s*(?:option\s*)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+one)?$/i;
    const pickMatch = image ? null : raw.match(PICK_RE);
    if (pickMatch) {
      const last = travelBookingAgent.getLastOptions(convId);
      if (last && last.length) {
        const idx = Math.max(0, Math.min(last.length - 1, Number(pickMatch[1]) - 1));
        const out = await travelBookingAgent.run({ query: 'pick', session: convId, sendEvent, opts: { selected: idx } });
        done({ success: out.success !== false, query: raw, summary: normalizeFinalAnswer(out.summary || ''), selected: out.selected || null });
        return;
      }
    }

    // B89 — DO ANYTHING: /do <task> or /anything <task> runs the free-form
    // agent loop as a durable job (plans, acts, verifies, repairs, reports).
    const DO_PREFIX_RE = /^(?:\/do|\/anything|do anything[\s:]+|anything[\s:]+)\s+(.+)$/i;
    const doMatch = image ? null : raw.match(DO_PREFIX_RE);
    if (doMatch) {
      const taskText = doMatch[1].trim();
      const { id: jobId } = enqueueDoAnything({ task: taskText, session: convId });
      sendEvent('log', { agent: 'Do Anything', message: `🛠 Do Anything started (job ${jobId}) — planning and executing...` });
      const sub = subscribeJob(jobId, (event) => {
        if (event.type === 'done') {
          done({ success: event.success !== false, query: taskText, goalId: event.goalId || jobId, summary: normalizeFinalAnswer(event.summary || '✅ Task completed.'), files: event.files || [], sources: event.sources || [], statistics: event.statistics || {} });
        } else if (event.type !== 'job.started' && event.type !== 'do.started') {
          sendEvent(event.type, event);
        }
      });
      if (sub.ok && sub.finished) {
        const evs = getJobEvents(jobId) || [];
        const last = [...evs].reverse().find((e) => e.type === 'done');
        if (last) done({ success: last.success !== false, query: taskText, summary: normalizeFinalAnswer(last.summary || '✅ Task completed.'), files: last.files || [], sources: last.sources || [], statistics: last.statistics || {} });
        else done({ success: false, query: taskText, summary: '### ⚠ JEXI OS\n\nThe task finished without a result.' });
        return;
      }
      if (sub.ok) {
        const iv = setInterval(() => {
          const j = getGoalJob(jobId);
          if (j && (j.status === 'done' || j.status === 'failed')) { clearInterval(iv); try { sub.unsubscribe(); } catch (e) {} finish(); }
        }, 1500);
        req.on('close', () => { clearInterval(iv); try { sub.unsubscribe(); } catch (e) {} });
      }
      return;
    }

    const GOAL_PREFIX_RE = /^(?:\/goal|goal:)\s+(.+)$/i;
    const goalMatch = image ? null : raw.match(GOAL_PREFIX_RE);
    if (goalMatch) {
      const goalText = goalMatch[1].trim();
      const savedSettings = loadSettings();
      const autonomy = ['ask', 'full'].includes(savedSettings.autonomyMode) ? savedSettings.autonomyMode : 'ask';
      const { id: jobId } = enqueueGoal({ goal: goalText, session: convId, autonomy });
      sendEvent('log', { agent: 'Goal Engine', message: `🎯 Goal started (job ${jobId}, autonomy: ${autonomy}) — streaming live...` });
      const sub = subscribeJob(jobId, (event) => {
        if (event.type === 'done') {
          done({ success: event.success !== false, query: goalText, parked: !!event.parked, goalId: event.goalId || jobId, summary: normalizeFinalAnswer(event.summary || '✅ Goal completed.'), files: event.files || [], sources: event.sources || [], statistics: event.statistics || {} });
        } else if (event.type !== 'job.started') {
          sendEvent(event.type, event);
        }
      });
      if (sub.ok && sub.finished) {
        // Finished between enqueue and subscribe — recover the terminal event.
        const evs = getJobEvents(jobId) || [];
        const last = [...evs].reverse().find((e) => e.type === 'done');
        if (last) {
          done({ success: last.success !== false, query: goalText, parked: !!last.parked, goalId: last.goalId || jobId, summary: normalizeFinalAnswer(last.summary || '✅ Goal completed.'), files: last.files || [], sources: last.sources || [], statistics: last.statistics || {} });
        } else {
          done({ success: false, query: goalText, summary: '### ⚠ JEXI OS\n\nThe goal already finished without a result.' });
        }
        return;
      }
      if (sub.ok) {
        const iv = setInterval(() => {
          const j = getGoalJob(jobId);
          if (j && (j.status === 'done' || j.status === 'failed')) { clearInterval(iv); try { sub.unsubscribe(); } catch (e) {} finish(); }
        }, 1500);
        req.on('close', () => { clearInterval(iv); try { sub.unsubscribe(); } catch (e) {} });
      }
      return;
    }

    // Parked goal — the user's next message answers its questions.
    const parkedJob = (() => {
      for (const j of listJobs()) {
        if (j.session === convId && j.status === 'need-info') return j;
      }
      return null;
    })();
    if (parkedJob && !image && raw.trim()) {
      clearOffer(convId);
      clearRun(convId);
      sendEvent('log', { agent: 'Goal Engine', message: `📨 Received your details — resuming goal "${String(parkedJob.goal || '').slice(0, 80)}"...` });
      const ack = answerJob(parkedJob.id, raw);
      if (!ack.ok) {
        done({ success: false, query: raw, summary: `### ⚠ JEXI OS\n\n${ack.error}` });
        return;
      }
      const sub = subscribeJob(parkedJob.id, (event) => {
        if (event.type === 'done') {
          done({ success: event.success !== false, query: raw, parked: !!event.parked, goalId: event.goalId || parkedJob.id, summary: normalizeFinalAnswer(event.summary || '✅ Goal completed.'), files: event.files || [], sources: event.sources || [], statistics: event.statistics || {} });
        } else if (event.type !== 'job.started') {
          sendEvent(event.type, event);
        }
      }, { replay: false });
      if (sub.ok && !sub.finished) {
        const iv = setInterval(() => {
          const j = getGoalJob(parkedJob.id);
          if (j && (j.status === 'done' || j.status === 'failed')) { clearInterval(iv); try { sub.unsubscribe(); } catch (e) {} finish(); }
        }, 1500);
        req.on('close', () => { clearInterval(iv); try { sub.unsubscribe(); } catch (e) {} });
      } else if (sub.ok && sub.finished) {
        done({ success: false, query: raw, summary: '### ⚠ JEXI OS\n\nThat goal already finished — start a new one with "/goal <text>".' });
      }
      return;
    }

    let effectiveQuery = effectiveRaw;
    if (projectCapsuleCtx) effectiveQuery = projectCapsuleCtx + effectiveQuery;
    // B110 — pending answers + plan-mode policy ride the query (plan mode's
    // plan:policy section, dsh plan-mode mirror).
    if (pendingAnswers) effectiveQuery = pendingAnswers + effectiveQuery;
    if (isPlanMode(convId)) effectiveQuery = planModePromptSection(convId) + '\n\n' + effectiveQuery;
    let plan;
    let activeTaskId = null;   // Build 47 — the task this turn belongs to
    let executionQuery = effectiveQuery; // may gain resume context
    let intelClassification = null;

    // BUILD 47 — INTELLIGENCE PIPELINE (Conversation Manager).
    // Before anything runs, decide what this message MEANS: continuation of the
    // active task, a switch back to an older one, a genuinely new objective, or
    // an ambiguous reference that needs clarification.
    const activeTaskNow = (listTasks('active') || [])[0];
    const currentTaskId = activeTaskNow?.id || null;
    // B92 — NORMAL MODE (ChatGPT-style): the user picked "Normal" in the app.
    // Plain questions get ONE direct LLM call — no planner, no roster, no
    // tools, no graph. Fast, simple, minimal events. Explicit agent commands
    // (/build, /goal, /do, links, travel) already returned above, so what
    // reaches here is a plain conversation question.
    // B114 — AUTO (default): JEXI decides per query whether to answer directly
    // or run the agent pipeline. 'normal'/'agent' stay as explicit overrides
    // (preset + mode are hoisted at the top of this handler — B116-fix).
    if ((mode === 'normal' || autoDirect) && !image) {
      try { addChat('user', effectiveQuery); } catch (e) {}
      sendEvent('log', { agent: 'JEXI', message: autoDirect ? '💬 Answering directly — no pipeline needed for this one.' : '💬 Normal mode — answering directly.' });
      sendEvent('plan', { intent: 'normal_chat', complexity: 'NORMAL', steps: ['JEXI Core'], roster: ['JEXI Core'], mode: 'normal' });
      const prompt = `${effectiveQuery}\n\n${conversationSummaryContext(convId)}${sessionRefInjected}`;
      let text = '';
      // B130 — PERF: the tool loop runs ONLY for plugin-answerable intents
      // (weather/crypto/currency/time/ip, where a real tool call is needed).
      // Plain direct answers (greetings, facts, math, chat) get ONE fast call
      // — the B124 version ran a 4-iteration tool loop on EVERY message,
      // which made simple replies take forever.
      const pluginIntent = autoPlan && autoPlan.plugin;
      if (pluginIntent && (mode === 'auto' || autoDirect)) {
        try {
          const pluginDefs = listPluginTools().filter((p) => p && p.slug);
          if (pluginDefs.length) {
            const schemas = buildNativeSchemas(pluginDefs);
            const res = await generateWithToolsLoop(prompt, JEXI_NORMAL_PROMPT, schemas, {
              temperature: 0.4,
              maxIterations: 2,
              executeToolCalls: (calls) => executeNativeToolCalls(calls, { profile: activeToolProfile(), sendEvent, intent: 'direct_answer' }),
            });
            if (res && res.ok && res.text) text = res.text;
          }
        } catch (e) { /* fall through to plain generation */ }
      }
      if (!text) {
        try {
          text = await generateContent(prompt, JEXI_NORMAL_PROMPT, null, { prefer: '', temperature: 0.5 });
        } catch (e) {
          text = `### ⚠ JEXI OS\n\n${(e && e.message) || 'I could not answer right now.'}`;
        }
      }
      done({ success: true, query: raw, summary: normalizeFinalAnswer(text || '...'), statistics: { executionTime: 0, agentsUsed: 0, complexity: 'NORMAL', confidence: 80 } });
      return;
    }

    const analysis = image
      ? { classification: currentTaskId ? 'continue' : 'new', taskId: currentTaskId, confidence: 0.8, reason: 'image attaches to current context' }
      : await analyzeMessage(raw, { currentTaskId, image });
    intelClassification = analysis.classification;

    // B112 — PLAN APPROVAL (typed or the card's APPROVE button): resumes the
    // ORIGINAL task and implements it. Previously this never ran: no offer was
    // saved when the plan was presented, and CONFIRM_RE had no "approve"
    // branch — so "approve the plan" was analyzed as a brand-new query and
    // nothing got built.
    if (!image && APPROVE_PLAN_RE.test(raw)) {
      try {
        const cp = currentPlan(convId);
        if (cp && (cp.status === 'pending_review' || cp.status === 'approved')) {
          approvePlan(convId);
          setPlanMode(convId, false);
          const original = (loadOffer(convId) || {}).query || lastUserChatText(convId) || raw;
          sendEvent('log', { agent: 'Planner', message: `✅ Plan approved — starting implementation: “${String(original).slice(0, 90)}”` });
          plan = await planner.planConfirmed(original);
          effectiveQuery = original;
          saveOffer(convId, original); // keep ORIGINAL as the resume target
          executionQuery = original;
        }
      } catch (e) {
        sendEvent('log', { agent: 'Planner', message: `⚠ Plan approval resume failed: ${(e && e.message) || e}` });
      }
    }

    if (!image && DECLINE_RE.test(raw) && hasPending) {
      // "no / cancel" — clear the pending task, answer WITHOUT searching.
      clearOffer(convId);
      clearRun(convId);
      sendEvent('log', { agent: 'Planner', message: '✖ Declined — pending task cleared, nothing will run.' });
      done({ success: true, query, summary: '### 🧠 JEXI OS\n\n👍 Understood — I won\'t go ahead with that. Tell me what you\'d like next and I\'ll take it from there.' });
      return;
    }

    if (!image && CONFIRM_RE.test(raw) && hasPending) {
      // "yes / go ahead" — resume the ORIGINAL request so the action actually
      // happens (build the app, run the research, etc.) instead of searching
      // the word "yes".
      const original = pendingOffer.query;
      // P5 — a graph confirmationPause was parked for this conversation: resume
      // the FULL RunState at the exact paused node (never re-plan from scratch).
      const pausedRun = loadRun(convId);
      if (pausedRun && pausedRun.state && pausedRun.plan) {
        sendEvent('log', { agent: 'Planner', message: `✓ Confirmed — resuming your task from where it paused: “${String(pausedRun.query || original).slice(0, 90)}”` });
        const resumed = await orchestrator.executePlan(pausedRun.plan, pausedRun.query, sendEvent, { image, resumeState: pausedRun.state, confirmed: true });
        clearRun(convId);
        clearOffer(convId);
        const finalSummary = resumed.summary && String(resumed.summary).trim()
          ? resumed.summary
          : (resumed.error || 'The task finished, but produced no readable summary.');
        done({ success: resumed.success, query, summary: finalSummary, sources: resumed.sources || [], statistics: resumed.statistics, files: resumed.files || [] });
        return;
      }
      // B110 — PLAN APPROVAL: a plan presented via exit_plan_mode is approved
      // here; plan mode turns OFF so the resumed run IMPLEMENTS, not re-plans.
      try {
        const cp = currentPlan(convId);
        if (cp && cp.status === 'pending_review') {
          approvePlan(convId);
          setPlanMode(convId, false);
          sendEvent('log', { agent: 'Planner', message: '✅ Plan approved — starting implementation now.' });
        }
      } catch { /* noop */ }
      // Classic offer flow — re-plan the original request and run it.
      sendEvent('log', { agent: 'Planner', message: `✓ Confirmed — resuming your original task: “${original.slice(0, 90)}”` });
      plan = await planner.planConfirmed(original);
      effectiveQuery = original;
      saveOffer(convId, original); // keep ORIGINAL as the resume target
      // Record the resumed task in the registry (continuation of whatever is active).
      if (currentTaskId) {
        activeTaskId = currentTaskId;
        updateTask(currentTaskId, { status: 'active', query: original, plan: plan.steps || [] });
      }
    } else {
      // CONTINUITY — resolve follow-up messages against the recent conversation
      // before planning, so "give me a roadmap for a beginner in this course"
      // becomes "…in computer science" (ChatGPT-style context awareness). Only
      // triggers on context-dependent messages; self-contained ones pass free.
      const resolved = await resolveConversationalQuery(query);
      if (resolved.resolved && resolved.query && resolved.query !== raw) {
        effectiveQuery = resolved.query;
        sendEvent('log', {
          agent: 'Context Agent',
          message: `✓ Resolved “${raw.slice(0, 60)}” → “${resolved.query.slice(0, 100)}” (${resolved.reason}).`,
        });
      }

      // BUILD 47 — DECISION ENGINE: continue / switch / new / clarify.
      const decision = decide({
        raw,
        classification: analysis,
        taskId: analysis.taskId || null,
        candidates: analysis.candidates || [],
        currentTaskId,
        resolvedQuery: effectiveQuery,
      });

      if (decision.action === 'clarify') {
        // Never guess — ask a concise question instead of executing.
        sendEvent('intel', {
          classification: 'clarify', taskId: null, taskTitle: '',
          confidence: decision.metadata.confidence, reason: decision.metadata.reason,
          candidates: decision.clarification.options || [],
        });
        const opts = (decision.clarification.options || []).map((o) => `- **${o.id}** — ${o.label}`).join('\n');
        sendEvent('log', { agent: 'JEXI', message: `🤔 ${decision.clarification.question}` });
        done({
          success: true, query,
          summary: `### 🤔 One quick thing\n\n${decision.clarification.question}${opts ? `\n\n${opts}` : ''}\n\nTell me which one (or describe it in your own words) and I'll take it from there.`,
        });
        return;
      }

      // P6 — retrieve memory BEFORE classification so the planner sees what
      // JEXI already knows (preferences, facts, prior research) when deciding
      // the intent. Compact slice — never the full transcript.
      const plannerMemory = await buildPlannerMemory(effectiveQuery);
      // B53 P3 — the planner sees whether an active product task exists so
      // add/change/update/fix language routes to code modify, never research.
      plan = await planner.analyzeIntent(effectiveQuery, { image, memoryContext: plannerMemory, activeTaskId: currentTaskId || null });
      // B54 P1 — an offer is ONLY created when a run genuinely pauses for
      // confirmation (the onPause callback below). Never on every turn: that
      // made trivial acknowledgments ("ok", "sure", "please", "fine") re-plan
      // and re-execute the previous task, and re-ask for information already
      // given earlier in the conversation.

      // BUILD 47 — apply the decision: create or re-activate the task.
      const applied = applyDecision(decision, {
        title: raw.slice(0, 90),
        objective: effectiveQuery,
        plan: plan.steps || [],
        entities: [],
      });
      activeTaskId = applied.task?.id || decision.taskId || currentTaskId;
      if (activeTaskId && getTask(activeTaskId)) {
        updateTask(activeTaskId, { status: 'active', query: effectiveQuery, plan: plan.steps || [] });
      }
      // Resume context: continue/switch turns get the task's state injected so
      // the model plans a STEP, not a restart. (new turns pass through clean.)
      // Build 48, P3 — the label is neutral ("User's follow-up"), never the word
      // "Continue:", so the model acts on the context without narrating that
      // this continues a previous conversation.
      if (decision.contextBlock && (decision.metadata.classification === 'continue' || decision.metadata.classification === 'switch')) {
        executionQuery = `${decision.contextBlock}\n\nUser's follow-up: ${effectiveQuery}`;
      }
      sendEvent('intel', {
        classification: decision.metadata.classification,
        taskId: activeTaskId || null,
        taskTitle: applied.task?.title || (activeTaskId ? getTask(activeTaskId)?.title : '') || '',
        confidence: decision.metadata.confidence,
        reason: decision.metadata.reason,
        resumed: !!decision.metadata.resumed,
        taskCount: taskRegistryStats().total,
      });
    }

    // B53 P2 — HARD TASK/PRODUCT ISOLATION: switch the staging area to this
    // task BEFORE any file-touching node runs. Code/compound turns archive the
    // previous task's workspace, restore this task's snapshot (or start empty
    // for a brand-new product) — a calendar app NEVER sees the calculator's files.
    const CODE_INTENTS = new Set(['code_task', 'compound_task']);
    const isCodeTurn = CODE_INTENTS.has(plan.intent);
    if (activeTaskId && getTask(activeTaskId) && isCodeTurn) {
      try { activateTaskWorkspace(activeTaskId); } catch (e) {}
    }

    // GUARDRAIL — continuous prompt-injection / jailbreak / tool-abuse scan
    // on every message before anything runs. Blocked → abort with a clear
    // explanation instead of executing (safe-mode enforcement, Guardrail Agent).
    const safety = scanPromptSafety(effectiveQuery || raw);
    if (!safety.safe) {
      sendEvent('log', { agent: 'Guardrail', message: `🛡 ${safety.reason}` });
      sendEvent('done', { success: false, blocked: true, query, summary: blockExplanation(safety), statistics: { executionTime: 0, agentsUsed: 0, confidence: 0 } });
      return;
    }

    // OBSERVABILITY — trace the whole task (Observability Agent side-channel).
    const taskStart = Date.now();
    startTrace('chat.task', { intent: plan.intent, queryLen: (effectiveQuery || '').length });

    sendEvent('log', { agent: 'Planner', message: `Intent: ${plan.intent} — ${plan.reasoning}` });
    // B66 — the planner's complexity judgment is announced before anything
    // runs (auditable): SIMPLE → single-coworker fast path; COMPLEX → graph.
    sendEvent('log', { agent: 'Orchestrator', message: `🧭 Complexity: ${plan.complexity} — ${plan.complexityReason}` });
    // Structured plan event — the frontend's agent Core needs the composed
    // team (roster) to draw its orbital ring segments before agents start.
    sendEvent('plan', {
      intent: plan.intent,
      complexity: plan.complexity,
      complexityReason: plan.complexityReason,
      steps: plan.steps || [],
      roster: plan.roster || [],
      skillsLine: plan.skillsLine || '',
      rosterCatalogSize: plan.rosterCatalogSize || ROSTER_COUNT,
      skillCatalogSize: plan.skillCatalogSize || SKILL_COUNT,
      // AUTO TOOL ROUTING — the tool set derived for this task (Tool Router).
      tools: plan.tools || [],
      toolsLine: plan.toolsLine || '',
      toolCount: plan.toolCount || 0,
      // B49 P2/P4 — honest execution model: which composed agents ran as their
      // own observable pass (independent) vs personas folded into a composite
      // prompt (bundled). The frontend PLAN view can dim bundled members.
      execution: (() => {
        const m = executionModel(plan.intent, { steps: (plan.phases || []).flatMap((ph) => ph.agents || []) });
        const name = (slug) => getAgent(slug)?.name || slug;
        return { independent: m.independent.map(name), bundled: m.bundled.map(name) };
      })(),
    });
    // B66 — Orchestrator-Workers: SIMPLE tasks (single-shot intent) take the
    // single-coworker fast path — no graph construction at all. COMPLEX tasks
    // run the full typed-state graph as before. Both return the same contract.
    // B102 — PRESET (dsh agent-presets): standard | ptc | minimal | creator.
    // `preset` resolved above (mode block); an explicit x-jexi-mode /
    // x-jexi-code-mode header overrides it.
    const codeModeHeader = String(req.headers['x-jexi-code-mode'] || req.body.codeMode || (preset.codeMode ? '1' : '0')).toLowerCase();
    const codeMode = codeModeHeader !== '0' && codeModeHeader !== 'off' && codeModeHeader !== 'false';
    const presetFlavor = mode === 'normal' ? '' : preset.flavor;
    // B125 — RESEARCH is now DSH-style: the model drives web_search +
    // web_fetch itself (no team pipeline). Routes here for research intents.
    let results = null;
    // B126 — CODING is autonomous: the model drives bash/write/edit itself
    // (no 11-agent team). Routes here for code_task + compound_task.
    if (plan.intent === 'code_task' || plan.intent === 'compound_task') {
      results = await runAutonomousCoding({
        query: (executionQuery || effectiveQuery) + sessionRefInjected,
        convId,
        sendEvent,
        profile: activeToolProfile(),
      });
      // B128 — durable project memory: capsule the build so ANY conversation
      // can continue it by name ("continue the todo app").
      if (results.success) {
        try {
          saveProjectCapsule({
            name: raw.replace(/^\/build\s+/i, '').replace(/^(please\s+)?(build|make|create|write)\s+(me\s+)?(a|an|the)?\s*/i, ''),
            files: results.files || [],
            summary: results.summary,
            previewUrl: results.preview,
            lastQuery: raw,
          });
        } catch { /* noop */ }
      }
      sendEvent('log', { agent: 'JEXI', message: '🎯 Build complete — here is the result.' });
    } else if (plan.intent === 'research' || plan.intent === 'learning_research') {
      results = await runDshResearch({
        query: (executionQuery || effectiveQuery) + sessionRefInjected,
        convId,
        sendEvent,
        profile: activeToolProfile(),
      });
      sendEvent('log', { agent: 'JEXI', message: '🎯 Research complete — here is the result.' });
    } else if (plan.complexity === 'SIMPLE') {
      results = await runSimpleTask(plan, (executionQuery || effectiveQuery) + sessionRefInjected, sendEvent, { image, codeMode, convId, presetFlavor });
    } else {
      results = await orchestrator.executePlan(plan, (executionQuery || effectiveQuery) + sessionRefInjected, sendEvent, {
          image,
          // B53 P2 — task scope for the run: the orchestrator gates memory reuse
      // and writes durable checkpoints keyed to this taskId.
      taskId: activeTaskId || null,
      // B53 P2 — continuation turns (continue/switch/resume) may reuse the
      // task's saved coding memory; brand-new product tasks must not.
      isContinuation: hasPending || ['continue', 'switch'].includes(intelClassification),
      // P5 — when a node pauses for approval, persist the FULL RunState so a
      // later "yes" resumes at the exact paused node, prior results intact.
      onPause: async (pausedState) => {
        saveRun(convId, { plan, query: executionQuery || effectiveQuery, state: pausedState });
        // B54 P1 — the pending offer is created HERE (only for real pauses),
        // so "yes" resumes the actual paused action and nothing else can
        // re-trigger a previous task.
        saveOffer(convId, executionQuery || effectiveQuery);
      },
    });
    }

    // B53 P2 — snapshot the finished task's workspace so a later "go back to
    // the calculator" restores the exact artifacts, and the NEXT product task
    // never inherits them.
    if (activeTaskId && getTask(activeTaskId) && isCodeTurn && results.files?.length) {
      try { archiveTaskWorkspace(activeTaskId); } catch (e) {}
    }

    // OBSERVABILITY — close the trace with real latency + outcome metrics.
    endTrace('chat.task', results.success ? 'ok' : 'error', { intent: plan.intent });
    emitMetric('chat.latencyMs', Date.now() - taskStart, { intent: plan.intent, ok: results.success });
    emitMetric('chat.agents', plan.steps?.length || 0, { intent: plan.intent });
    emitMetric('chat.gate.result', results.success ? 1 : 0, { intent: plan.intent });

    // B110 — if the run parked user questions (ask_user_question), surface
    // them as cards after the answer so the user can reply.
    try {
      const pq = getPending(convId);
      if (pq) sendEvent('ask.user', { conv: convId, questions: pq.questions });
    } catch { /* noop */ }
    // B112 — when the run presented a plan (exit_plan_mode), save the resume
    // offer so "approve"/"yes" re-runs the ORIGINAL task (was missing → the
    // approval never resumed anything).
    try {
      const cp = currentPlan(convId);
      if (cp && cp.status === 'pending_review') saveOffer(convId, raw);
    } catch { /* noop */ }
    // B113 — PLAN-AND-EXECUTE: after the planning turn, auto-approve and run
    // the ORIGINAL task immediately. The user never approves or answers —
    // they just see the plan, then the execution updates.
    if (planAutoExecute) {
      try {
        const cp = currentPlan(convId);
        if (cp && cp.status === 'pending_review') {
          approvePlan(convId);
          setPlanMode(convId, false);
          const original = (loadOffer(convId) || {}).query || lastUserChatText(convId) || (executionQuery || effectiveQuery);
          sendEvent('log', { agent: 'Planner', message: `📋 Plan ready — executing now: “${String(original).slice(0, 90)}”` });
          const p2 = await planner.planConfirmed(original);
          results = p2.complexity === 'SIMPLE'
            ? await runSimpleTask(p2, original, sendEvent, { image, codeMode, convId, presetFlavor })
            : await orchestrator.executePlan(p2, original, sendEvent, {
                image,
                taskId: activeTaskId || null,
                isContinuation: true,
                onPause: async (pausedState) => { saveRun(convId, { plan: p2, query: original, state: pausedState }); saveOffer(convId, original); },
              });
          sendEvent('log', { agent: 'JEXI', message: '🎯 Implementation complete — here is the result.' });
        }
      } catch (e) {
        results = { success: false, error: String((e && e.message) || e), summary: `Implementation failed after planning: ${(e && e.message) || e}` };
      }
    }
    sendEvent('log', { agent: 'JEXI', message: '🎯 Mission complete — here is the result.' });
    // B132 — telemetry + durable checkpoint after each completed turn.
    try {
      recordTelemetry({
        latencyMs: Date.now() - taskStart,
        intent: plan.intent,
        ok: results.success !== false,
        complexity: results.statistics?.complexity || plan.complexity,
        toolCalls: results.statistics?.toolCalls || 0,
        providers: results.statistics?.provider ? [results.statistics.provider] : [],
        sourceCount: results.sources?.length || 0,
        fileCount: results.files?.length || 0,
        userId: anonymousUserId(), // B133 — per-device aggregate key (no PII)
      });
    } catch { /* noop */ }
    try { maybeCheckpoint(convId); } catch { /* noop */ }
    // Contract: a successful done ALWAYS carries a readable summary — the
    // frontend never renders a blank answer (an empty summary previously left
    // users staring at the activity log with no chat reply).
    // B66 — the orchestrator normalizes EVERY final answer's formatting
    // (math delimiters, blank lines, trailing whitespace) before it reaches
    // the user, regardless of which coworker produced the content.
    const finalSummary = results.summary && String(results.summary).trim()
      ? normalizeFinalAnswer(results.summary)
      : results.success
        ? '✅ Task completed — the team finished, but returned no readable summary. Check the activity log above to see what ran.'
        : (results.error || 'The task failed — check the activity log for details.');
    sendEvent('done', { success: results.success, query, summary: finalSummary, sources: results.sources || [], statistics: results.statistics, files: results.files || [] });

    // BUILD 47 — TASK STATE UPDATE: record what this turn completed so the next
    // "continue" resumes from here instead of restarting.
    if (activeTaskId && getTask(activeTaskId)) {
      updateTask(activeTaskId, {
        status: results.success === false ? 'failed' : 'completed',
        query: effectiveQuery,
        plan: plan.steps || [],
        completedSteps: plan.steps || [],
        result: finalSummary.slice(0, 2000),
        filesChanged: results.files || [],
        // B54 P6 — a task is only "verified" when the code actually ran clean;
        // best-effort builds that never passed the success predicate stay honest.
        verified: results.success === true && results.statistics?.runClean !== false,
      });
    }
    // BUILD 47 — MEMORY WRITE POLICY: only substantive user requirements /
    // corrections / continuations become provenanced memory (never casual chat).
    if (!image && intelClassification && ['continue', 'switch'].includes(intelClassification) && raw.length > 25 && !DECLINE_RE.test(raw) && !CONFIRM_RE.test(raw)) {
      try {
        recordDecision({ type: 'requirement', content: raw.slice(0, 300), source: 'user', taskId: activeTaskId || '', confidence: 'direct' });
      } catch (e) { /* memory must never break the chat */ }
    }

    // Mem0-style preference learning — fire-and-forget in the background so it
    // never delays the reply or breaks the stream. JEXI learns what the user
    // likes and how they like things done, then applies it to every future task.
    learnFromExchange(effectiveQuery).catch(() => {});
    // Context compaction — compress older turns into the running conversation
    // summary (Context Manager). Fire-and-forget so the NEXT turn has it ready.
    rollingConversationSummary().catch(() => {});
  } catch (error) {
    recordError('chat', error.message);
    sendEvent('log', { agent: 'System', message: `Critical Error: ${error.message}` });
    // B66 — graceful degradation: a total provider failure is reported as an
    // honest, readable degraded message — never a raw error dump.
    if (/All AI providers failed|No API keys configured/.test(String(error && error.message || ''))) {
      done({
        success: false,
        degraded: true,
        error: error.message,
        summary: '### ⚠ JEXI OS — degraded mode\n\nI\'m having trouble reaching my usual AI resources right now, so I can\'t produce a full answer at the moment. No provider completed the request.\n\nWhat you can do:\n- Try again in a minute or two — rate limits and temporary outages usually clear quickly.\n- Check that your model keys are valid in **Settings → Models** (and the matching env vars on Render).\n- If you run a local model (Ollama), set \`OLLAMA_BASE_URL\` and I\'ll route through it automatically.\n\nI\'m not going to guess or pretend — that\'s the honest status right now.',
      });
    } else {
      sendEvent('done', { success: false, error: error.message });
    }
  } finally { finished = true; clearTimeout(deadline); clearActiveSession(); finish(); }
});

// LIVE PROVIDER TEST — fires one tiny request through EVERY configured provider
// and reports which keys actually work end-to-end (configured ≠ working). Useful
// right after adding a key on Render: redeploy, then hit /api/health/providers.
// B66 — memory persistence probe: proves DATA_DIR (sessions, memory.json)
// survives restarts on this host (previous boot stamps present ⇒ persistent
// disk mounted, e.g. a Render persistent disk at DATA_DIR).
app.get('/api/health/memory', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await memoryPersistenceProbe());
});

app.get('/api/health/providers', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await testAllProviders();
    res.json({ ok: true, time: new Date().toISOString(), ...result, catalog: TOOL_REGISTRY.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e && e.message) || String(e) });
  }
});

// === BACKGROUND TASKS (roadmap stage 8 — the task.* event vocabulary) ===
// Unlike /api/chat (synchronous — the connection stays open until the mission
// ends), tasks run in the background and stream `task.*` events to any number
// of subscribers. The list survives restarts (DATA_DIR/tasks.json).
app.get('/api/tasks', (req, res) => {
  res.json({ tasks: taskManager.list().map((t) => taskManager.publicTask(t, false)) });
});

app.post('/api/tasks', (req, res) => {
  const { query, image } = req.body || {};
  if (!query || !String(query).trim()) {
    return res.status(400).json({ success: false, error: 'No query provided' });
  }
  const task = taskManager.createTask(String(query).trim(), image || null);
  res.json({ success: true, task: taskManager.publicTask(task, false) });
});

app.get('/api/tasks/:id', (req, res) => {
  const task = taskManager.get(req.params.id);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
  res.json({ success: true, task: taskManager.publicTask(task, true) });
});

// NDJSON live stream — replays history then pushes live task.* events.
// Ends when the task reaches a terminal state.
app.get('/api/tasks/:id/events', (req, res) => {
  const task = taskManager.get(req.params.id);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  taskManager.subscribe(req.params.id, res);
});

app.post('/api/tasks/:id/cancel', (req, res) => {
  const task = taskManager.cancel(req.params.id);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
  res.json({ success: true, task: taskManager.publicTask(task, false) });
});

// Re-run a mission (same query, fresh task) — the honest "continue where it
// stopped" for tasks that failed, were cancelled, or finished long ago.
app.post('/api/tasks/:id/rerun', (req, res) => {
  const old = taskManager.get(req.params.id);
  if (!old) return res.status(404).json({ success: false, error: 'Task not found' });
  const task = taskManager.createTask(old.query, old.image);
  res.json({ success: true, task: taskManager.publicTask(task, false) });
});

app.delete('/api/tasks/:id', (req, res) => {
  res.json({ success: taskManager.remove(req.params.id) });
});

// === AUTOMATIONS (roadmap stage 23 — recurring missions; Build 82 — goals) ===
// A schedule is a query + cadence (everySeconds interval or dailyAt HH:MM).
// kind 'task' launches a TaskManager mission; kind 'goal' launches a durable
// autonomous GOAL JOB (preflight questions, auto-approvals, restart survival,
// completion notification + email report). Schedules survive restarts
// (DATA_DIR/schedules.json); a missed run fires once as a catch-up.
app.get('/api/schedules', (req, res) => {
  res.json({ schedules: taskScheduler.list().map((s) => taskScheduler.publicSchedule(s)) });
});

app.post('/api/schedules', (req, res) => {
  const { query, everySeconds, label, image, kind, autonomy, dailyAt } = req.body || {};
  const result = taskScheduler.create({ query, everySeconds, label, image, kind, autonomy, dailyAt });
  if (result.error) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true, schedule: result.schedule });
});

app.post('/api/schedules/:id/pause', (req, res) => {
  const s = taskScheduler.pause(req.params.id);
  if (!s) return res.status(404).json({ success: false, error: 'Schedule not found' });
  res.json({ success: true, schedule: s });
});

app.post('/api/schedules/:id/resume', (req, res) => {
  const s = taskScheduler.resume(req.params.id);
  if (!s) return res.status(404).json({ success: false, error: 'Schedule not found' });
  res.json({ success: true, schedule: s });
});

app.post('/api/schedules/:id/run-now', (req, res) => {
  const s = taskScheduler.runNow(req.params.id);
  if (!s) return res.status(404).json({ success: false, error: 'Schedule not found' });
  res.json({ success: true, schedule: s });
});

app.delete('/api/schedules/:id', (req, res) => {
  res.json({ success: taskScheduler.remove(req.params.id) });
});

// Health endpoint used by the load balancer's active probes (and the keep-alive
// cron) — must be fast, never cached, and identify the exact instance.
// B120 — build stamp: /api/health exposes which commit the live instance is
// running, so a stale Render deploy is instantly detectable (the freeze the
// user hit was a live instance running pre-B116 code).
let BUILD_STAMP = null;
try {
  BUILD_STAMP = JSON.parse(fs.readFileSync(path.join(SERVER_ROOT, 'build-stamp.json'), 'utf-8'));
} catch { /* noop */ }
// B121 — Render injects RENDER_GIT_COMMIT on every deploy: the health stamp
// then reports the ACTUAL live commit (the static file was going stale).
const LIVE_COMMIT = process.env.RENDER_GIT_COMMIT || (BUILD_STAMP && BUILD_STAMP.commit) || 'unknown';

app.get('/api/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    name: 'JEXI OS Brain',
    version: '1.0.0',
    build: { ...(BUILD_STAMP || {}), commit: LIVE_COMMIT, live: true },
    instanceId: INSTANCE_ID,
    uptime: Math.round(process.uptime()),
    redis: isRedisActive(),
    redisDetail: redisConnectionInfo(),
    port: PORT,
    providers: providerHealthSnapshot(),
    // Round-6 platform & reliability status (aggregates only — no secrets)
    platform: {
      observability: { spans: metricsSummary().spans.total, running: metricsSummary().spans.running },
      guardrail: { safeMode: isSafeMode() },
      offline: { configured: !!(process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST) },
      voice: { active: voiceStatus().active, state: voiceStatus().state },
      plugins: listPluginPackages().length,
      locks: listLocks().length,
      chaos: chaosEnabled(),
    },
    time: new Date().toISOString(),
  });
});

// Live metrics (Observability Agent) — aggregates + recent trace metadata only,
// never request payloads or secrets. Open (uptime monitors can poll it).
app.get('/api/metrics', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const m = metricsSummary();
  res.json({
    ok: true,
    instanceId: INSTANCE_ID,
    uptime: Math.round(process.uptime()),
    providerHealth: scoreProviderHealth(providerHealthSnapshot()),
    ...m,
  });
});

// === SELF-MONITORING (JEXI diagnoses her own system + reads her own source) ===
app.get('/api/self/status', (req, res) => res.json(collectSystemStatus()));
app.get('/api/self/source', (req, res) => res.json(readSourceFile(req.query.path || '')));

// === SINGLE-CONTAINER MODE ===
// When the frontend is built into server/public (Hugging Face Spaces Docker image),
// serve it from here so the whole app runs on ONE free host — same origin, no CORS.
const publicDir = path.join(SERVER_ROOT, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/desktop-api')) return next();
    res.sendFile(path.join(publicDir, 'index.html'));
  });
} else {
  // API-only deployment (Render): give the bare domain a friendly status page
  // instead of Express's default "Cannot GET /".
  app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const providers = providerHealthSnapshot();
    const configured = providers.filter(p => p.configured).length;
    const rows = providers.map(p => {
      const status = p.configured ? (p.inCooldown ? 'cooldown' : 'configured') : 'not set';
      const color = p.configured ? (p.inCooldown ? '#FBBF24' : '#00FF9D') : '#616166';
      return `<tr><td style="padding:6px 10px;border-bottom:1px solid #1F1F23;color:#E5E5E7">${p.provider}</td><td style="padding:6px 10px;border-bottom:1px solid #1F1F23;color:${color}">${status}</td></tr>`;
    }).join('');
    res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JEXI OS Brain</title></head>
<body style="margin:0;background:#030303;color:#E5E5E7;font-family:Inter,-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh">
<div style="max-width:560px;padding:40px 24px;width:100%">
<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
<span style="width:10px;height:10px;border-radius:50%;background:#00FF9D;box-shadow:0 0 12px #00FF9D"></span>
<span style="font-size:14px;letter-spacing:2px;text-transform:uppercase;color:#00FF9D">JEXI OS Brain</span>
</div>
<h1 style="margin:0 0 4px;font-size:28px;color:#F5F5F7">Online</h1>
<p style="margin:0 0 24px;color:#A1A1AA;font-size:14px">v1.0.0 · up ${Math.round(process.uptime())}s · port ${PORT} · redis ${isRedisActive() ? 'on' : 'off'}</p>
<p style="margin:0 0 12px;color:#A1A1AA;font-size:13px">${configured} of ${providers.length} AI providers configured</p>
<table style="border-collapse:collapse;width:100%;background:#0A0A0B;border:1px solid #1F1F23;border-radius:12px;overflow:hidden;font-size:13px">${rows}</table>
<div style="margin-top:20px;font-size:13px;color:#A1A1AA">
<a href="/api/health" style="color:#00FF9D;text-decoration:none">/api/health</a> ·
<a href="/api/roster" style="color:#00FF9D;text-decoration:none">/api/roster</a> ·
<a href="/api/health/providers" style="color:#00FF9D;text-decoration:none">live key test</a>
</div>
</div></body></html>`);
  });
}

// Fail-closed binding: without a key (and without the explicit escape hatch)
// the server only listens on loopback — a key-less instance can never be
// reached from the public internet.
const BIND_HOST = (!API_KEY && !ALLOW_UNLOCKED) ? '127.0.0.1' : '0.0.0.0';
if (!API_KEY && !ALLOW_UNLOCKED) {
  console.warn('\n⚠ JEXI OS started WITHOUT JEXI_API_KEY — binding to 127.0.0.1 only (fail-closed).\n  Any public deployment needs JEXI_API_KEY set. To force the old wide-open\n  behavior set JEXI_ALLOW_UNLOCKED=1 (NOT recommended).\n');
}

app.listen(PORT, BIND_HOST, () => {
  console.log(`🧠 JEXI OS BRAIN running on port ${PORT}`);
  // Chromium is launched LAZILY on first desktop/QA use, never held resident at
  // boot: on small hosts (512MB) a permanently-open browser + concurrent page
  // parsing during search was OOM-killing the process mid-request.
});
