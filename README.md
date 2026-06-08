# gsd-mcp-server

MCP server for the [GSD (Get Shit Done)](https://opencode.ai) lifecycle framework. Exposes GSD project state, phases, milestones, and commands as MCP tools and resources.

[![npm version](https://img.shields.io/npm/v/@md0ar/gsd-mcp-server)](https://www.npmjs.com/package/@md0ar/gsd-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-6C47FF)](https://registry.modelcontextprotocol.io)

## Features

- **34 tools** — manage project lifecycle via MCP tool calls
- **6 resources** — read project files (state, roadmap, requirements, config, help)
- **Zod-validated inputs** — type-safe parameter validation
- **Secure execution** — no shell injection (`execFileSync` with argument arrays)

## Quick Start

Run instantly with npx (no install needed):

```bash
npx -y @md0ar/gsd-mcp-server

Or install globally:

```bash
npm install -g @md0ar/gsd-mcp-server
```

## Configuration

### opencode.jsonc

```jsonc
{
  "mcp": {
    "gsd-mcp-server": {
      "type": "local",
      "command": ["npx", "-y", "@md0ar/gsd-mcp-server"],
      "enabled": true,
      "timeout": 30000
    }
  }
}
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "gsd-mcp-server": {
      "command": "npx",
      "args": ["-y", "@md0ar/gsd-mcp-server"]
    }
  }
}
```

### Cursor

`.cursor/mcp.json`

```json
{
  "mcpServers": {
    "gsd-mcp-server": {
      "command": "npx",
      "args": ["-y", "gsd-mcp-server"]
    }
  }
}
```

### VS Code

`.vscode/mcp.json`

```json
{
  "servers": {
    "gsd-mcp-server": {
      "command": "npx",
      "args": ["-y", "@md0ar/gsd-mcp-server"]
    }
  }
}
```

> Always use `-y` with `npx` to skip the confirmation prompt — MCP hosts need non-interactive execution.

## Requirements

- **Node.js 18+**
- **GSD framework** — the server wraps the [GSD CLI](https://opencode.ai). Install opencode to use the full GSD lifecycle.

## Tools

| Tool | Params | Description |
|------|--------|-------------|
| `gsd_state` | — | Current project state |
| `gsd_progress` | — | Next step in the GSD lifecycle |
| `gsd_new_project` | `name`, `description?` | Initialize a new project |
| `gsd_new_milestone` | `name` | Start a new milestone |
| `gsd_map_codebase` | — | Analyze existing codebase |
| `gsd_discuss_phase` | `phase` | Capture implementation decisions |
| `gsd_list_phases` | — | List roadmap phases |
| `gsd_plan_phase` | `phase` | Create task plans |
| `gsd_execute_phase` | `phase` | Execute phase plans |
| `gsd_verify_work` | `phase` | Verify phase work |
| `gsd_quick` | `task`, `full?` | Ad-hoc task |
| `gsd_debug` | `issue` | Systematic debugging |
| `gsd_spike` | `idea`, `quick?` | Throwaway experiment |
| `gsd_sketch` | `idea` | UI design sketch |
| `gsd_complete_milestone` | `version` | Archive milestone |
| `gsd_add_todo` | `description` | Capture todo |
| `gsd_check_todos` | `area?` | List pending todos |
| `gsd_ship` | `phase` | Create PR |
| `gsd_add_phase` | `description` | Add new phase |
| `gsd_insert_phase` | `after`, `description` | Insert phase |
| `gsd_settings` | — | Configure toggles |
| `gsd_set_profile` | `profile` | Switch model profile |
| `gsd_run` | `command` | Run any GSD command |
| `gsd_validate` | `check`, `repair?` | Run validation (consistency/health/agents) |
| `gsd_roadmap_analyze` | — | Full roadmap + disk status analysis |
| `gsd_phase_complete` | `phase` | Mark a phase as complete |
| `gsd_config_get` | `key` | Read config value |
| `gsd_config_set` | `key`, `value` | Write config value |
| `gsd_commit` | `message`, `files?` | Commit planning docs to git |
| `gsd_scaffold` | `type`, `phase`, `name?` | Create document templates |
| `gsd_audit_uat` | — | Scan phases for unresolved verification |
| `gsd_websearch` | `query`, `limit?`, `freshness?` | Web search via Brave API |
| `gsd_todo_complete` | `filename` | Mark todo as completed |
| `gsd_workstreams` | `action`, `name?` | Manage parallel workspaces |

## Resources

| URI | Description |
|-----|-------------|
| `gsd://state` | Current project state |
| `gsd://project` | Project definition |
| `gsd://roadmap` | Phase roadmap |
| `gsd://requirements` | Feature requirements |
| `gsd://config` | Planning config |
| `gsd://help` | Command reference |

## Testing

```bash
npm test
```

Runs 188 tests across three suites: 94 main + 37 edge + 57 functional (real GSD project).

## Publishing (for maintainers)

```bash
# 1. Log in to npm
npm login

# 2. Publish to npm
npm publish

# 3. Publish to MCP Registry (optional)
npx -y @modelcontextprotocol/publisher login
npx -y @modelcontextprotocol/publisher publish
```

Requirements:
- [npm account](https://www.npmjs.com/signup)
- [GitHub account](https://github.com/signup) (for MCP Registry auth)
- Granular Access Token with `Read and write` scope for CI/CD

## License

MIT
