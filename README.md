# FigmaSlideMCP

MCP server that gives AI agents full read/write/visual control over Figma Slides.

## Architecture

```
AI Agent <--stdio--> MCP Server <--WebSocket--> Figma Plugin <--figma.*--> Canvas
```

Two components:
- **Figma Plugin** (3 files, no build) — bridge between WebSocket and Figma's Plugin API
- **MCP Server** (plain JS) — exposes ~42 tools via stdio, connects to plugin via WebSocket

## Quick Start

### 1. Install

```bash
npm install
```

### 2. Load the Plugin in Figma

1. Open a Figma Slides file
2. Go to **Plugins > Development > Import plugin from manifest...**
3. Select `plugin/manifest.json` from this repo
4. Run the plugin — it connects to `ws://localhost:3055`

### 3. Configure your MCP client

Add to your MCP settings (e.g. Claude Code):

```json
{
  "mcpServers": {
    "figma-slides": {
      "command": "node",
      "args": ["server/index.js"],
      "cwd": "/path/to/figma-slide-mcp"
    }
  }
}
```

### 4. Use it

The agent now has full control of your Figma Slides canvas.

## Tools

### Tier 1: High-Level
| Tool | Description |
|------|-------------|
| `connection_status` | Check plugin connection state |
| `get_editor_info` | Editor type, document name, page count |
| `get_slide_grid` | Full deck structure (rows + slides) |
| `get_slide_context` | Semantic dump of slide content |
| `screenshot_slide` | Visual capture as PNG |
| `screenshot_all_slides` | Thumbnails of all slides |
| `create_slide` | Create new slide (1920x1080) |
| `clear_slide` | Wipe slide content |

### Tier 2: Low-Level
| Tool | Description |
|------|-------------|
| `create_node` | Create FRAME, RECTANGLE, ELLIPSE, TEXT, etc. |
| `set_properties` | Modify any node (position, fills, effects...) |
| `delete_node` / `clone_node` / `reparent_node` | Node management |
| `group_nodes` / `ungroup_node` | Grouping |
| `set_text` / `set_text_range_style` | Text editing with auto font loading |
| `place_image` | Place image from URL or bytes |
| `create_table` / `set_cell_content` / etc. | Table operations |
| `create_shape_with_text` | Shapes with labels |
| `create_gif` / `create_video` | Media (Slides only) |
| `set_slide_transition` / `set_slide_theme` | Slide properties |
| `duplicate_slide` / `reorder_slides` | Slide management |

### Tier 3: Introspection
| Tool | Description |
|------|-------------|
| `get_node_tree` | Structural tree with depth control |
| `get_node_properties` | Full/selective property read |
| `find_nodes` | Search by name, type, visibility |
| `get_selection` / `set_selection` | Selection management |
| `export_node` | Export to PNG/JPG/SVG/PDF |
| `list_fonts` / `list_themes` | Available resources |

### Tier 4: Batch
| Tool | Description |
|------|-------------|
| `batch_operations` | Multiple commands in one call with `$N.field` references |

## Batch Example

Create a slide with title and subtitle in one call:

```json
{
  "commands": [
    { "cmd": "createSlide", "params": { "fills": "#1a1a2e" } },
    { "cmd": "createNode", "params": { "parentId": "$0.nodeId", "type": "TEXT", "props": { "text": "Hello World", "x": 100, "y": 100 } } },
    { "cmd": "createNode", "params": { "parentId": "$0.nodeId", "type": "RECTANGLE", "props": { "x": 100, "y": 300, "width": 800, "height": 400, "fills": "#2d2d5e", "cornerRadius": 12 } } }
  ]
}
```

## Environment Variables

- `FIGMA_WS_PORT` — WebSocket port (default: `3055`)

## No Build Required

Plugin: 3 plain files. Server: `node server/index.js`. Zero TypeScript, zero bundlers.

## Testing

```bash
npm test
```
