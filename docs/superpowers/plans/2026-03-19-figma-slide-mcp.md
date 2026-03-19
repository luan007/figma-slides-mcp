# FigmaSlideMCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP server + Figma plugin bridge that gives AI agents full read/write/visual control over Figma Slides.

**Architecture:** A Figma plugin (3 plain files, no build) opens a WebSocket to a local MCP server (plain JS, Node). The server speaks stdio/JSON-RPC to the AI agent and WebSocket to the plugin. Mid-level commands in the plugin map to figma.* API calls. The server exposes ~40 MCP tools across 4 tiers.

**Tech Stack:** Node.js, plain JavaScript (no TypeScript, no bundler), `@modelcontextprotocol/server` (MCP SDK), `zod`, `ws`

**Spec:** `docs/superpowers/specs/2026-03-19-figma-slide-mcp-design.md`

---

## File Structure

```
figma-slide-mcp/
├── plugin/
│   ├── manifest.json        # Figma plugin manifest (editorType, networkAccess)
│   ├── code.js              # Main thread: command dispatcher + all handlers
│   └── ui.html              # Hidden iframe: WebSocket bridge + image relay
├── server/
│   ├── index.js             # Entry point: MCP server + WS server wiring
│   ├── bridge.js            # WebSocket connection manager (send, timeout, state)
│   └── tools.js             # All MCP tool registrations grouped by cluster
├── test/
│   ├── bridge.test.js       # Bridge send/receive/timeout tests
│   ├── utils.test.js        # Fills expansion, batch $N resolution tests
│   └── tools.test.js        # Tool registration smoke tests
├── package.json
└── README.md
```

**Key decisions:**
- Plugin `code.js` is one file (~400 lines) — splitting would require a bundler
- Server is 3 files: entry, bridge, tools — each has one responsibility
- `test/` uses Node's built-in test runner (`node --test`) — zero test deps
- No `src/` directory — flat and direct

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `plugin/manifest.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "figma-slide-mcp",
  "version": "0.1.0",
  "description": "MCP server for AI agent control of Figma Slides",
  "type": "module",
  "main": "server/index.js",
  "scripts": {
    "start": "node server/index.js",
    "test": "node --test test/*.test.js"
  },
  "dependencies": {
    "@modelcontextprotocol/server": "^1.0.0",
    "ws": "^8.18.0",
    "zod": "^3.25.0"
  }
}
```

- [ ] **Step 2: Create plugin manifest**

```json
{
  "name": "FigmaSlideMCP Bridge",
  "id": "figma-slide-mcp-bridge",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui.html",
  "editorType": ["figma", "slides"],
  "documentAccess": "dynamic-page",
  "networkAccess": {
    "allowedDomains": ["ws://localhost:3055"],
    "reasoning": "WebSocket connection to local MCP server"
  }
}
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` generated

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json plugin/manifest.json
git commit -m "feat: project scaffolding with dependencies and plugin manifest"
```

---

### Task 2: Plugin WebSocket Bridge (ui.html)

**Files:**
- Create: `plugin/ui.html`

The hidden iframe that bridges WebSocket <-> postMessage. This is the network layer of the plugin.

- [ ] **Step 1: Write ui.html**

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; padding: 4px 8px; font-family: system-ui; font-size: 11px; }
    #status { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
    .connected { background: #1bc47d; }
    .connecting { background: #f5a623; }
    .disconnected { background: #f24822; }
  </style>
</head>
<body>
  <span id="status" class="disconnected"></span>
  <span id="label">Disconnected</span>
  <script>
    const PORT = 3055;
    const MAX_BACKOFF = 30000;
    let ws = null;
    let backoff = 1000;
    let connected = false;

    const statusEl = document.getElementById('status');
    const labelEl = document.getElementById('label');

    function setStatus(state, text) {
      statusEl.className = state;
      labelEl.textContent = text;
    }

    function connect() {
      setStatus('connecting', 'Connecting...');
      ws = new WebSocket(`ws://localhost:${PORT}`);

      ws.onopen = () => {
        connected = true;
        backoff = 1000;
        setStatus('connected', 'Connected');

        // Send hello handshake
        ws.send(JSON.stringify({
          type: 'hello',
          version: '1.0',
          editorType: parent.postMessage ? 'unknown' : 'unknown'
        }));

        // Request editor info from main thread to complete handshake
        parent.postMessage({ pluginMessage: { type: 'getEditorInfo' } }, '*');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          // Forward command from server to plugin main thread
          parent.postMessage({ pluginMessage: { type: 'command', ...msg } }, '*');
        } catch (e) {
          console.error('Failed to parse message:', e);
        }
      };

      ws.onclose = () => {
        connected = false;
        setStatus('disconnected', `Disconnected. Retrying in ${backoff / 1000}s...`);
        setTimeout(() => {
          backoff = Math.min(backoff * 2, MAX_BACKOFF);
          connect();
        }, backoff);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        ws.close();
      };
    }

    // Handle messages from plugin main thread
    onmessage = (event) => {
      const msg = event.data.pluginMessage;
      if (!msg) return;

      if (msg.type === 'response' || msg.type === 'hello') {
        // Forward response from plugin to server
        if (ws && connected) {
          ws.send(JSON.stringify(msg.data));
        }
      } else if (msg.type === 'fetchImage') {
        // Image relay: fetch URL in iframe, send bytes back to main thread
        fetch(msg.url)
          .then(res => res.arrayBuffer())
          .then(buf => {
            parent.postMessage({
              pluginMessage: {
                type: 'imageData',
                requestId: msg.requestId,
                bytes: new Uint8Array(buf)
              }
            }, '*');
          })
          .catch(err => {
            parent.postMessage({
              pluginMessage: {
                type: 'imageError',
                requestId: msg.requestId,
                error: err.message
              }
            }, '*');
          });
      }
    };

    connect();
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add plugin/ui.html
git commit -m "feat: plugin WebSocket bridge with reconnection and image relay"
```

---

### Task 3: Plugin Command Dispatcher (code.js) — Core + Ping

**Files:**
- Create: `plugin/code.js`

Start with the dispatcher skeleton, ping, getEditorInfo, and node CRUD. We build this file incrementally across tasks.

- [ ] **Step 1: Write code.js with dispatcher + core commands**

```js
// FigmaSlideMCP Plugin — Main Thread (Figma Sandbox)
// Handles commands from the MCP server via postMessage bridge

figma.showUI(__html__, { visible: true, width: 200, height: 30, themeColors: true });

// Pending image fetch requests
const pendingImages = new Map();

// ============================================================
// Utility: expand hex shorthand to Figma Paint array
// ============================================================
function expandFills(fills) {
  if (!fills) return undefined;
  if (typeof fills === 'string') fills = [fills];
  if (!Array.isArray(fills)) return fills;
  return fills.map(f => {
    if (typeof f === 'string' && f.startsWith('#')) {
      const hex = f.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;
      return { type: 'SOLID', color: { r, g, b }, opacity: 1 };
    }
    return f;
  });
}

// ============================================================
// Utility: apply props bag to a node
// ============================================================
function applyProps(node, props) {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    switch (key) {
      case 'width':
      case 'height':
        // Defer resize to after both are known
        break;
      case 'fills':
        node.fills = expandFills(value);
        break;
      case 'strokes':
        node.strokes = expandFills(value);
        break;
      case 'effects':
        node.effects = JSON.parse(JSON.stringify(value));
        break;
      case 'x': case 'y': case 'rotation': case 'opacity':
      case 'visible': case 'locked': case 'strokeWeight':
      case 'cornerRadius': case 'blendMode':
      case 'layoutMode': case 'itemSpacing':
      case 'paddingLeft': case 'paddingRight':
      case 'paddingTop': case 'paddingBottom':
      case 'primaryAxisAlignItems': case 'counterAxisAlignItems':
        node[key] = value;
        break;
      case 'constraints':
        node.constraints = value;
        break;
    }
  }
  // Handle resize (need both width and height or one at a time)
  if (props.width !== undefined || props.height !== undefined) {
    const w = props.width !== undefined ? props.width : node.width;
    const h = props.height !== undefined ? props.height : node.height;
    node.resize(w, h);
  }
}

// ============================================================
// Utility: get node by ID with error
// ============================================================
async function getNode(nodeId) {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw { code: 'NODE_NOT_FOUND', message: `Node ${nodeId} not found` };
  return node;
}

// ============================================================
// Command Handlers
// ============================================================
const handlers = {};

// --- Meta ---
handlers.ping = async () => ({ pong: true });

handlers.getEditorInfo = async () => ({
  editorType: figma.editorType,
  documentName: figma.root.name,
  pageCount: figma.root.children.length
});

