# FigmaSlideMCP Design Spec

## Overview

A system that gives AI agents full read/write/visual control over Figma Slides (and extensible to general Figma canvas) via an MCP server backed by a lightweight Figma plugin bridge.

**Why this exists:** The official Figma MCP is read-only (REST API). No existing tool provides write access to Figma Slides. Slides have unique node types (tables, shapes-with-text, GIFs, video, interactive elements) that general Figma tools ignore.

**Primary use case:** An AI agent builds, edits, and visually verifies slide decks — creating slides from scratch, modifying existing content, reading structure, and capturing screenshots to reason about layout quality.

---

## Architecture

```
AI Agent <--stdio--> MCP Server <--WebSocket--> Plugin UI (iframe) <--postMessage--> Plugin Main (sandbox) <--figma.*--> Canvas
```

### Components

**1. Figma Plugin (bridge)** — 3 files, zero build step:
- `manifest.json` — declares `editorType: ["figma", "slides"]`, `networkAccess` for `ws://localhost`
- `code.js` — main thread sandbox, handles mid-level command vocabulary via `figma.*` API
- `ui.html` — hidden iframe, WebSocket client, relays messages between server and main thread

**2. MCP Server** — single `node server.js` process:
- Speaks stdio (JSON-RPC) to the AI agent on one side
- Speaks WebSocket to the Figma plugin on the other
- Defines MCP tools (high-level + low-level + introspection)
- Composes high-level tools from mid-level plugin commands
- Dependencies: `@modelcontextprotocol/sdk`, `ws`

### File Structure

```
figma-slide-mcp/
├── plugin/
│   ├── manifest.json
│   ├── code.js           # ~300 lines, command handler
│   └── ui.html           # ~80 lines, WebSocket bridge
├── server/
│   └── index.js           # MCP server, stdio + WebSocket
├── package.json
└── README.md
```

---

## Protocol

### Message Format

```json
// Request (server -> plugin)
{ "id": "req-1", "cmd": "createSlide", "params": {} }

// Response (plugin -> server)
{ "id": "req-1", "result": { "nodeId": "1:23", "name": "Slide 1" } }

// Error
{ "id": "req-1", "error": { "code": "FONT_UNAVAILABLE", "message": "Inter Bold not found" } }
```

### Batch Protocol

Multiple commands in one round-trip. Results from earlier commands referenced via `$N.field` syntax.

**Resolution rules:**
- `$N.field` is simple dot-access only (no array indexing, no nested paths)
- Resolution is literal value substitution in params before execution
- If command `$N` failed, any command referencing `$N` also fails with `INVALID_PARAMS`
- `$N` is zero-indexed (first command = `$0`)

```json
{
  "id": "req-2",
  "cmd": "batch",
  "params": {
    "commands": [
      { "cmd": "createSlide", "params": {} },
      { "cmd": "createNode", "params": { "parentId": "$0.nodeId", "type": "TEXT", "props": { "text": "Title", "fontSize": 48, "x": 100, "y": 80 } } },
      { "cmd": "createNode", "params": { "parentId": "$0.nodeId", "type": "RECTANGLE", "props": { "x": 100, "y": 200, "width": 800, "height": 400 } } }
    ]
  }
}
```

Response:
```json
{
  "id": "req-2",
  "result": [
    { "nodeId": "1:23", "name": "Slide 1" },
    { "nodeId": "1:24", "name": "Title" },
    { "nodeId": "1:25", "name": "Rectangle 1" }
  ]
}
```

Batch operations are grouped into a single Figma undo step so Cmd+Z reverts the entire batch.

### Error Codes

| Code | Meaning |
|------|---------|
| `NODE_NOT_FOUND` | nodeId doesn't exist |
| `FONT_UNAVAILABLE` | Requested font not in editor |
| `UNSUPPORTED_IN_SLIDES` | Operation not available in Slides editor (e.g. createComponent) |
| `INVALID_PARAMS` | Missing or malformed parameters |
| `BATCH_PARTIAL_FAILURE` | Some commands in batch failed; result array contains errors at failed indices |
| `NOT_CONNECTED` | Plugin not connected to server |
| `TIMEOUT` | Plugin did not respond within timeout |

---

## Plugin Command Vocabulary

### Cluster 1: Node CRUD

