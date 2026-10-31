/**
 * JEXI OS — benchmarks/humaneval-live/lib/schema-patch.mjs
 *
 * DIAGNOSTIC ONLY. Not part of the as-shipped baseline.
 *
 * As shipped, JEXI advertises its domain tools (fs_write, term_execute, …)
 * to the model with an EMPTY parameter schema. `resolveToolDef` returns a
 * probe stub `{slug,name,desc,permission}` for anything that lives in the
 * domain registry, dropping the real `parameters`; `buildNativeSchemas` then
 * falls back to `TOOL_SCHEMAS[slug]`, which has no entry for domain tools,
 * and emits `{type:'object', properties:{}, required:[]}`. The model is told
 * fs_write takes no arguments, so it calls `fs_write {}` — and the execute
 * gate, which validates against the REAL schema from the domain registry,
 * rejects it with `missing required property "path"`.
 *
 * This module repairs the ADVERTISEMENT at runtime (inside the harness, never
 * in JEXI source) by copying the real schemas out of the domain registry into
 * TOOL_SCHEMAS. Running the benchmark with and without it separates two very
 * different claims:
 *
 *   "JEXI's agent cannot write code"          (a model-capability claim)
 *   "JEXI never told its model how to call a tool" (a wiring bug)
 *
 * The as-shipped number is the headline. This leg is the ablation.
 */

const SERVER = '/workspace/project/jexi-os-/server';

/** JSON-Schema {properties,required} → the flat shape buildNativeSchemas reads. */
function flatten(jsonSchema) {
  const props = (jsonSchema && jsonSchema.properties) || {};
  const required = new Set((jsonSchema && jsonSchema.required) || []);
  const flat = {};
  for (const [k, spec] of Object.entries(props)) {
    flat[k] = {
      type: spec && spec.type ? spec.type : 'string',
      required: required.has(k),
      desc: (spec && (spec.description || spec.desc)) || '',
    };
  }
  return flat;
}

/**
 * Populate TOOL_SCHEMAS for every tool in the domain registry that is
 * missing an entry. Idempotent; returns the list of repaired slugs.
 */
export async function patchDomainSchemas() {
  const { domainExecutor } = await import(`${SERVER}/src/tools/domains/executor.js`);
  domainExecutor();
  const domainReg = await import(`${SERVER}/src/tools/registry/ToolRegistry.js`);
  const { TOOL_SCHEMAS } = await import(`${SERVER}/src/services/ToolRuntime.js`);

  const repaired = [];
  for (const def of domainReg.listTools()) {
    if (TOOL_SCHEMAS[def.name]) continue;
    const flat = flatten(def.parameters);
    if (Object.keys(flat).length === 0) continue;
    TOOL_SCHEMAS[def.name] = flat;
    repaired.push(def.name);
  }
  return repaired;
}