// --- Node CRUD ---
handlers.createNode = async (params) => {
  const { type, parentId, props } = params;
  const parent = parentId ? await getNode(parentId) : figma.currentPage;
  let node;
  switch (type) {
    case 'FRAME': node = figma.createFrame(); break;
    case 'RECTANGLE': node = figma.createRectangle(); break;
    case 'ELLIPSE': node = figma.createEllipse(); break;
    case 'POLYGON': node = figma.createPolygon(); break;
    case 'STAR': node = figma.createStar(); break;
    case 'LINE': node = figma.createLine(); break;
    case 'VECTOR': node = figma.createVector(); break;
    case 'TEXT': node = figma.createText(); break;
    default:
      throw { code: 'INVALID_PARAMS', message: `Unknown type: ${type}. Use dedicated commands for Slides types.` };
  }
  parent.appendChild(node);
  applyProps(node, props);
  return { nodeId: node.id, name: node.name };
};

handlers.setProperties = async (params) => {
  const node = await getNode(params.nodeId);
  applyProps(node, params.props);
  return {};
};

handlers.deleteNode = async (params) => {
  const node = await getNode(params.nodeId);
  node.remove();
  return {};
};

handlers.cloneNode = async (params) => {
  const node = await getNode(params.nodeId);
  const clone = node.clone();
  if (params.parentId) {
    const parent = await getNode(params.parentId);
    parent.appendChild(clone);
  }
  return { nodeId: clone.id };
};

handlers.reparentNode = async (params) => {
  const node = await getNode(params.nodeId);
  const parent = await getNode(params.parentId);
  if (params.index !== undefined) {
    parent.insertChild(params.index, node);
  } else {
    parent.appendChild(node);
  }
  return {};
};

handlers.groupNodes = async (params) => {
  const nodes = await Promise.all(params.nodeIds.map(id => getNode(id)));
  const parent = params.parentId ? await getNode(params.parentId) : nodes[0].parent;
  const group = figma.group(nodes, parent);
  return { nodeId: group.id };
};

handlers.ungroupNode = async (params) => {
  const node = await getNode(params.nodeId);
  const childIds = node.children.map(c => c.id);
  const parent = node.parent;
  for (const child of [...node.children]) {
    parent.appendChild(child);
  }
  node.remove();
  return { childIds };
};

// --- Text ---
handlers.setText = async (params) => {
  const node = await getNode(params.nodeId);
  const fontName = params.fontName
    ? { family: params.fontName.split(' ').slice(0, -1).join(' ') || params.fontName, style: params.fontName.split(' ').pop() || 'Regular' }
    : (node.fontName !== figma.mixed ? node.fontName : { family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync(fontName);
  if (params.fontName) node.fontName = fontName;
  node.characters = params.text;
  return {};
};

handlers.setTextRangeStyle = async (params) => {
  const node = await getNode(params.nodeId);
  const { start, end, props } = params;
  // Load all fonts for the range first
  const fonts = node.getRangeAllFontNames(start, end);
  await Promise.all(fonts.map(f => figma.loadFontAsync(f)));
  if (props.fontSize) node.setRangeFontSize(start, end, props.fontSize);
  if (props.fontName) {
    const fn = { family: props.fontName.split(' ').slice(0, -1).join(' ') || props.fontName, style: props.fontName.split(' ').pop() || 'Regular' };
    await figma.loadFontAsync(fn);
    node.setRangeFontName(start, end, fn);
  }
  if (props.fills) node.setRangeFills(start, end, expandFills(props.fills));
  if (props.letterSpacing) node.setRangeLetterSpacing(start, end, props.letterSpacing);
  if (props.lineHeight) node.setRangeLineHeight(start, end, props.lineHeight);
  if (props.textDecoration) node.setRangeTextDecoration(start, end, props.textDecoration);
  if (props.textCase) node.setRangeTextCase(start, end, props.textCase);
  return {};
};

handlers.getTextContent = async (params) => {
  const node = await getNode(params.nodeId);
  const segments = node.getStyledTextSegments(['fontSize', 'fontName', 'fills', 'fontWeight', 'textDecoration', 'textCase', 'letterSpacing', 'lineHeight']);
  return {
    text: node.characters,
    segments: segments.map(s => ({
      start: s.start,
      end: s.end,
      fontSize: s.fontSize,
      fontName: s.fontName ? `${s.fontName.family} ${s.fontName.style}` : undefined,
      fills: s.fills,
      fontWeight: s.fontWeight,
      textDecoration: s.textDecoration,
      textCase: s.textCase,
      letterSpacing: s.letterSpacing,
      lineHeight: s.lineHeight
    }))
  };
};

handlers.listFonts = async () => {
  const fonts = await figma.listAvailableFontsAsync();
  // Group by family
  const families = {};
  for (const f of fonts) {
    if (!families[f.fontName.family]) families[f.fontName.family] = [];
    families[f.fontName.family].push(f.fontName.style);
  }
  return { fonts: Object.entries(families).map(([family, styles]) => ({ family, styles })) };
};

// --- Images ---
handlers.placeImage = async (params) => {
  const parent = params.parentId ? await getNode(params.parentId) : figma.currentPage;
  const rect = figma.createRectangle();
  parent.appendChild(rect);

  let imageHash;
  if (params.bytes) {
    const img = figma.createImage(new Uint8Array(params.bytes));
    imageHash = img.hash;
  } else if (params.url) {
    // Request image fetch from UI iframe
    const requestId = 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const bytesPromise = new Promise((resolve, reject) => {
      pendingImages.set(requestId, { resolve, reject });
      setTimeout(() => {
        if (pendingImages.has(requestId)) {
          pendingImages.delete(requestId);
          reject({ code: 'TIMEOUT', message: 'Image fetch timed out' });
        }
      }, 30000);
    });
    figma.ui.postMessage({ type: 'fetchImage', url: params.url, requestId });
    const bytes = await bytesPromise;
    const img = figma.createImage(bytes);
    imageHash = img.hash;
  } else {
    throw { code: 'INVALID_PARAMS', message: 'placeImage requires url or bytes' };
  }

  const w = params.width || 400;
  const h = params.height || 300;
  rect.resize(w, h);
  if (params.x !== undefined) rect.x = params.x;
  if (params.y !== undefined) rect.y = params.y;
  rect.fills = [{
    type: 'IMAGE',
    imageHash,
    scaleMode: params.scaleMode || 'FILL'
  }];

  return { nodeId: rect.id };
};

// --- Introspection: Structure ---
handlers.getSlideGrid = async () => {
  if (figma.editorType !== 'slides') {
    throw { code: 'UNSUPPORTED_IN_FIGMA', message: 'getSlideGrid only available in Slides editor' };
  }
  const grid = figma.getSlideGrid();
  const rows = grid.map(row => ({
    rowId: row.id,
    slides: row.children.map(slide => ({
      slideId: slide.id,
      name: slide.name,
      isSkipped: slide.isSkippedSlide || false
    }))
  }));
  return { rows };
};

function buildNodeTree(node, depth, currentDepth) {
  const result = {
    nodeId: node.id,
    type: node.type,
    name: node.name,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    visible: node.visible,
    locked: node.locked
  };
  if (depth !== null && currentDepth >= depth) return result;
  if ('children' in node && node.children) {
    result.children = node.children.map(child => buildNodeTree(child, depth, currentDepth + 1));
  }
  return result;
}

handlers.getNodeTree = async (params) => {
  const node = params.nodeId ? await getNode(params.nodeId) : figma.currentPage;
  const depth = params.depth !== undefined ? params.depth : null;
  return buildNodeTree(node, depth, 0);
};

handlers.findNodes = async (params) => {
  const parent = params.parentId ? await getNode(params.parentId) : figma.currentPage;
  const criteria = params.criteria || {};
  const results = parent.findAll(n => {
    if (criteria.type && n.type !== criteria.type) return false;
    if (criteria.name && !n.name.includes(criteria.name)) return false;
    if (criteria.visible !== undefined && n.visible !== criteria.visible) return false;
    if (criteria.locked !== undefined && n.locked !== criteria.locked) return false;
    return true;
  });
  return {
    nodes: results.map(n => ({
      nodeId: n.id,
      type: n.type,
      name: n.name,
      x: n.x, y: n.y,
      width: n.width, height: n.height
    }))
  };
};

handlers.getSelection = async () => ({
  nodeIds: figma.currentPage.selection.map(n => n.id)
});

handlers.setSelection = async (params) => {
  const nodes = await Promise.all(params.nodeIds.map(id => getNode(id)));
  figma.currentPage.selection = nodes;
  return {};
};

// --- Introspection: Context ---
handlers.getNodeProperties = async (params) => {
  const node = await getNode(params.nodeId);
  const allProps = {};
  const keys = params.properties || [
    'type', 'name', 'x', 'y', 'width', 'height', 'rotation',
    'fills', 'strokes', 'strokeWeight', 'effects', 'opacity',
    'blendMode', 'cornerRadius', 'visible', 'locked', 'constraints',
    'layoutMode', 'itemSpacing', 'paddingLeft', 'paddingRight',
    'paddingTop', 'paddingBottom'
  ];
  for (const k of keys) {
    try {
      const val = node[k];
      if (val !== undefined && typeof val !== 'function') {
        allProps[k] = (val && typeof val === 'object' && !Array.isArray(val) && val.constructor !== Object)
          ? JSON.parse(JSON.stringify(val)) : val;
      }
    } catch (e) { /* skip unsupported props for this node type */ }
  }
  return allProps;
};

handlers.getSlideContext = async (params) => {
  const slide = await getNode(params.slideId);
  const bg = slide.fills ? JSON.parse(JSON.stringify(slide.fills)) : [];
  const elements = [];
  for (const child of slide.children || []) {
    const el = {
      nodeId: child.id,
      type: child.type,
      name: child.name,
      x: child.x, y: child.y,
      width: child.width, height: child.height
    };
    if (child.type === 'TEXT') {
      el.text = child.characters;
      if (child.fontSize !== figma.mixed) el.fontSize = child.fontSize;
      if (child.fontName !== figma.mixed) el.fontName = `${child.fontName.family} ${child.fontName.style}`;
      el.fills = child.fills ? JSON.parse(JSON.stringify(child.fills)) : [];
    } else {
      if (child.fills) el.fills = JSON.parse(JSON.stringify(child.fills));
      if (child.cornerRadius !== undefined && child.cornerRadius !== figma.mixed) el.cornerRadius = child.cornerRadius;
    }
    if (child.opacity !== undefined && child.opacity !== 1) el.opacity = child.opacity;
    if (child.rotation) el.rotation = child.rotation;
    if ('children' in child && child.children && child.children.length > 0) {
      el.childCount = child.children.length;
    }
    elements.push(el);
  }
  return {
    slideId: slide.id,
    name: slide.name,
    background: bg,
    elements
  };
};

// --- Introspection: Visual ---
handlers.exportNode = async (params) => {
  const node = await getNode(params.nodeId);
  const format = params.format || 'PNG';
  const settings = { format };
  if (params.scale) settings.constraint = { type: 'SCALE', value: params.scale };
  if (params.constraint) settings.constraint = params.constraint;
  const bytes = await node.exportAsync(settings);
  // Convert to base64
  const base64 = figma.base64Encode(bytes);
  return { base64, width: node.width, height: node.height, format };
};

handlers.exportSlide = async (params) => {
  return handlers.exportNode({
    nodeId: params.slideId,
    format: 'PNG',
    scale: params.scale || 1
  });
};

handlers.exportAllSlides = async (params) => {
  if (figma.editorType !== 'slides') {
    throw { code: 'UNSUPPORTED_IN_FIGMA', message: 'exportAllSlides only available in Slides editor' };
  }
  const grid = figma.getSlideGrid();
  const slides = [];
  const maxSlides = params.maxSlides || 50;
  let count = 0;
  for (const row of grid) {
    for (const slide of row.children) {
      if (count >= maxSlides) break;
      const bytes = await slide.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: params.scale || 0.5 }
      });
      slides.push({
        slideId: slide.id,
        name: slide.name,
        base64: figma.base64Encode(bytes)
      });
      count++;
    }
  }
  return { slides };
};