| Command | Params | Returns |
|---------|--------|---------|
| `createNode` | `{ type, parentId, props? }` | `{ nodeId, name }` |
| `setProperties` | `{ nodeId, props }` | `{}` |
| `deleteNode` | `{ nodeId }` | `{}` |
| `cloneNode` | `{ nodeId, parentId? }` | `{ nodeId }` |
| `reparentNode` | `{ nodeId, parentId, index? }` | `{}` |
| `groupNodes` | `{ nodeIds, parentId? }` | `{ nodeId }` |
| `ungroupNode` | `{ nodeId }` | `{ childIds }` |

**Supported `type` values for `createNode`:** `FRAME`, `RECTANGLE`, `ELLIPSE`, `POLYGON`, `STAR`, `LINE`, `VECTOR`, `TEXT`

Slides-specific types (`SLIDE`, `SLIDE_ROW`, `TABLE`, `SHAPE_WITH_TEXT`, `GIF`, `VIDEO`) have dedicated creation commands in Cluster 5 and 6 because they require special parameters that don't fit the generic `createNode` pattern.

**`props` bag** — flat key-value, plugin handles mapping to correct API calls:
- Position/size: `x`, `y`, `width`, `height`, `rotation`
- Appearance: `fills`, `strokes`, `strokeWeight`, `effects`, `opacity`, `blendMode`, `cornerRadius`

**Fills format:** accepts both shorthand and full Figma Paint format:
- Shorthand: `"#ff0000"` or `["#ff0000"]` — expanded to `[{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 1 }]`
- Full: `[{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 0.5 }]` — passed through as-is
- Gradients: full format only (LINEAR_GRADIENT, RADIAL_GRADIENT, etc.)
- Same shorthand applies to `strokes`
- Layout: `layoutMode`, `paddingLeft/Right/Top/Bottom`, `itemSpacing`, `primaryAxisAlignItems`, `counterAxisAlignItems`
- Behavior: `visible`, `locked`, `constraints`
- The plugin maps `width`/`height` to `node.resize()`, clones immutable arrays for fills/strokes/effects, etc.

### Cluster 2: Text

Font loading is automatic — the plugin calls `loadFontAsync` before any text mutation.

| Command | Params | Returns |
|---------|--------|---------|
| `setText` | `{ nodeId, text, fontName? }` | `{}` |
| `setTextRangeStyle` | `{ nodeId, start, end, props }` | `{}` |
| `getTextContent` | `{ nodeId }` | `{ text, segments: [{ start, end, fontSize, fontName, fills }] }` |
| `listFonts` | `{}` | `{ fonts: [{ family, styles }] }` |

### Cluster 3: Images

| Command | Params | Returns |
|---------|--------|---------|
| `placeImage` | `{ parentId, url?, bytes?, x?, y?, width?, height?, scaleMode? }` | `{ nodeId }` |

Creates a rectangle, loads the image, applies as IMAGE fill. One command. When `url` is provided, the UI iframe fetches the image (main thread has no network access), converts to bytes, then sends to main thread for `figma.createImage()`. This relay is transparent to the caller.

### Cluster 4: Introspection (Three Modes)

**Structure** — what's there, where:

| Command | Params | Returns |
|---------|--------|---------|
| `getSlideGrid` | `{}` | `{ rows: [{ rowId, slides: [{ slideId, name, isSkipped }] }] }` |
| `getNodeTree` | `{ nodeId, depth? }` | Recursive tree: id, type, name, bounds, visible, locked |
| `findNodes` | `{ parentId?, criteria }` | `{ nodes: [{ nodeId, type, name, bounds }] }` |
| `getSelection` | `{}` | `{ nodeIds }` |
| `setSelection` | `{ nodeIds }` | `{}` |

`findNodes` criteria object supports: `{ name?, type?, visible?, locked? }`. All fields optional, combined with AND logic. `name` supports substring match.

**Context** — semantic dump for LLM reasoning:

| Command | Params | Returns |
|---------|--------|---------|
| `getNodeProperties` | `{ nodeId, properties? }` | Full or selective property dump |
| `getSlideContext` | `{ slideId }` | Rich payload: background, all elements with type/position/size/content/style, z-order |

`getSlideContext` example response:
```json
{
  "slideId": "1:23",
  "name": "Slide 3",
  "background": { "type": "SOLID", "color": "#1a1a2e" },
  "elements": [
    { "nodeId": "1:24", "type": "TEXT", "text": "Quarterly Results",
      "fontSize": 48, "fontName": "Inter Bold", "x": 100, "y": 80, "width": 600 },
    { "nodeId": "1:25", "type": "RECTANGLE", "x": 100, "y": 200,
      "width": 800, "height": 400, "fills": ["#2d2d5e"], "cornerRadius": 12 },
    { "nodeId": "1:26", "type": "IMAGE", "x": 120, "y": 220,
      "width": 760, "height": 360, "scaleMode": "FILL" }
  ]
}
```

