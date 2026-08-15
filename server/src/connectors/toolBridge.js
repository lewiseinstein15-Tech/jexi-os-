/**
 * JEXI OS — Connector → Agent Tool Bridge (Build 56).
 *
 * Agents never call connector internals directly. This module turns a
 * registered connector into an OpenAI/Anthropic-style function tool
 * (`send_email`, `create_github_issue`-style) that the agent loop can
 * invoke through the gated `connector-call` tool.
 *
 * The schema is NOT a hardcoded stub: it introspects the connector's actual
 * send() method signature via Function#toString, then expands each declared
 * parameter using the connector's own sendSchema() metadata (type + required
 * + description). Connectors that declare `send(payload)` get their payload
 * fields expanded; connectors with multiple named params map 1:1.
 */

import { ConnectorRegistry } from './ConnectorRegistry.js';

/** Parse the parameter names a method actually declares (real introspection). */
export function introspectSendSignature(connector) {
  const proto = connector.constructor && connector.constructor.prototype;
  const fn = proto && typeof proto.send === 'function' ? proto.send : connector.send;
  const src = Function.prototype.toString.call(fn);
  const m = src.match(/async\s+send\s*\(([\s\S]*?)\)\s*\{/);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((p) => p.trim().replace(/\s*=\s*[\s\S]*$/, '').replace(/^\{.*/, 'payload'))
    .filter(Boolean);
}

const JSON_TYPES = new Set(['string', 'number', 'boolean', 'object', 'array']);

function specToJsonType(spec) {
  const t = spec && spec.type;
  return JSON_TYPES.has(t) ? t : 'string';
}

/** True when the connector declares a single object payload to expand. */
function isPayloadParam(param, sendSchema) {
  return param === 'payload' || (sendSchema[param] && sendSchema[param].type === 'object' && Object.keys(sendSchema).length === 1);
}

/**
 * Build the agent tool definition for one connector.
 * Returns { type: 'function', function: { name, description, parameters } }.
 */
export function connectorToToolSchema(name) {
  const connector = ConnectorRegistry.get(name);
  const toolName = (connector.constructor.toolName || name).replace(/^send_/, '');
  const declaredParams = introspectSendSignature(connector);
  const sendSchema = typeof connector.constructor.sendSchema === 'function' ? connector.constructor.sendSchema() : {};

  const properties = {};
  const required = [];

  for (const param of declaredParams) {
    if (isPayloadParam(param, sendSchema)) {
      // Expand the single object payload into its declared fields.
      for (const [field, spec] of Object.entries(sendSchema)) {
        properties[field] = { type: specToJsonType(spec), description: spec.desc || spec.description || '' };
        if (spec.required) required.push(field);
      }
    } else if (sendSchema[param]) {
      const spec = sendSchema[param];
      properties[param] = { type: specToJsonType(spec), description: spec.desc || spec.description || '' };
      if (spec.required) required.push(param);
    } else {
      properties[param] = { type: 'string', description: `${param} — argument for ${toolName} send()` };
    }
  }

  // Connectors whose send() declares only `payload` (expanded above) are
  // handled; if nothing was introspected, fall back to the schema fields so
  // the tool is still fully usable (never an empty stub).
  if (!Object.keys(properties).length) {
    for (const [field, spec] of Object.entries(sendSchema)) {
      properties[field] = { type: specToJsonType(spec), description: spec.desc || spec.description || '' };
      if (spec.required) required.push(field);
    }
  }

  return {
    type: 'function',
    function: {
      name: `send_${toolName}`,
      description: connector.toolDescription(),
      parameters: { type: 'object', properties, required: [...new Set(required)] },
    },
  };
}

/** Schemas for every registered connector (stable order). */
export function listConnectorTools() {
  return ConnectorRegistry.listAvailable().map((name) => connectorToToolSchema(name));
}

/** Tool names only, e.g. ['send_email', 'create_github_issue']. */
export function listConnectorToolNames() {
  return listConnectorTools().map((t) => t.function.name);
}

/** Map tool name → { connector, schema } so the agent loop can route a call. */
export function connectorToolIndex() {
  const index = {};
  for (const name of ConnectorRegistry.listAvailable()) {
    const schema = connectorToToolSchema(name);
    index[schema.function.name] = { connector: name, schema };
  }
  return index;
}