// --- Slide Lifecycle ---
handlers.createSlide = async (params) => {
  if (figma.editorType !== 'slides') {
    throw { code: 'UNSUPPORTED_IN_FIGMA', message: 'createSlide only available in Slides editor' };
  }
  const slide = figma.createSlide();
  if (params.fills) slide.fills = expandFills(params.fills);
  // Place in a row
  const grid = figma.getSlideGrid();
  let row;
  if (params.rowIndex !== undefined && grid[params.rowIndex]) {
    row = grid[params.rowIndex];
    row.appendChild(slide);
  } else if (grid.length > 0) {
    row = grid[grid.length - 1];
    row.appendChild(slide);
  }
  return { nodeId: slide.id, rowId: row ? row.id : null };
};

handlers.createSlideRow = async (params) => {
  if (figma.editorType !== 'slides') {
    throw { code: 'UNSUPPORTED_IN_FIGMA', message: 'createSlideRow only available in Slides editor' };
  }
  const row = figma.createSlideRow();
  return { nodeId: row.id };
};

handlers.duplicateSlide = async (params) => {
  const slide = await getNode(params.slideId);
  const clone = slide.clone();
  return { nodeId: clone.id, rowId: clone.parent ? clone.parent.id : null };
};

handlers.deleteSlide = async (params) => {
  const slide = await getNode(params.slideId);
  slide.remove();
  return {};
};

handlers.deleteSlideRow = async (params) => {
  const row = await getNode(params.rowId);
  row.remove();
  return {};
};

handlers.reorderSlides = async (params) => {
  if (figma.editorType !== 'slides') {
    throw { code: 'UNSUPPORTED_IN_FIGMA', message: 'reorderSlides only available in Slides editor' };
  }
  const rows = await Promise.all(params.rowIds.map(id => getNode(id)));
  figma.setSlideGrid(rows);
  return {};
};

handlers.moveSlideToRow = async (params) => {
  const slide = await getNode(params.slideId);
  const row = await getNode(params.rowId);
  if (params.index !== undefined) {
    row.insertChild(params.index, slide);
  } else {
    row.appendChild(slide);
  }
  return {};
};

handlers.setSlideTransition = async (params) => {
  const slide = await getNode(params.slideId);
  const transition = {
    style: params.style || 'NONE',
    duration: params.duration || 0.4,
    curve: params.curve || 'EASE_OUT',
    timing: params.timing || { type: 'ON_CLICK' }
  };
  slide.setSlideTransition(transition);
  return {};
};

handlers.setSlideSkipped = async (params) => {
  const slide = await getNode(params.slideId);
  slide.isSkippedSlide = params.isSkipped;
  return {};
};

handlers.setSlideTheme = async (params) => {
  const slide = await getNode(params.slideId);
  slide.themeId = params.themeId;
  return {};
};

handlers.listThemes = async () => {
  // Figma Plugin API doesn't expose a direct listThemes API
  // Return empty for now — themes are set via themeId from the Figma UI
  return { themes: [] };
};

handlers.focusSlide = async (params) => {
  const slide = await getNode(params.slideId);
  figma.currentPage.focusedSlide = slide;
  return {};
};

handlers.setSlidesViewMode = async (params) => {
  figma.viewport.slidesMode = params.mode;
  return {};
};

// --- Slides-Specific Types ---
handlers.createTable = async (params) => {
  const parent = params.parentId ? await getNode(params.parentId) : figma.currentPage;
  const table = figma.createTable(params.rows, params.cols);
  parent.appendChild(table);
  return { nodeId: table.id };
};

handlers.setCellContent = async (params) => {
  const table = await getNode(params.tableId);
  const cell = table.cellAt(params.row, params.col);
  if (cell.text) {
    await figma.loadFontAsync(cell.text.fontName !== figma.mixed ? cell.text.fontName : { family: 'Inter', style: 'Regular' });
    cell.text.characters = params.text;
    if (params.props) applyProps(cell.text, params.props);
  }
  return {};
};

handlers.getCellContent = async (params) => {
  const table = await getNode(params.tableId);
  const cell = table.cellAt(params.row, params.col);
  return {
    text: cell.text ? cell.text.characters : '',
    props: cell.text ? { fontSize: cell.text.fontSize, fontName: cell.text.fontName } : {}
  };
};

handlers.insertTableRow = async (params) => {
  const table = await getNode(params.tableId);
  table.insertRow(params.index !== undefined ? params.index : table.numRows);
  return {};
};

handlers.insertTableColumn = async (params) => {
  const table = await getNode(params.tableId);
  table.insertColumn(params.index !== undefined ? params.index : table.numColumns);
  return {};
};

handlers.deleteTableRow = async (params) => {
  const table = await getNode(params.tableId);
  table.removeRow(params.index);
  return {};
};

handlers.deleteTableColumn = async (params) => {
  const table = await getNode(params.tableId);
  table.removeColumn(params.index);
  return {};
};

