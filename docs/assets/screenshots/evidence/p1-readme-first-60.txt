$ head -60 README.md
# JEXI OS

**Your own agentic OS: it plans, acts, remembers, and proves.**

<p>
  <a href="https://github.com/lewiseinstein15-Tech/jexi-os-/actions/workflows/ci.yml"><img src="https://img.shields.io/badge/build-CI-2ea44f" alt="CI build"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D22-339933" alt="Node.js 22 or newer"></a>
  <a href="https://github.com/lewiseinstein15-Tech/jexi-os-/stargazers"><img src="https://img.shields.io/github/stars/lewiseinstein15-Tech/jexi-os-?style=flat" alt="GitHub stars"></a>
  <a href="https://github.com/lewiseinstein15-Tech/jexi-os-/issues"><img src="https://img.shields.io/github/issues/lewiseinstein15-Tech/jexi-os-" alt="Open issues"></a>
</p>

![A real turn in the JEXI console: the question "What does the scheduler do?" typed into the composer, JEXI's narration, a read_file tool.started / tool.completed card pair, and the turn-end row](docs/assets/screenshots/hero-qa.png)

*A real turn, captured live: the question in the composer, JEXI's narration, the tool call and its result, and the closing turn-end row. No provider was configured for this capture, so the answer comes from the deterministic in-process agent; configure one provider and the same surface streams a model-backed answer.*

## What is JEXI?

JEXI is an agentic operating system: a runtime that runs a workforce of agents against your work, remembers what it learns, and can see and operate a screen. It is local-first and runs on Node.js 22+ as a web console in the browser, as a terminal-driven brain, or on a phone through the Android APK. It plugs into any OpenAI-compatible provider, local models, and MCP servers, and exposes a permission-gated tool catalog that covers files, terminal, git, GitHub, web, browser navigation, memory, testing, data, LSP, and delegation. What sets it apart is persistent memory with provenance behind a frozen five-verb protocol, vision-grounded computer control, a 30-event lifecycle hook system, and a receipt for every tool call so that what the agent claims can be checked against what it did.

## Capabilities

Every number below is read from the source tree in this repository; the derivation commands are listed in [`docs/assets/screenshots/evidence/capability-counts.txt`](docs/assets/screenshots/evidence/capability-counts.txt).

| Capability | Count | Where it lives |
|---|---|---|
| Agents in the workforce registry | **400** | `workforce/agents` (`list().length`) |
| Divisions | **18** | `workforce/divisions.json` |
| Built-in tools (12 domains) | **39** | `server/src/tools/domains` |
| Skills (`SKILL.md` catalog) | **1,164** | `skills/library` |
| MCP servers registered / enabled by default | **53 / 29** | `server/mcp/registry.json` |
| Tools exposed by the MCP directory | **538** | `server/mcp/tool-directory.json` |
| Web search engines (keyed, keyless, and mesh) | **20** | `server/src/services/WebSearch.js` |
| Computer-use actions | **16** | `server/src/services/ComputerUseTraining.js` |
| Lifecycle hook events | **30** | `harness/parity/hooks/catalog.js` |
| Memory verbs (frozen protocol v1.0) | **5** | `brain/protocol/verbs.js` |
| Dream-cycle phases | **13** | `brain/cycle/phases` |
| Console surfaces | **3** | `ui/web/console/shell/routes.js` |
| Research output formats | **12** | `surfsense/output/formats.js` |
| Source connectors | **16** | `surfsense/connectors` |
| Retrieval benchmark metrics | **P@5 / R@5** | `brain/evals/brainbench.js` |

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/assets/screenshots/chat-toolcards.png" alt="Tool cards in the chat transcript"><br>Tool receipts: the real <code>tool.started</code> and <code>tool.completed</code> cards for a <code>read_file</code> call, rendered in the transcript.</td>
    <td width="50%"><img src="docs/assets/screenshots/workgraph-nodes.png" alt="Work Graph route"><br>Work Graph: the mission graph route with its honest live state; this capture has zero nodes because no mission was running.</td>
  </tr>
  <tr>
    <td colspan="2"><img src="docs/assets/screenshots/settings-provider.png" alt="Settings route with provider configuration"><br>Settings: provider, model, and key reference. The key itself never goes in the form; only an environment-variable name or keyring reference.</td>
  </tr>
</table>

## A real example flow

You type a request that writes something: *"write a scheduler runbook with cron, event, and condition trigger details for the operations team."* JEXI opens a turn and narrates what it understood. Because the request needs `write_file`, which is a destructive tool, the runtime pauses the turn and renders an approval row; nothing is written until you click **approve**. On approval the tool starts, its `tool.started` and `tool.completed` receipts appear as cards carrying the exact arguments and result, JEXI narrates the outcome, and the turn closes with a `turn completed … ok` row. Every event in that sequence is the runtime's own event stream rendered live; the capture below is that moment.

![A completed write turn: narration, approval requested, approval approved, write_file tool.started and tool.completed cards, closing narration, and the turn-end row](docs/assets/screenshots/example-flow.png)

