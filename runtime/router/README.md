# ROUTER

L6 two-stage request->worker (classifier/resolver/override). Current: server/src/services/Planner.js, ProviderRouter.js, director/ModelRouter.js.

Phase 7(I) — agent resolution is now two-stage across BOTH registries
(`router/resolve.js` → `workforce/registry/resolve.js`):

1. **runtime registry** (Phase 2D Director roster, hot-path coworkers) — WINS
2. **canonical agent files** (`agents/<division>/<id>.agent.md`, 68 specialists,
   indexed by `workforce/registry/catalog.js`) — supplies the specialist pool

```js
const r = await require('./router/resolve').resolveTwoStage('review my TypeScript');
// → { source: 'canonical', id: 'typescript-reviewer', file: 'agents/engineering/typescript-reviewer.agent.md' }
```

See ../ARCHITECTURE.md for the full layer map.