handlers.createShapeWithText = async (params) => {
  const parent = params.parentId ? await getNode(params.parentId) : figma.currentPage;
  const shape = figma.createShapeWithText();
  if (params.shapeType) shape.shapeType = params.shapeType;
  // Load font and set text
  await figma.loadFontAsync(shape.text.fontName !== figma.mixed ? shape.text.fontName : { family: 'Inter', style: 'Regular' });
  shape.text.characters = params.text || '';
  parent.appendChild(shape);
  if (params.props) applyProps(shape, params.props);
  return { nodeId: shape.id };
};

handlers.createGif = async (params) => {
  try {
    const parent = params.parentId ? await getNode(params.parentId) : figma.currentPage;
    const gif = figma.createGif();
    parent.appendChild(gif);
    return { nodeId: gif.id };
  } catch (e) {
    throw { code: 'UNSUPPORTED_IN_SLIDES', message: 'createGif failed: ' + (e.message || e) };
  }
};

handlers.createVideo = async (params) => {
  try {
    const parent = params.parentId ? await getNode(params.parentId) : figma.currentPage;
    const video = await figma.createVideoAsync(new Uint8Array(params.data));
    parent.appendChild(video);
    return { nodeId: video.id };
  } catch (e) {
    throw { code: 'UNSUPPORTED_IN_SLIDES', message: 'createVideo failed: ' + (e.message || e) };
  }
};

handlers.replaceMedia = async (params) => {
  // Best-effort media replacement
  const node = await getNode(params.nodeId);
  try {
    if (typeof node.setVideoAsync === 'function') {
      await node.setVideoAsync(new Uint8Array(params.data));
    } else {
      const img = figma.createImage(new Uint8Array(params.data));
      node.fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FILL' }];
    }
  } catch (e) {
    throw { code: 'INVALID_PARAMS', message: 'replaceMedia failed: ' + (e.message || e) };
  }
  return {};
};

handlers.getInteractiveElements = async (params) => {
  const slide = await getNode(params.slideId);
  const elements = [];
  if (slide.children) {
    for (const child of slide.children) {
      if (child.type === 'INTERACTIVE_SLIDE_ELEMENT') {
        elements.push({
          nodeId: child.id,
          interactiveType: child.interactiveType,
          x: child.x, y: child.y,
          width: child.width, height: child.height
        });
      }
    }
  }
  return { elements };
};

// --- Viewport ---
handlers.setViewport = async (params) => {
  if (params.center) figma.viewport.center = params.center;
  if (params.zoom) figma.viewport.zoom = params.zoom;
  return {};
};

handlers.zoomToFit = async (params) => {
  if (params.nodeIds && params.nodeIds.length > 0) {
    const nodes = await Promise.all(params.nodeIds.map(id => getNode(id)));
    figma.viewport.scrollAndZoomIntoView(nodes);
  } else {
    figma.viewport.scrollAndZoomIntoView(figma.currentPage.children);
  }
  return {};
};

// --- Convenience ---
handlers.clearSlide = async (params) => {
  const slide = await getNode(params.slideId);
  for (const child of [...(slide.children || [])]) {
    child.remove();
  }
  return {};
};

// ============================================================
// Batch execution with $N reference resolution
// ============================================================
async function executeBatch(commands) {
  const results = [];

  // Pre-scan for text commands, pre-load fonts
  // (to enable synchronous execution for undo grouping)
  for (const cmd of commands) {
    if (cmd.cmd === 'setText' && cmd.params.fontName) {
      try {
        const parts = cmd.params.fontName.split(' ');
        const style = parts.pop() || 'Regular';
        const family = parts.join(' ') || cmd.params.fontName;
        await figma.loadFontAsync({ family, style });
      } catch (e) { /* will fail again during execution */ }
    }
  }

  for (let i = 0; i < commands.length; i++) {
    const { cmd, params } = commands[i];
    // Resolve $N.field references
    const resolvedParams = JSON.parse(JSON.stringify(params || {}), (key, value) => {
      if (typeof value === 'string' && value.startsWith('$')) {
        const match = value.match(/^\$(\d+)\.(\w+)$/);
        if (match) {
          const refIdx = parseInt(match[1]);
          const refField = match[2];
          if (refIdx >= results.length || results[refIdx].error) {
            throw { code: 'INVALID_PARAMS', message: `Reference $${refIdx} failed or not yet available` };
          }
          return results[refIdx].result[refField];
        }
      }
      return value;
    });

    try {
      const handler = handlers[cmd];
      if (!handler) throw { code: 'INVALID_PARAMS', message: `Unknown command: ${cmd}` };
      const result = await handler(resolvedParams);
      results.push({ result });
    } catch (e) {
      results.push({ error: { code: e.code || 'UNKNOWN', message: e.message || String(e) } });
    }
  }

  figma.commitUndo();
  return results;
}

handlers.batch = async (params) => {
  return executeBatch(params.commands);
};

// ============================================================
// Message dispatcher
// ============================================================
figma.ui.onmessage = async (msg) => {
  // Handle image fetch responses
  if (msg.type === 'imageData') {
    const pending = pendingImages.get(msg.requestId);
    if (pending) {
      pendingImages.delete(msg.requestId);
      pending.resolve(msg.bytes);
    }
    return;
  }
  if (msg.type === 'imageError') {
    const pending = pendingImages.get(msg.requestId);
    if (pending) {
      pendingImages.delete(msg.requestId);
      pending.reject({ code: 'INVALID_PARAMS', message: msg.error });
    }
    return;
  }

  // Handle editor info request from UI for hello handshake
  if (msg.type === 'getEditorInfo') {
    figma.ui.postMessage({
      type: 'hello',
      data: {
        type: 'hello',
        version: '1.0',
        editorType: figma.editorType,
        documentName: figma.root.name
      }
    });
    return;
  }

  // Handle commands from MCP server
  if (msg.type === 'command') {
    const { id, cmd, params } = msg;
    try {
      const handler = handlers[cmd];
      if (!handler) {
        throw { code: 'INVALID_PARAMS', message: `Unknown command: ${cmd}` };
      }
      const result = await handler(params || {});
      figma.ui.postMessage({ type: 'response', data: { id, result } });
    } catch (e) {
      figma.ui.postMessage({
        type: 'response',
        data: { id, error: { code: e.code || 'UNKNOWN', message: e.message || String(e) } }
      });
    }
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add plugin/code.js
git commit -m "feat: plugin command handler with all clusters (CRUD, text, images, introspection, slides, export, batch)"
```

---

### Task 4: Server WebSocket Bridge

**Files:**
- Create: `server/bridge.js`

Manages the WebSocket server, plugin connection state, command send/receive with timeouts.

- [ ] **Step 1: Write the test**

Create `test/bridge.test.js`:

```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { WebSocket, WebSocketServer } from 'ws';
import { Bridge } from '../server/bridge.js';

describe('Bridge', () => {
  let bridge;

  before(() => {
    bridge = new Bridge({ port: 0 }); // port 0 = random available port
  });

  after(() => {
    bridge.close();
  });

  it('should report not connected initially', () => {
    assert.strictEqual(bridge.isConnected(), false);
  });

  it('should accept plugin connection and track state', async () => {
    const addr = bridge.address();
    const ws = new WebSocket(`ws://localhost:${addr.port}`);
    await new Promise(resolve => ws.on('open', resolve));
    // Send hello
    ws.send(JSON.stringify({ type: 'hello', version: '1.0', editorType: 'slides', documentName: 'Test' }));
    // Wait for bridge to process
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.strictEqual(bridge.isConnected(), true);
    assert.strictEqual(bridge.editorType(), 'slides');
    ws.close();
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.strictEqual(bridge.isConnected(), false);
  });

  it('should send command and receive response', async () => {
    const addr = bridge.address();
    const ws = new WebSocket(`ws://localhost:${addr.port}`);
    await new Promise(resolve => ws.on('open', resolve));
    ws.send(JSON.stringify({ type: 'hello', version: '1.0', editorType: 'slides', documentName: 'Test' }));
    await new Promise(resolve => setTimeout(resolve, 50));

    // Mock plugin: echo back commands as responses
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.cmd) {
        ws.send(JSON.stringify({ id: msg.id, result: { echoed: msg.cmd } }));
      }
    });

    const result = await bridge.send('ping', {});
    assert.deepStrictEqual(result, { echoed: 'ping' });
    ws.close();
  });

  it('should timeout if no response', async () => {
    const addr = bridge.address();
    const ws = new WebSocket(`ws://localhost:${addr.port}`);
    await new Promise(resolve => ws.on('open', resolve));
    ws.send(JSON.stringify({ type: 'hello', version: '1.0', editorType: 'slides', documentName: 'Test' }));
    await new Promise(resolve => setTimeout(resolve, 50));

    // Don't respond to commands — should timeout
    try {
      await bridge.send('ping', {}, { timeout: 200 });
      assert.fail('Should have timed out');
    } catch (e) {
      assert.strictEqual(e.code, 'TIMEOUT');
    }
    ws.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/bridge.test.js`
Expected: FAIL — `Cannot find module '../server/bridge.js'`

- [ ] **Step 3: Write bridge.js**

```js
import { WebSocketServer } from 'ws';

export class Bridge {
  constructor(options = {}) {
    this.port = options.port !== undefined ? options.port : 3055;
    this._ws = null;
    this._editorType = null;
    this._documentName = null;
    this._pending = new Map();
    this._reqCounter = 0;

    this._wss = new WebSocketServer({ port: this.port });
    this._wss.on('connection', (ws) => this._onConnection(ws));
  }

  _onConnection(ws) {
    // Only allow one plugin connection at a time
    if (this._ws) {
      this._ws.close();
    }

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'hello') {
          this._ws = ws;
          this._editorType = msg.editorType;
          this._documentName = msg.documentName;
          console.error(`[bridge] Plugin connected: ${msg.documentName} (${msg.editorType})`);
          return;
        }
        // Response to a pending command
        if (msg.id && this._pending.has(msg.id)) {
          const { resolve, reject, timer } = this._pending.get(msg.id);
          clearTimeout(timer);
          this._pending.delete(msg.id);
          if (msg.error) {
            const err = new Error(msg.error.message);
            err.code = msg.error.code;
            reject(err);
          } else {
            resolve(msg.result);
          }
        }
      } catch (e) {
        console.error('[bridge] Failed to parse message:', e);
      }
    });

    ws.on('close', () => {
      if (this._ws === ws) {
        console.error('[bridge] Plugin disconnected');
        this._ws = null;
        this._editorType = null;
        this._documentName = null;
        // Reject all pending commands
        for (const [id, { reject, timer }] of this._pending) {
          clearTimeout(timer);
          const err = new Error('Plugin disconnected');
          err.code = 'NOT_CONNECTED';
          reject(err);
        }
        this._pending.clear();
      }
    });

    ws.on('error', (err) => {
      console.error('[bridge] WebSocket error:', err.message);
    });
  }

  isConnected() {
    return this._ws !== null && this._ws.readyState === 1;
  }

  editorType() {
    return this._editorType;
  }

  documentName() {
    return this._documentName;
  }

  address() {
    return this._wss.address();
  }

  send(cmd, params = {}, options = {}) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        const err = new Error('Plugin not connected');
        err.code = 'NOT_CONNECTED';
        return reject(err);
      }

      const id = `req-${++this._reqCounter}`;
      const timeout = options.timeout || (cmd.startsWith('export') ? 30000 : 10000);

      const timer = setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          const err = new Error(`Command ${cmd} timed out after ${timeout}ms`);
          err.code = 'TIMEOUT';
          reject(err);
        }
      }, timeout);

      this._pending.set(id, { resolve, reject, timer });
      this._ws.send(JSON.stringify({ id, cmd, params }));
    });
  }

  close() {
    for (const [id, { reject, timer }] of this._pending) {
      clearTimeout(timer);
      const err = new Error('Bridge closing');
      err.code = 'NOT_CONNECTED';
      reject(err);
    }
    this._pending.clear();
    if (this._ws) this._ws.close();
    this._wss.close();
  }
}
```

- [ ] **Step 4: Run tests**

Run: `node --test test/bridge.test.js`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add server/bridge.js test/bridge.test.js
git commit -m "feat: WebSocket bridge with connection management and command timeouts"
```