**Visual** — pixel-level screenshot:

| Command | Params | Returns |
|---------|--------|---------|
| `exportNode` | `{ nodeId, format?, scale?, constraint? }` | `{ base64, width, height, format }` |
| `exportSlide` | `{ slideId, scale? }` | `{ base64, width, height }` |
| `exportAllSlides` | `{ scale?, maxSlides? }` | `{ slides: [{ slideId, name, base64 }] }` |

Formats: `PNG` (default), `JPG`, `SVG`, `PDF`. Scale: `1` (default), `2` for retina.

### Cluster 5: Slide Lifecycle

| Command | Params | Returns |
|---------|--------|---------|
| `createSlide` | `{ rowIndex?, fills?, themeId? }` | `{ nodeId, rowId }` |
| `createSlideRow` | `{ index? }` | `{ nodeId }` |
| `duplicateSlide` | `{ slideId }` | `{ nodeId, rowId }` |
| `deleteSlide` | `{ slideId }` | `{}` |
| `deleteSlideRow` | `{ rowId }` | `{}` |
| `reorderSlides` | `{ rowIds }` | `{}` |
| `moveSlideToRow` | `{ slideId, rowId, index? }` | `{}` |
| `setSlideTransition` | `{ slideId, style, duration?, curve?, timing? }` | `{}` |
| `setSlideSkipped` | `{ slideId, isSkipped }` | `{}` |
| `setSlideTheme` | `{ slideId, themeId }` | `{}` |
| `listThemes` | `{}` | `{ themes: [{ themeId, name }] }` |
| `focusSlide` | `{ slideId }` | `{}` |
| `setSlidesViewMode` | `{ mode }` | `{}` |

### Cluster 6: Slides-Specific Types

**Tables:**

| Command | Params | Returns |
|---------|--------|---------|
| `createTable` | `{ parentId, rows, cols, cellWidth?, cellHeight? }` | `{ nodeId }` |
| `setCellContent` | `{ tableId, row, col, text, props? }` | `{}` |
| `getCellContent` | `{ tableId, row, col }` | `{ text, props }` |
| `insertTableRow` | `{ tableId, index? }` | `{}` |
| `insertTableColumn` | `{ tableId, index? }` | `{}` |
| `deleteTableRow` | `{ tableId, index }` | `{}` |
| `deleteTableColumn` | `{ tableId, index }` | `{}` |

**Media:**

| Command | Params | Returns |
|---------|--------|---------|
| `createShapeWithText` | `{ parentId, shapeType, text, props? }` | `{ nodeId }` |
| `createGif` | `{ parentId, data }` | `{ nodeId }` |
| `createVideo` | `{ parentId, data }` | `{ nodeId }` |
| `replaceMedia` | `{ nodeId, data }` | `{}` |

**Note:** `figma.createGif()` and `figma.createVideoAsync()` are documented in the Slides Plugin API but may have limited availability or undocumented constraints. These commands should be implemented with graceful fallback — if creation fails, return a clear error. `replaceMedia` has the same caveat. Verify during implementation.

**Interactive elements (read-only):**

| Command | Params | Returns |
|---------|--------|---------|
| `getInteractiveElements` | `{ slideId }` | `{ elements: [{ nodeId, interactiveType, bounds }] }` |

Can reposition via `setProperties` but cannot create `POLL`, `EMBED`, `FACEPILE`, `ALIGNMENT`, `YOUTUBE` nodes programmatically.

### Cluster 7: Viewport & Meta

| Command | Params | Returns |
|---------|--------|---------|
| `setViewport` | `{ center?, zoom? }` | `{}` |
| `zoomToFit` | `{ nodeIds? }` | `{}` |
| `getEditorInfo` | `{}` | `{ editorType, documentName, pageCount }` |
| `ping` | `{}` | `{ pong: true }` |

### Convenience

| Command | Params | Returns |
|---------|--------|---------|
| `getSlideContext` | `{ slideId }` | Full semantic read (see Cluster 4) |
| `clearSlide` | `{ slideId }` | Remove all children, keep slide |
| `batch` | `{ commands[] }` | Execute multiple commands in one round-trip, single undo step |

---

