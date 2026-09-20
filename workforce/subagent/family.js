/**
 * Decide whether a directed message stays inside an agent's nuclear family.
 * The graph is deliberately only an in-memory caller-provided graph: this
 * module neither consults nor creates daemon/session state.
 */
function refusal(relation) {
  return {
    allowed: false,
    reason: `${relation} relationship is outside the nuclear family`,
    errorCode: 'E_OUT_OF_FAMILY',
  };
}

function graphIndex(agentGraph) {
  if (!agentGraph || !Array.isArray(agentGraph.agents)) return null;
  const byId = new Map();
  for (const agent of agentGraph.agents) {
    if (!agent || typeof agent !== 'object' || typeof agent.id !== 'string' || !agent.id) return null;
    if (agent.parentId != null && (typeof agent.parentId !== 'string' || !agent.parentId)) return null;
    if (byId.has(agent.id)) return null;
    byId.set(agent.id, agent);
  }
  return byId;
}

function lineage(agent, byId) {
  const entries = [];
  const seen = new Set([agent.id]);
  let current = agent;
  while (current.parentId != null) {
    const parent = byId.get(current.parentId);
    if (!parent) break; // A missing lineage record cannot grant access.
    if (seen.has(parent.id)) return null;
    seen.add(parent.id);
    entries.push(parent);
    current = parent;
  }
  return entries;
}

function siblings(left, right) {
  return left.parentId != null && left.parentId === right.parentId;
}

/**
 * @returns {{allowed:boolean, relation?:'parent'|'sibling'|'child', reason?:string, errorCode?:'E_OUT_OF_FAMILY'|'E_AGENT_GRAPH'}}
 */
export function assertInScope(from, to, agentGraph) {
  const byId = graphIndex(agentGraph);
  if (!byId) {
    return { allowed: false, reason: 'invalid agent graph', errorCode: 'E_AGENT_GRAPH' };
  }

  const sender = byId.get(from);
  const recipient = byId.get(to);
  // An unknown identity is intentionally an out-of-family stranger rather
  // than an authorization success caused by a partial graph.
  if (!sender || !recipient) return refusal('stranger');
  if (sender.id === recipient.id) return refusal('self');

  const senderLineage = lineage(sender, byId);
  const recipientLineage = lineage(recipient, byId);
  if (!senderLineage || !recipientLineage) {
    return { allowed: false, reason: 'cyclic lineage', errorCode: 'E_AGENT_GRAPH' };
  }

  if (sender.parentId === recipient.id) return { allowed: true, relation: 'parent' };
  if (recipient.parentId === sender.id) return { allowed: true, relation: 'child' };
  if (siblings(sender, recipient)) return { allowed: true, relation: 'sibling' };

  const senderParent = senderLineage[0];
  const recipientParent = recipientLineage[0];
  if (senderParent && siblings(senderParent, recipient)) return refusal('uncle');
  if (recipientParent && siblings(sender, recipientParent)) return refusal('nephew');
  if (senderParent && recipientParent && siblings(senderParent, recipientParent)) return refusal('cousin');

  const recipientDepth = senderLineage.findIndex(agent => agent.id === recipient.id);
  if (recipientDepth >= 0) return refusal(recipientDepth === 1 ? 'grandparent' : 'ancestor');
  const senderDepth = recipientLineage.findIndex(agent => agent.id === sender.id);
  if (senderDepth >= 0) return refusal(senderDepth === 1 ? 'grandchild' : 'descendant');

  return refusal('stranger');
}

export default { assertInScope };
