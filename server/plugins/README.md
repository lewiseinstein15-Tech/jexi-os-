# JEXI OS — Plugin Packages

Plugins are versioned, shareable feature bundles dropped into
`server/plugins/`. PluginRegistry discovers them on boot and lets the user
enable/disable them at runtime (state persists to `DATA_DIR/plugins.json`).

## Package format

```
server/plugins/<plugin-name>/
  plugin.json     # required manifest
  skills/         # optional — skill folders this plugin provides
  agents/         # optional — reusable agent definition files
```

### plugin.json

```json
{
  "id": "my-plugin",              // unique slug
  "name": "My Plugin",            // display name
  "version": "1.0.0",             // semver
  "description": "What it does.",
  "contributes": {
    "agents": ["slug-a", "slug-b"],   // roster slugs it enables
    "skills": ["skill-1"],            // skill slugs it provides
    "tools": ["tool-1"],              // tool slugs it provides
    "skillsDir": "skills"             // where its skill folders live
  }
}
```

### Skills inside a plugin

Each skill is a progressive-disclosure folder (`SKILL.md` + `reference.md`,
same format as `server/skills/`). SkillChain resolves a slug in this order:

1. `server/skills/<slug>/` (core skills)
2. `server/plugins/*/skills/<slug>/` (plugin-provided skills)
3. flat `server/skills/<slug>.md`
4. roster synthesis (logged fallback)

## Built-in plugins

| id | name | notes |
|---|---|---|
| `core` | JEXI Core | always on; cannot be disabled |
| `research-pack` | Research Pack | search/deep-read/news/books |
| `coding-pack` | Coding Pack | built-in coding specialists (catalog) |
| `coding-pipeline` | Coding Pipeline | **on-disk** — progressive skill folders |
| `data-pack` | Data & Quant Pack | data/statistics/charts |
| `media-pack` | Media & Vision Pack | video/vision/OCR |
| `life-pack` | Life & Productivity Pack | meal/fitness/study/productivity |

## Share / install

Drop a folder into `server/plugins/` and restart — PluginRegistry discovers it,
`listPlugins()` shows its contributions, and `togglePlugin(id)` enables it.
