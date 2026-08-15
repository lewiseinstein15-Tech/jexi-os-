# Plugin packages

Load this folder when the task is about installing, writing or debugging plugins.

## Package format
Each plugin is a directory under `server/plugins/<plugin-name>/`:

```
server/plugins/<plugin-name>/
  plugin.json   # { id, name, version, description, contributes: { skills: [], agents: [] } }
  skills/       # progressive skill folders this plugin provides
  agents/       # optional reusable agent definition files
```

## Discovery & state
- PluginRegistry scans `server/plugins/*/plugin.json` at startup and merges discovered plugins with the built-in catalog.
- Enable/disable state persists to `DATA_DIR/plugins.json`; `core` can never be disabled.
- Skills contributed by DISABLED plugins are not loadable by SkillChain — toggling a plugin really toggles its skills.
- `listPlugins()` surfaces each plugin's `contributes` + live counts + enabled state.