---

### Task 5: Server MCP Entry Point + Tool Registration

**Files:**
- Create: `server/index.js`
- Create: `server/tools.js`

- [ ] **Step 1: Write tools.js — all MCP tool registrations**

```js
import { z } from 'zod/v4';

// Helper: wrap bridge.send into MCP tool result
function toolResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function toolError(code, message) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: { code, message } }) }], isError: true };
}

export function registerTools(server, bridge) {

  // ============================
  // Tier 1: High-Level
  // ============================

  server.registerTool('connection_status', {
    title: 'Connection Status',
    description: 'Check if the Figma plugin is connected and get editor context',
    inputSchema: z.object({})
  }, async () => {
    return toolResult({
      connected: bridge.isConnected(),
      editorType: bridge.editorType(),
      documentName: bridge.documentName()
    });
  });

  server.registerTool('get_editor_info', {
    title: 'Get Editor Info',
    description: 'Get editor type, document name, and page count from the connected Figma file',
    inputSchema: z.object({})
  }, async () => {
    const result = await bridge.send('getEditorInfo');
    return toolResult(result);
  });

  server.registerTool('get_slide_grid', {
    title: 'Get Slide Grid',
    description: 'Get the full slide deck structure: rows and slides with their IDs and names',
    inputSchema: z.object({})
  }, async () => {
    const result = await bridge.send('getSlideGrid');
    return toolResult(result);
  });

  server.registerTool('get_slide_context', {
    title: 'Get Slide Context',
    description: 'Get a rich semantic dump of everything on a slide — text content, shapes, images, positions, styles. Best for understanding what is on a slide.',
    inputSchema: z.object({
      slideId: z.string().describe('The ID of the slide to inspect')
    })
  }, async ({ slideId }) => {
    const result = await bridge.send('getSlideContext', { slideId });
    return toolResult(result);
  });

  server.registerTool('screenshot_slide', {
    title: 'Screenshot Slide',
    description: 'Capture a visual screenshot of a slide as PNG. Returns base64-encoded image data.',
    inputSchema: z.object({
      slideId: z.string().describe('The ID of the slide to screenshot'),
      scale: z.number().optional().describe('Export scale (1 = 1920x1080, 2 = 3840x2160). Default: 1')
    })
  }, async ({ slideId, scale }) => {
    const result = await bridge.send('exportSlide', { slideId, scale }, { timeout: 30000 });
    return {
      content: [{
        type: 'image',
        data: result.base64,
        mimeType: 'image/png'
      }]
    };
  });

  server.registerTool('screenshot_all_slides', {
    title: 'Screenshot All Slides',
    description: 'Capture thumbnails of all slides in the deck. Returns array of base64-encoded PNG images.',
    inputSchema: z.object({
      scale: z.number().optional().describe('Export scale. Default: 0.5 (960x540 thumbnails)'),
      maxSlides: z.number().optional().describe('Maximum number of slides to export. Default: 50')
    })
  }, async ({ scale, maxSlides }) => {
    const result = await bridge.send('exportAllSlides', { scale, maxSlides }, { timeout: 60000 });
    const content = result.slides.map(s => ({
      type: 'image',
      data: s.base64,
      mimeType: 'image/png'
    }));
    return { content };
  });

  server.registerTool('create_slide', {
    title: 'Create Slide',
    description: 'Create a new empty slide in the deck. Fixed 1920x1080.',
    inputSchema: z.object({
      rowIndex: z.number().optional().describe('Row index to add the slide to. Default: last row.'),
      fills: z.any().optional().describe('Background fill. Hex string "#ff0000" or Figma Paint array.'),
      themeId: z.string().optional().describe('Theme ID to apply')
    })
  }, async (params) => {
    const result = await bridge.send('createSlide', params);
    return toolResult(result);
  });

  server.registerTool('clear_slide', {
    title: 'Clear Slide',
    description: 'Remove all content from a slide, keeping the slide itself.',
    inputSchema: z.object({
      slideId: z.string().describe('The ID of the slide to clear')
    })
  }, async ({ slideId }) => {
    const result = await bridge.send('clearSlide', { slideId });
    return toolResult(result);
  });

  // ============================
  // Tier 2: Low-Level — Node CRUD
  // ============================

  server.registerTool('create_node', {
    title: 'Create Node',
    description: 'Create a new node (FRAME, RECTANGLE, ELLIPSE, POLYGON, STAR, LINE, VECTOR, TEXT) with optional properties. For Slides-specific types (tables, shapes), use dedicated tools.',
    inputSchema: z.object({
      type: z.enum(['FRAME', 'RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'LINE', 'VECTOR', 'TEXT']).describe('Node type'),
      parentId: z.string().describe('Parent node ID (typically the slide ID)'),
      props: z.record(z.any()).optional().describe('Properties: x, y, width, height, fills, strokes, rotation, opacity, cornerRadius, etc. Fills accept hex "#ff0000" or Figma Paint array.')
    })
  }, async (params) => {
    const result = await bridge.send('createNode', params);
    return toolResult(result);
  });

  server.registerTool('set_properties', {
    title: 'Set Properties',
    description: 'Modify properties of any node. Supports: x, y, width, height, rotation, fills, strokes, strokeWeight, effects, opacity, blendMode, cornerRadius, visible, locked, layoutMode, itemSpacing, padding.',
    inputSchema: z.object({
      nodeId: z.string().describe('Target node ID'),
      props: z.record(z.any()).describe('Properties to set. Fills accept hex "#ff0000" or Figma Paint array.')
    })
  }, async (params) => {
    const result = await bridge.send('setProperties', params);
    return toolResult(result);
  });

  server.registerTool('delete_node', {
    title: 'Delete Node',
    description: 'Remove a node from the canvas',
    inputSchema: z.object({
      nodeId: z.string().describe('Node ID to delete')
    })
  }, async ({ nodeId }) => {
    const result = await bridge.send('deleteNode', { nodeId });
    return toolResult(result);
  });

  server.registerTool('clone_node', {
    title: 'Clone Node',
    description: 'Duplicate a node. Optionally reparent to a different container.',
    inputSchema: z.object({
      nodeId: z.string().describe('Node ID to clone'),
      parentId: z.string().optional().describe('Parent to place clone in. Default: same parent.')
    })
  }, async (params) => {
    const result = await bridge.send('cloneNode', params);
    return toolResult(result);
  });

  server.registerTool('reparent_node', {
    title: 'Reparent Node',
    description: 'Move a node to a different parent container',
    inputSchema: z.object({
      nodeId: z.string().describe('Node to move'),
      parentId: z.string().describe('New parent'),
      index: z.number().optional().describe('Position in parent children list')
    })
  }, async (params) => {
    const result = await bridge.send('reparentNode', params);
    return toolResult(result);
  });

  server.registerTool('group_nodes', {
    title: 'Group Nodes',
    description: 'Group multiple nodes together',
    inputSchema: z.object({
      nodeIds: z.array(z.string()).describe('Node IDs to group'),
      parentId: z.string().optional().describe('Parent for the group')
    })
  }, async (params) => {
    const result = await bridge.send('groupNodes', params);
    return toolResult(result);
  });

  server.registerTool('ungroup_node', {
    title: 'Ungroup Node',
    description: 'Ungroup a group node, returning children to the parent',
    inputSchema: z.object({
      nodeId: z.string().describe('Group node ID to ungroup')
    })
  }, async ({ nodeId }) => {
    const result = await bridge.send('ungroupNode', { nodeId });
    return toolResult(result);
  });

  // ============================
  // Tier 2: Low-Level — Text
  // ============================

  server.registerTool('set_text', {
    title: 'Set Text',
    description: 'Set text content of a text node. Font loading is automatic.',
    inputSchema: z.object({
      nodeId: z.string().describe('Text node ID'),
      text: z.string().describe('New text content'),
      fontName: z.string().optional().describe('Font name, e.g. "Inter Bold", "Roboto Regular"')
    })
  }, async (params) => {
    const result = await bridge.send('setText', params);
    return toolResult(result);
  });

  server.registerTool('set_text_range_style', {
    title: 'Set Text Range Style',
    description: 'Apply styles to a character range within a text node',
    inputSchema: z.object({
      nodeId: z.string().describe('Text node ID'),
      start: z.number().describe('Start character index (0-based)'),
      end: z.number().describe('End character index (exclusive)'),
      props: z.record(z.any()).describe('Style props: fontSize, fontName, fills, letterSpacing, lineHeight, textDecoration, textCase')
    })
  }, async (params) => {
    const result = await bridge.send('setTextRangeStyle', params);
    return toolResult(result);
  });

  server.registerTool('get_text_content', {
    title: 'Get Text Content',
    description: 'Read text content and style segments from a text node',
    inputSchema: z.object({
      nodeId: z.string().describe('Text node ID')
    })
  }, async ({ nodeId }) => {
    const result = await bridge.send('getTextContent', { nodeId });
    return toolResult(result);
  });

  server.registerTool('list_fonts', {
    title: 'List Fonts',
    description: 'List all available fonts in the Figma editor',
    inputSchema: z.object({})
  }, async () => {
    const result = await bridge.send('listFonts');
    return toolResult(result);
  });

  // ============================
  // Tier 2: Low-Level — Images
  // ============================

  server.registerTool('place_image', {
    title: 'Place Image',
    description: 'Place an image on the canvas from a URL or raw bytes. Creates a rectangle with IMAGE fill.',
    inputSchema: z.object({
      parentId: z.string().describe('Parent node ID'),
      url: z.string().optional().describe('Image URL to fetch'),
      bytes: z.array(z.number()).optional().describe('Raw image bytes as number array'),
      x: z.number().optional().describe('X position'),
      y: z.number().optional().describe('Y position'),
      width: z.number().optional().describe('Width. Default: 400'),
      height: z.number().optional().describe('Height. Default: 300'),
      scaleMode: z.enum(['FILL', 'FIT', 'CROP', 'TILE']).optional().describe('Image scale mode. Default: FILL')
    })
  }, async (params) => {
    const result = await bridge.send('placeImage', params, { timeout: 30000 });
    return toolResult(result);
  });

  // ============================
  // Tier 2: Low-Level — Slides
  // ============================

  server.registerTool('create_slide_row', {
    title: 'Create Slide Row',
    description: 'Create a new slide row in the deck grid',
    inputSchema: z.object({
      index: z.number().optional().describe('Position in the grid')
    })
  }, async (params) => {
    const result = await bridge.send('createSlideRow', params);
    return toolResult(result);
  });

  server.registerTool('duplicate_slide', {
    title: 'Duplicate Slide',
    description: 'Clone an existing slide with all its content',
    inputSchema: z.object({
      slideId: z.string().describe('Slide to duplicate')
    })
  }, async ({ slideId }) => {
    const result = await bridge.send('duplicateSlide', { slideId });
    return toolResult(result);
  });

  server.registerTool('delete_slide', {
    title: 'Delete Slide',
    description: 'Remove a slide from the deck',
    inputSchema: z.object({
      slideId: z.string().describe('Slide to delete')
    })
  }, async ({ slideId }) => {
    const result = await bridge.send('deleteSlide', { slideId });
    return toolResult(result);
  });

  server.registerTool('reorder_slides', {
    title: 'Reorder Slides',
    description: 'Set the order of slide rows in the deck grid',
    inputSchema: z.object({
      rowIds: z.array(z.string()).describe('Row IDs in desired order')
    })
  }, async ({ rowIds }) => {
    const result = await bridge.send('reorderSlides', { rowIds });
    return toolResult(result);
  });

  server.registerTool('move_slide_to_row', {
    title: 'Move Slide to Row',
    description: 'Move a slide to a different row',
    inputSchema: z.object({
      slideId: z.string().describe('Slide to move'),
      rowId: z.string().describe('Target row'),
      index: z.number().optional().describe('Position within the row')
    })
  }, async (params) => {
    const result = await bridge.send('moveSlideToRow', params);
    return toolResult(result);
  });

  server.registerTool('set_slide_transition', {
    title: 'Set Slide Transition',
    description: 'Set transition effect for a slide. Styles: DISSOLVE, SLIDE_FROM_LEFT/RIGHT/TOP/BOTTOM, PUSH_FROM_*, SMART_ANIMATE, NONE',
    inputSchema: z.object({
      slideId: z.string().describe('Target slide'),
      style: z.string().describe('Transition style'),
      duration: z.number().optional().describe('Duration in seconds. Default: 0.4'),
      curve: z.string().optional().describe('Easing curve. Default: EASE_OUT'),
      timing: z.record(z.any()).optional().describe('Timing config. Default: { type: "ON_CLICK" }')
    })
  }, async (params) => {
    const result = await bridge.send('setSlideTransition', params);
    return toolResult(result);
  });

  server.registerTool('set_slide_skipped', {
    title: 'Set Slide Skipped',
    description: 'Mark a slide as skipped (excluded from presentation)',
    inputSchema: z.object({
      slideId: z.string().describe('Target slide'),
      isSkipped: z.boolean().describe('Whether to skip this slide')
    })
  }, async (params) => {
    const result = await bridge.send('setSlideSkipped', params);
    return toolResult(result);
  });

  server.registerTool('set_slide_theme', {
    title: 'Set Slide Theme',
    description: 'Apply a theme to a slide',
    inputSchema: z.object({
      slideId: z.string().describe('Target slide'),
      themeId: z.string().describe('Theme ID')
    })
  }, async (params) => {
    const result = await bridge.send('setSlideTheme', params);
    return toolResult(result);
  });

  server.registerTool('focus_slide', {
    title: 'Focus Slide',
    description: 'Navigate to and focus a specific slide in the editor',
    inputSchema: z.object({
      slideId: z.string().describe('Slide to focus')
    })
  }, async ({ slideId }) => {
    const result = await bridge.send('focusSlide', { slideId });
    return toolResult(result);
  });

  // ============================
  // Tier 2: Low-Level — Tables
  // ============================

  server.registerTool('create_table', {
    title: 'Create Table',
    description: 'Create a table node (Slides and FigJam only)',
    inputSchema: z.object({
      parentId: z.string().describe('Parent node ID (typically slide ID)'),
      rows: z.number().describe('Number of rows'),
      cols: z.number().describe('Number of columns'),
      cellWidth: z.number().optional().describe('Cell width'),
      cellHeight: z.number().optional().describe('Cell height')
    })
  }, async (params) => {
    const result = await bridge.send('createTable', params);
    return toolResult(result);
  });

  server.registerTool('set_cell_content', {
    title: 'Set Cell Content',
    description: 'Set text content of a table cell',
    inputSchema: z.object({
      tableId: z.string().describe('Table node ID'),
      row: z.number().describe('Row index (0-based)'),
      col: z.number().describe('Column index (0-based)'),
      text: z.string().describe('Cell text content'),
      props: z.record(z.any()).optional().describe('Text style props')
    })
  }, async (params) => {
    const result = await bridge.send('setCellContent', params);
    return toolResult(result);
  });

  server.registerTool('get_cell_content', {
    title: 'Get Cell Content',
    description: 'Read text content of a table cell',
    inputSchema: z.object({
      tableId: z.string().describe('Table node ID'),
      row: z.number().describe('Row index (0-based)'),
      col: z.number().describe('Column index (0-based)')
    })
  }, async (params) => {
    const result = await bridge.send('getCellContent', params);
    return toolResult(result);
  });

  server.registerTool('insert_table_row', {
    title: 'Insert Table Row',
    description: 'Insert a row into a table',
    inputSchema: z.object({
      tableId: z.string().describe('Table node ID'),
      index: z.number().optional().describe('Position to insert. Default: end.')
    })
  }, async (params) => {
    const result = await bridge.send('insertTableRow', params);
    return toolResult(result);
  });

  server.registerTool('insert_table_column', {
    title: 'Insert Table Column',
    description: 'Insert a column into a table',
    inputSchema: z.object({
      tableId: z.string().describe('Table node ID'),
      index: z.number().optional().describe('Position to insert. Default: end.')
    })
  }, async (params) => {
    const result = await bridge.send('insertTableColumn', params);
    return toolResult(result);
  });

  server.registerTool('delete_table_row', {
    title: 'Delete Table Row',
    description: 'Remove a row from a table',
    inputSchema: z.object({
      tableId: z.string().describe('Table node ID'),
      index: z.number().describe('Row index to delete')
    })
  }, async (params) => {
    const result = await bridge.send('deleteTableRow', params);
    return toolResult(result);
  });

  server.registerTool('delete_table_column', {
    title: 'Delete Table Column',
    description: 'Remove a column from a table',
    inputSchema: z.object({
      tableId: z.string().describe('Table node ID'),
      index: z.number().describe('Column index to delete')
    })
  }, async (params) => {
    const result = await bridge.send('deleteTableColumn', params);
    return toolResult(result);
  });

  // ============================
  // Tier 2: Low-Level — Media
  // ============================

  server.registerTool('create_shape_with_text', {
    title: 'Create Shape With Text',
    description: 'Create a shape node with built-in text label (Slides/FigJam)',
    inputSchema: z.object({
      parentId: z.string().describe('Parent node ID'),
      shapeType: z.string().optional().describe('Shape type: SQUARE, ELLIPSE, ROUNDED_RECTANGLE, DIAMOND, TRIANGLE_UP, etc.'),
      text: z.string().describe('Text content'),
      props: z.record(z.any()).optional().describe('Additional properties')
    })
  }, async (params) => {
    const result = await bridge.send('createShapeWithText', params);
    return toolResult(result);
  });

  server.registerTool('create_gif', {
    title: 'Create GIF',
    description: 'Create a GIF node (Slides only, may have limited API support)',
    inputSchema: z.object({
      parentId: z.string().describe('Parent node ID'),
      data: z.array(z.number()).optional().describe('GIF data as byte array')
    })
  }, async (params) => {
    const result = await bridge.send('createGif', params);
    return toolResult(result);
  });

  server.registerTool('create_video', {
    title: 'Create Video',
    description: 'Create a video node (Slides only, may have limited API support)',
    inputSchema: z.object({
      parentId: z.string().describe('Parent node ID'),
      data: z.array(z.number()).describe('Video data as byte array')
    })
  }, async (params) => {
    const result = await bridge.send('createVideo', params);
    return toolResult(result);
  });

  server.registerTool('replace_media', {
    title: 'Replace Media',
    description: 'Replace media content of a video/image node',
    inputSchema: z.object({
      nodeId: z.string().describe('Target node ID'),
      data: z.array(z.number()).describe('New media data as byte array')
    })
  }, async (params) => {
    const result = await bridge.send('replaceMedia', params);
    return toolResult(result);
  });

  // ============================
  // Tier 3: Introspection
  // ============================

  server.registerTool('get_node_tree', {
    title: 'Get Node Tree',
    description: 'Get structural tree of nodes with IDs, types, names, bounds. Use depth parameter to limit recursion.',
    inputSchema: z.object({
      nodeId: z.string().optional().describe('Root node ID. Default: current page.'),
      depth: z.number().optional().describe('Max depth to recurse. null = unlimited.')
    })
  }, async (params) => {
    const result = await bridge.send('getNodeTree', params);
    return toolResult(result);
  });

  server.registerTool('get_node_properties', {
    title: 'Get Node Properties',
    description: 'Read all or specific properties of a node',
    inputSchema: z.object({
      nodeId: z.string().describe('Target node ID'),
      properties: z.array(z.string()).optional().describe('Specific property names to read. Default: all common properties.')
    })
  }, async (params) => {
    const result = await bridge.send('getNodeProperties', params);
    return toolResult(result);
  });

  server.registerTool('find_nodes', {
    title: 'Find Nodes',
    description: 'Search for nodes matching criteria: name (substring), type, visible, locked',
    inputSchema: z.object({
      parentId: z.string().optional().describe('Search root. Default: current page.'),
      criteria: z.object({
        name: z.string().optional().describe('Substring match on node name'),
        type: z.string().optional().describe('Node type (FRAME, TEXT, RECTANGLE, etc.)'),
        visible: z.boolean().optional(),
        locked: z.boolean().optional()
      }).describe('Search criteria, all AND-combined')
    })
  }, async (params) => {
    const result = await bridge.send('findNodes', params);
    return toolResult(result);
  });

  server.registerTool('get_selection', {
    title: 'Get Selection',
    description: 'Get currently selected node IDs',
    inputSchema: z.object({})
  }, async () => {
    const result = await bridge.send('getSelection');
    return toolResult(result);
  });

  server.registerTool('set_selection', {
    title: 'Set Selection',
    description: 'Set the current selection to specific nodes',
    inputSchema: z.object({
      nodeIds: z.array(z.string()).describe('Node IDs to select')
    })
  }, async ({ nodeIds }) => {
    const result = await bridge.send('setSelection', { nodeIds });
    return toolResult(result);
  });

  server.registerTool('get_interactive_elements', {
    title: 'Get Interactive Elements',
    description: 'List interactive elements on a slide (polls, embeds, etc.). Read-only — cannot create these, only reposition.',
    inputSchema: z.object({
      slideId: z.string().describe('Slide ID')
    })
  }, async ({ slideId }) => {
    const result = await bridge.send('getInteractiveElements', { slideId });
    return toolResult(result);
  });

  server.registerTool('list_themes', {
    title: 'List Themes',
    description: 'List available slide themes',
    inputSchema: z.object({})
  }, async () => {
    const result = await bridge.send('listThemes');
    return toolResult(result);
  });

  server.registerTool('export_node', {
    title: 'Export Node',
    description: 'Export any node to PNG, JPG, SVG, or PDF',
    inputSchema: z.object({
      nodeId: z.string().describe('Node to export'),
      format: z.enum(['PNG', 'JPG', 'SVG', 'PDF']).optional().describe('Export format. Default: PNG'),
      scale: z.number().optional().describe('Scale factor. Default: 1')
    })
  }, async (params) => {
    const result = await bridge.send('exportNode', params, { timeout: 30000 });
    if (params.format === 'SVG') {
      return { content: [{ type: 'text', text: result.base64 }] };
    }
    const mimeMap = { PNG: 'image/png', JPG: 'image/jpeg', PDF: 'application/pdf' };
    return {
      content: [{
        type: 'image',
        data: result.base64,
        mimeType: mimeMap[params.format || 'PNG'] || 'image/png'
      }]
    };
  });

  // ============================
  // Tier 2: Viewport
  // ============================

  server.registerTool('set_viewport', {
    title: 'Set Viewport',
    description: 'Set the editor viewport center and zoom level',
    inputSchema: z.object({
      center: z.object({ x: z.number(), y: z.number() }).optional().describe('Viewport center point'),
      zoom: z.number().optional().describe('Zoom level (1 = 100%)')
    })
  }, async (params) => {
    const result = await bridge.send('setViewport', params);
    return toolResult(result);
  });

  server.registerTool('zoom_to_fit', {
    title: 'Zoom to Fit',
    description: 'Zoom viewport to fit specific nodes or all content',
    inputSchema: z.object({
      nodeIds: z.array(z.string()).optional().describe('Node IDs to fit. Default: all page content.')
    })
  }, async (params) => {
    const result = await bridge.send('zoomToFit', params);
    return toolResult(result);
  });

  // ============================
  // Tier 4: Batch
  // ============================

  server.registerTool('batch_operations', {
    title: 'Batch Operations',
    description: 'Execute multiple commands in one round-trip. Use $N.field to reference results from earlier commands (e.g., "$0.nodeId" gets the nodeId from command 0). All commands execute as a single Figma undo step.',
    inputSchema: z.object({
      commands: z.array(z.object({
        cmd: z.string().describe('Command name (e.g., createNode, setProperties, setText)'),
        params: z.record(z.any()).optional().describe('Command parameters. Use "$N.field" to reference result of command N.')
      })).describe('Array of commands to execute sequentially')
    })
  }, async ({ commands }) => {
    const result = await bridge.send('batch', { commands }, { timeout: 30000 });
    return toolResult(result);
  });
}
```

