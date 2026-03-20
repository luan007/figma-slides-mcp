# figma-slides-mcp

MCP server that lets AI create and edit Figma Slides — with built-in D3, Rough.js, and Satori renderers for charts, diagrams, and custom graphics.

![architecture](https://img.shields.io/badge/arch-MCP%20%2B%20WebSocket%20%2B%20Figma%20Plugin-blue) ![license](https://img.shields.io/badge/license-MIT-green) ![enjoy](https://img.shields.io/badge/ENJOY_😄-FF33BB)

## What this is

An MCP server that gives AI agents (Claude, Cursor, etc.) direct control over Figma Slides. The AI can create slides, add text, draw shapes, render D3 charts, place images, and screenshot its work — all in real-time, in your actual Figma file.

**This is not a design-to-code tool.** It goes the other direction: AI → Figma. Your agent designs slides for you.

## How it works

```
Your AI Agent ←—stdio—→ MCP Server ←—WebSocket—→ Figma Plugin ←—API—→ Slides Canvas
```

Three pieces:

1. **MCP Server** — Node.js process that exposes tools over stdio. Your AI client spawns it.
2. **Figma Plugin** — Runs inside Figma, executes commands on the canvas. Connects via WebSocket.
3. **Design Skill** (optional) — Teaches the AI how to design well: layout, typography, color, D3 patterns.

## Quick start

### Claude Code (recommended)

**Step 1 — Install the plugin:**

In Claude Code, run:
```
/plugin install luan007/figma-slides-mcp
```

This clones the repo, loads the MCP server config and design skill automatically.

**Step 2 — Load the Figma plugin:**

1. Open a **Figma Slides** file
2. **Plugins → Development → Import plugin from manifest...**
3. Navigate to the cloned plugin directory:
   ```
   ~/.claude/plugins/figma-slides-mcp/plugin/manifest.json
   ```
4. Run the plugin — green dot = connected

You only import the manifest once. After that it's in your recent plugins.

**Step 3 — Go:**

Tell Claude: **"Start a Figma Slides session"**

### Other MCP clients (Cursor, Windsurf, etc.)

```bash
git clone https://github.com/luan007/figma-slides-mcp.git
cd figma-slides-mcp && npm install
```

Add to your MCP config:
```json
{
  "mcpServers": {
    "figma-slides": {
      "command": "npx",
      "args": ["-y", "figma-slides-mcp"]
    }
  }
}
```

Then import `plugin/manifest.json` into Figma (same as Step 2 above, but from your clone directory).

## Graphics renderers

The Figma plugin bundles full graphics libraries. Your AI can use them to render complex visuals directly onto slides.

| Renderer | What it does | Text stays editable? |
|----------|-------------|---------------------|
| **D3 v7** | Charts, data viz, diagrams, tables | Yes |
| **Rough.js** | Hand-drawn / sketchy style graphics | Yes |
| **Satori** | HTML/CSS → SVG (flexbox layouts) | No (becomes paths) |
| **SVG import** | Icons, logos, custom vectors | Depends |

The AI writes a D3 script, the plugin runs it in a sandboxed iframe, extracts the SVG, and converts it to editable Figma nodes. Text elements become real Figma text — you can edit them after.

## What the AI can do

- Create, duplicate, delete, reorder slides
- Add any shape: rectangles, ellipses, lines, frames, text
- Style anything: fills, strokes, effects, opacity, corner radius
- Set text with per-character styling (font, size, color, spacing)
- Render D3 charts, Rough.js sketches, Satori layouts
- Place images from URL
- Screenshot slides to verify its own work
- Batch multiple operations in one call
- Search nodes, export to PNG/SVG/PDF

## Design skill

The bundled skill at `skills/figma-slides-mcp/SKILL.md` teaches the AI:

- Layout planning (coordinate grids, column systems)
- Typography hierarchy (font sizes, spacing, weight)
- Visual design theory (when to use charts vs text, color systems)
- D3 patterns (tables, flows, comparisons, Gantt charts, donuts)
- The screenshot-verify-fix loop
- API gotchas (gradient transforms, fill opacity, batch limits)

It's optional but makes a big difference. Without it, the AI tends to dump text on slides. With it, the AI thinks in layers and designs visually.

**Claude Code plugin install** includes the skill automatically. For manual setup, copy it to `~/.claude/skills/figma-slides-mcp/`.

## Limitations & quirks

> This is an early-stage project. It works, but has edges.

- **Single session only.** One MCP server → one Figma file at a time. No multi-document support yet.
- **Port conflict.** If another instance is running on port 3055, it fails. Set `FIGMA_WS_PORT` to use a different port.
- **Plugin must be running.** The Figma plugin needs to be open and connected. If you close it, the MCP server can't reach Figma.
- **Figma Slides only.** Doesn't work with regular Figma Design files. Must be a Slides file.
- **Tables are limited.** `createTable` works but is Slides-only and can be finicky.
- **Video is broken.** `createVideoAsync` returns empty. Figma's API limitation.
- **Satori text is paths.** Text rendered through Satori becomes vector paths — not editable as text in Figma. Use D3 instead when text editability matters.
- **No undo across sessions.** The AI's changes are real Figma operations. You can Cmd+Z in Figma, but only within the current session.
- **Dev plugin, not published.** The Figma plugin is loaded from local manifest, not the Figma Community. You need to import it manually once.

## Under construction

- [ ] Multi-session support (multiple Figma files)
- [ ] Published Figma Community plugin (no manual manifest import)
- [ ] Slide templates / presets
- [ ] Better image search integration
- [ ] Animation / transition authoring

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FIGMA_WS_PORT` | `3055` | WebSocket port for plugin connection |

## Project structure

```
figma-slides-mcp/
├── server/           # MCP server (Node.js, no build)
│   ├── index.js      # Entry point (stdio transport)
│   ├── bridge.js     # WebSocket bridge to plugin
│   ├── tools.js      # All MCP tool definitions
│   └── utils.js      # Helpers
├── plugin/           # Figma plugin (no build)
│   ├── manifest.json # Import this in Figma
│   ├── code.js       # Plugin logic
│   └── ui.html       # UI panel + D3/Rough.js/Satori loaders
├── skills/           # AI design skill
│   └── figma-slides-mcp/
│       └── SKILL.md
├── .claude-plugin/   # Claude Code plugin manifest
│   └── plugin.json
├── .mcp.json         # MCP server config (auto-loaded by plugin system)
└── test/
```

Zero TypeScript, zero bundlers, zero build steps. Plain JS all the way down.

## For AI agents

See [AGENT-INSTALL.md](AGENT-INSTALL.md) for detailed setup instructions, troubleshooting, and the full tool reference.

## License

MIT
