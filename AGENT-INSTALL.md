# Agent Installation Guide

## Claude Code — Plugin Install (recommended)

```
/plugin marketplace add luan007/figma-slides-mcp
/plugin install figma-slides-mcp@figma-slides-mcp
```

This clones the repo and auto-loads the MCP server (via npx) and design skill. No `npm install` needed — the MCP server runs through npx from npm.

Then load the Figma plugin (see [Figma Plugin Setup](#figma-plugin-setup) below).

The Figma plugin files are in the cloned directory at `~/.claude/plugins/cache/figma-slides-mcp/`.

## Other MCP Clients (Cursor, Windsurf, etc.)

```bash
git clone https://github.com/luan007/figma-slides-mcp.git
cd figma-slides-mcp
npm install
```

Add to your client's MCP config:

```json
{
  "mcpServers": {
    "figma-slides": {
      "command": "node",
      "args": ["server/index.js"],
      "cwd": "/absolute/path/to/figma-slides-mcp"
    }
  }
}
```

## Figma Plugin Setup

The MCP server talks to Figma through a plugin. You need to load it once:

1. Open a **Figma Slides** file (not a regular Design file)
2. Go to **Plugins > Development > Import plugin from manifest...**
3. Navigate to `plugin/manifest.json` — this is inside the installed directory:
   - Plugin install: `~/.claude/plugins/figma-slides-mcp/plugin/manifest.json`
   - Git clone: wherever you cloned it
4. Click **Run** — green dot in the panel = connected

The plugin connects to `ws://localhost:3055`. You only need to import the manifest once — after that it appears in your recent plugins.

## Verify

Tell your AI agent:

```
Start a Figma Slides session
```

You should see:
- MCP server starts the WebSocket
- Plugin shows a green connection dot
- Agent confirms connection and document name

## Updating

```bash
# Plugin install
cd ~/.claude/plugins/figma-slides-mcp && git pull && npm install

# Git clone
cd figma-slides-mcp && git pull && npm install
```

Restart your AI agent to pick up changes. The Figma plugin auto-updates from the local folder.

## Troubleshooting

**"Port 3055 in use"** — Another instance is running. Close it, or set a different port: `export FIGMA_WS_PORT=3056`

**Plugin not connecting** — Make sure (1) the MCP server is running, (2) the plugin is running in Figma, and (3) you're in a Figma Slides file, not a Design file.

**"Font not found"** — Font names must be exact. Use `list_fonts(query: "Inter")` to check.

**Messy slides** — The bundled skill at `skills/figma-slides-mcp/SKILL.md` teaches layout, typography, and the screenshot-verify-fix loop. It loads automatically with the plugin install.

## What's included

| Component | Path | What it does |
|-----------|------|-------------|
| MCP Server | `server/` | Tools for creating/editing slides via stdio |
| Figma Plugin | `plugin/` | Bridge between MCP server and Figma canvas |
| Design Skill | `skills/figma-slides-mcp/` | Teaches AI agents slide design, D3 patterns, typography |
| MCP Config | `.mcp.json` | Auto-loaded by Claude Code plugin system |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FIGMA_WS_PORT` | `3055` | WebSocket port for plugin connection |