- [ ] **Step 2: Write server/index.js**

```js
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server';
import { Bridge } from './bridge.js';
import { registerTools } from './tools.js';

const PORT = parseInt(process.env.FIGMA_WS_PORT || '3055', 10);

const server = new McpServer({
  name: 'figma-slide-mcp',
  version: '0.1.0'
});

const bridge = new Bridge({ port: PORT });

registerTools(server, bridge);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[figma-slide-mcp] MCP server running on stdio`);
  console.error(`[figma-slide-mcp] WebSocket server listening on ws://localhost:${PORT}`);
  console.error(`[figma-slide-mcp] Waiting for Figma plugin connection...`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
```

- [ ] **Step 3: Run tests**

Run: `node --test test/bridge.test.js`
Expected: All tests still pass

- [ ] **Step 4: Verify server starts**

Run: `node server/index.js &` (will start MCP server on stdio + WS on 3055)
Expected: Logs `MCP server running on stdio` and `WebSocket server listening on ws://localhost:3055`

Kill it after verification.

- [ ] **Step 5: Commit**

```bash
git add server/index.js server/tools.js
git commit -m "feat: MCP server with all tool registrations across 4 tiers"
```

---

### Task 6: Utility Tests

**Files:**
- Create: `test/utils.test.js`

Test the fills expansion and batch $N resolution logic (these are pure functions extracted for testing).

- [ ] **Step 1: Create a shared utils module**

Create `server/utils.js`:

```js
// Hex string to Figma SOLID paint
export function expandFills(fills) {
  if (!fills) return undefined;
  if (typeof fills === 'string') fills = [fills];
  if (!Array.isArray(fills)) return fills;
  return fills.map(f => {
    if (typeof f === 'string' && f.startsWith('#')) {
      const hex = f.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;
      return { type: 'SOLID', color: { r, g, b }, opacity: 1 };
    }
    return f;
  });
}

// Resolve $N.field references in batch params
export function resolveBatchRefs(params, results) {
  const json = JSON.stringify(params);
  const resolved = json.replace(/"\$(\d+)\.(\w+)"/g, (match, idx, field) => {
    const i = parseInt(idx);
    if (i >= results.length || results[i].error) {
      throw new Error(`Reference $${i} failed or not yet available`);
    }
    const val = results[i].result[field];
    return JSON.stringify(val);
  });
  return JSON.parse(resolved);
}
```

- [ ] **Step 2: Write test/utils.test.js**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { expandFills, resolveBatchRefs } from '../server/utils.js';

describe('expandFills', () => {
  it('should expand hex string to Figma Paint', () => {
    const result = expandFills('#ff0000');
    assert.deepStrictEqual(result, [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 1 }]);
  });

  it('should expand hex array', () => {
    const result = expandFills(['#00ff00']);
    assert.strictEqual(result[0].color.g, 1);
  });

  it('should pass through Figma Paint objects', () => {
    const paint = [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 0.8 }];
    const result = expandFills(paint);
    assert.deepStrictEqual(result, paint);
  });

  it('should return undefined for undefined', () => {
    assert.strictEqual(expandFills(undefined), undefined);
  });
});