## MCP Tool Surface

The MCP server exposes these as MCP tools to the AI agent. Three tiers:

### Tier 1: High-Level (agent-friendly, one tool = one intent)

- `create_slide` — create a new slide, optionally in a specific row
- `get_slide_context` — semantic dump of a slide's content
- `screenshot_slide` — visual capture of a slide
- `screenshot_all_slides` — thumbnails of all slides
- `clear_slide` — wipe slide content
- `get_slide_grid` — full deck structure overview
- `get_editor_info` — what editor type, doc name, page count
- `connection_status` — is plugin connected, editor type, document name

### Tier 2: Low-Level (full control, compose anything)

- `create_node` — create any node type with properties
- `set_properties` — modify any node's properties
- `delete_node` — remove a node
- `clone_node` — duplicate a node
- `reparent_node` — move node to different parent
- `group_nodes` / `ungroup_node`
- `set_text` / `set_text_range_style` / `get_text_content`
- `place_image`
- `create_table` / `set_cell_content` / `get_cell_content` / `insert_table_row` / `insert_table_column` / `delete_table_row` / `delete_table_column`
- `create_shape_with_text` / `create_gif` / `create_video` / `replace_media`
- `set_slide_transition` / `set_slide_skipped` / `set_slide_theme`
- `reorder_slides` / `move_slide_to_row` / `duplicate_slide`

### Tier 3: Introspection

- `get_node_tree` — structural tree with depth control
- `get_node_properties` — full/selective property read
- `find_nodes` — search by name/type/criteria
- `get_selection` / `set_selection` — currently selected nodes
- `get_text_content` — text with style segments
- `get_interactive_elements` — read-only interactive elements
- `list_fonts` — available fonts
- `list_themes` — available slide themes
- `export_node` — export any node to PNG/JPG/SVG/PDF

### Tier 4: Batch

- `batch_operations` — send multiple commands in one call with `$N` references

---

## Plugin Internals

### WebSocket Connection

**Default port:** `3055` (configurable via MCP server `--port` flag and plugin settings).

**Handshake:** On connect, the plugin sends:
```json
{ "type": "hello", "version": "1.0", "editorType": "slides", "documentName": "My Deck" }
```
The server validates version compatibility and stores editor context.

**Reconnection:** The UI iframe auto-reconnects with exponential backoff (1s, 2s, 4s, max 30s). Shows connection status in a minimal UI strip (green/yellow/red dot).

### Connection Lifecycle

- MCP tool calls return `NOT_CONNECTED` immediately if the plugin is not connected (no queuing)
- Default command timeout: 10 seconds (30 seconds for export operations)
- If plugin disconnects mid-command, pending commands receive `TIMEOUT` errors
- MCP server exposes `connection_status` tool so the agent can check before operating

### Font Auto-Loading

Any command that mutates text properties automatically calls `loadFontAsync` with the appropriate font before proceeding. If the font is unavailable, returns `FONT_UNAVAILABLE` error.

### Immutable Property Handling

The plugin handles Figma's clone-and-reassign pattern for fills, strokes, and effects internally. The agent sends a flat props bag; the plugin does:
```js
const fills = JSON.parse(JSON.stringify(node.fills))
// apply changes
node.fills = fills
```

### Undo Grouping

Figma automatically groups synchronous operations into a single undo step. For batch commands:

1. Pre-load all required fonts before executing the batch (scan commands for text mutations, call `loadFontAsync` for each)
2. Execute all commands synchronously — they collapse into one undo step
3. Call `figma.commitUndo()` after execution to flush the undo group

If a batch contains unavoidable async operations beyond font loading, undo grouping is best-effort and may create multiple undo steps.

### Editor Type Guards

Commands unavailable in the current editor type return `UNSUPPORTED_IN_SLIDES` or `UNSUPPORTED_IN_FIGMA` errors rather than crashing.

### Error Handling

All commands are wrapped in try/catch. Errors return structured `{ error: { code, message } }` responses. Batch commands return partial results with errors at failed indices.

---

## Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `@modelcontextprotocol/sdk` | MCP protocol implementation | ~50KB |
| `ws` | WebSocket server | ~30KB |

No other dependencies. No TypeScript. No bundler.

---

## What's NOT in Scope

- Animation / prototyping interactions
- Component/style/variable management (not available in Slides)
- Publishing to Figma Community
- Cloud/remote WebSocket relay (local only for now)
- Figma REST API integration
- Authentication (local WebSocket, no auth needed)
