/**
 * JEXI OS — Phase 8 Scope C — ATTACK-CHAIN GRAPH (assembled).
 *
 * Binds the SQLite store, the five entity repos, the four edge repos and
 * the four queries into one object. This is the Decepticon pattern on
 * JEXI storage: findings live HERE; agents and pipeline phases query it.
 *
 *   const graph = open({ dbPath });
 *   graph.host.create({ hostname: '10.0.0.10', tags: ['dmz'] });
 *   graph.attackPaths({ fromType: 'host', fromId: 'host-…', toType: 'host', toId: 'host-…' });
 *   graph.close();
 */

import { openStore } from '../store.js';
import { HostEntity } from './entities/host.entity.js';
import { ServiceEntity } from './entities/service.entity.js';
import { VulnerabilityEntity } from './entities/vulnerability.entity.js';
import { ExploitEntity } from './entities/exploit.entity.js';
import { CredentialEntity } from './entities/credential.entity.js';
import { VerificationEntity } from './entities/verification.entity.js'; // Phase 8(G)
import { ConnectsToEdge } from './edges/connects-to.edge.js';
import { ExploitsEdge } from './edges/exploits.edge.js';
import { EscalatesToEdge } from './edges/escalates-to.edge.js';
import { MovesLateralToEdge } from './edges/moves-lateral-to.edge.js';
import { attackPaths } from './queries/attack-paths.js';
import { findingsBySeverity } from './queries/findings-by-severity.js';
import { coverage } from './queries/coverage.js';
import { shortestPath } from './queries/shortest-path.js';

export class KnowledgeGraph {
  constructor({ dbPath } = {}) {
    this.store = openStore({ dbPath });
    this.dbPath = this.store.dbPath;
    this.host = new HostEntity(this.store);
    this.service = new ServiceEntity(this.store);
    this.vulnerability = new VulnerabilityEntity(this.store);
    this.exploit = new ExploitEntity(this.store);
    this.credential = new CredentialEntity(this.store);
    this.verification = new VerificationEntity(this.store); // Phase 8(G): finding_verifications
    this.connectsTo = new ConnectsToEdge(this.store);
    this.exploits = new ExploitsEdge(this.store);
    this.escalatesTo = new EscalatesToEdge(this.store);
    this.movesLateralTo = new MovesLateralToEdge(this.store);
  }

  attackPaths(opts) { return attackPaths(this, opts); }
  findingsBySeverity() { return findingsBySeverity(this); }
  coverage() { return coverage(this); }
  shortestPath(opts) { return shortestPath(this, opts); }

  close() { this.store.close(); }
}