describe('resolveBatchRefs', () => {
  it('should resolve $0.nodeId', () => {
    const results = [{ result: { nodeId: '1:23', name: 'Slide' } }];
    const params = { parentId: '$0.nodeId', text: 'Hello' };
    const resolved = resolveBatchRefs(params, results);
    assert.strictEqual(resolved.parentId, '1:23');
    assert.strictEqual(resolved.text, 'Hello');
  });

  it('should resolve multiple references', () => {
    const results = [
      { result: { nodeId: '1:23' } },
      { result: { nodeId: '1:24' } }
    ];
    const params = { a: '$0.nodeId', b: '$1.nodeId' };
    const resolved = resolveBatchRefs(params, results);
    assert.strictEqual(resolved.a, '1:23');
    assert.strictEqual(resolved.b, '1:24');
  });

  it('should throw on failed reference', () => {
    const results = [{ error: { code: 'FAIL', message: 'oops' } }];
    assert.throws(() => resolveBatchRefs({ parentId: '$0.nodeId' }, results));
  });

  it('should throw on out-of-bounds reference', () => {
    const results = [];
    assert.throws(() => resolveBatchRefs({ parentId: '$0.nodeId' }, results));
  });
});
```

- [ ] **Step 3: Run tests**

Run: `node --test test/utils.test.js`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add server/utils.js test/utils.test.js
git commit -m "feat: shared utilities with fills expansion and batch reference resolution"
```

---

### Task 7: Integration Verification and README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All tests in `test/bridge.test.js` and `test/utils.test.js` pass

- [ ] **Step 2: Write README.md**

```markdown
# FigmaSlideMCP

MCP server that gives AI agents full read/write/visual control over Figma Slides.

## Architecture

```
AI Agent <--stdio--> MCP Server <--WebSocket--> Figma Plugin <--figma.*--> Canvas
```

## Quick Start

### 1. Install

```bash
npm install
```

### 2. Load the Plugin in Figma

1. Open a Figma Slides file
2. Go to **Plugins > Development > Import plugin from manifest...**
3. Select `plugin/manifest.json`
4. Run the plugin — it will connect to `ws://localhost:3055`

### 3. Configure your MCP client

Add to your MCP client config (e.g. Claude Code `settings.json`):

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

The server exposes ~40 tools across 4 tiers:

- **High-level:** `create_slide`, `get_slide_context`, `screenshot_slide`, `clear_slide`, `get_slide_grid`
- **Low-level:** `create_node`, `set_properties`, `set_text`, `place_image`, `create_table`, etc.
- **Introspection:** `get_node_tree`, `find_nodes`, `export_node`, `list_fonts`
- **Batch:** `batch_operations` — multiple commands in one call with `$N.field` references

## Environment Variables

- `FIGMA_WS_PORT` — WebSocket port (default: `3055`)

## No Build Required

The plugin is 3 plain files (`manifest.json`, `code.js`, `ui.html`). No TypeScript, no bundler.
The server runs with `node server/index.js`.
```

- [ ] **Step 3: Final commit**

```bash
git add README.md
git commit -m "docs: README with setup instructions and tool overview"
```

---

## Summary

| Task | Files | What it delivers |
|------|-------|-----------------|
| 1 | `package.json`, `plugin/manifest.json` | Project setup, dependencies installed |
| 2 | `plugin/ui.html` | WebSocket bridge with reconnection + image relay |
| 3 | `plugin/code.js` | All ~35 command handlers (CRUD, text, images, slides, export, batch) |
| 4 | `server/bridge.js`, `test/bridge.test.js` | WebSocket connection manager with tests |
| 5 | `server/index.js`, `server/tools.js` | MCP server with all ~40 tool registrations |
| 6 | `server/utils.js`, `test/utils.test.js` | Shared utilities with tests |
| 7 | `README.md` | Documentation, final integration check |

After Task 7, the system is fully functional: start the server, load the plugin, connect, and the AI agent has full Figma Slides control.
