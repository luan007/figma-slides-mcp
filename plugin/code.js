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
  return fills.map(function(f) {
    if (typeof f === 'string' && f.startsWith('#')) {
      var hex = f.replace('#', '');
      var r = parseInt(hex.substring(0, 2), 16) / 255;
      var g = parseInt(hex.substring(2, 4), 16) / 255;
      var b = parseInt(hex.substring(4, 6), 16) / 255;
      return { type: 'SOLID', color: { r: r, g: g, b: b }, opacity: 1 };
    }
    return f;
  });
}

// ============================================================
// Utility: parse font name string "Family Style" -> { family, style }
// ============================================================
function parseFontName(fontNameStr) {
  if (!fontNameStr) return { family: 'Inter', style: 'Regular' };
  var parts = fontNameStr.split(' ');
  if (parts.length === 1) return { family: parts[0], style: 'Regular' };
  var style = parts.pop();
  return { family: parts.join(' '), style: style };
}

// ============================================================
// Utility: apply props bag to a node
// ============================================================
function applyProps(node, props) {
  if (!props) return;
  for (var key in props) {
    var value = props[key];
    switch (key) {
      case 'width':
      case 'height':
        break; // handled below
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
      case 'primaryAxisSizingMode': case 'counterAxisSizingMode':
        node[key] = value;
        break;
      case 'constraints':
        node.constraints = value;
        break;
      case 'name':
        node.name = value;
        break;
    }
  }
  if (props.width !== undefined || props.height !== undefined) {
    var w = props.width !== undefined ? props.width : node.width;
    var h = props.height !== undefined ? props.height : node.height;
    node.resize(w, h);
  }
}

// ============================================================
// Utility: get node by ID with error
// ============================================================
async function getNode(nodeId) {
  var node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw { code: 'NODE_NOT_FOUND', message: 'Node ' + nodeId + ' not found' };
  return node;
}

// ============================================================
// Command Handlers
// ============================================================
var handlers = {};

// --- Meta ---
handlers.ping = async function() { return { pong: true }; };

handlers.probeFigmaAPI = async function(params) {
  if (params.probe === 'getSlideGrid') {
    var grid = figma.getSlideGrid();
    return {
      type: typeof grid,
      isArray: Array.isArray(grid),
      constructor: grid && grid.constructor ? grid.constructor.name : 'null',
      hasChildren: grid && grid.children ? true : false,
      nodeType: grid && grid.type ? grid.type : 'none',
      length: grid && grid.length !== undefined ? grid.length : 'no length'
    };
  }
  if (params.probe === 'createSlide') {
    try {
      var slide = figma.createSlide();
      var id = slide.id;
      var type = slide.type;
      return { success: true, nodeId: id, type: type };
    } catch(e) {
      return { success: false, error: e.message || String(e) };
    }
  }
  if (params.probe === 'svgMethods') {
    var methods = [];
    var candidates = ['createNodeFromSvg', 'createFromSvg', 'createSvg', 'createVector', 'createVectorPath', 'createNodeFromJSXAsync'];
    for (var m = 0; m < candidates.length; m++) {
      methods.push({ name: candidates[m], type: typeof figma[candidates[m]] });
    }
    // Also check if createVector has useful methods
    try {
      var vec = figma.createVector();
      var vecProps = ['vectorNetwork', 'vectorPaths', 'strokeGeometry', 'fillGeometry'];
      var vecInfo = {};
      for (var v = 0; v < vecProps.length; v++) {
        vecInfo[vecProps[v]] = typeof vec[vecProps[v]];
      }
      vec.remove();
      methods.push({ name: 'vectorNode_props', info: vecInfo });
    } catch(e) {
      methods.push({ name: 'vectorNode_error', error: e.message });
    }
    return { methods: methods };
  }
  if (params.probe === 'createVideo') {
    try {
      // Try with a minimal valid mp4 header
      var video = await figma.createVideoAsync(new Uint8Array(params.data || []));
      return { success: true, nodeId: video.id, type: video.type };
    } catch(e) {
      return { success: false, error: e.message || String(e) };
    }
  }
  if (params.probe === 'videoFromUrl') {
    // Test if we can fetch video in iframe and pass to createVideoAsync
    try {
      var methods = [];
      for (var k in figma) {
        if (typeof figma[k] === 'function' && (k.includes('ideo') || k.includes('media') || k.includes('Gif'))) {
          methods.push(k);
        }
      }
      // Check if createVideoAsync signature hints
      return { videoMethods: methods, createVideoAsync: typeof figma.createVideoAsync };
    } catch(e) {
      return { success: false, error: e.message || String(e) };
    }
  }
  return { error: 'specify params.probe' };
};

handlers.getEditorInfo = async function() {
  return {
    editorType: figma.editorType,
    documentName: figma.root.name,
    pageCount: figma.root.children.length
  };
};

// --- Node CRUD ---
handlers.createNode = async function(params) {
  var parent = params.parentId ? await getNode(params.parentId) : figma.currentPage;
  var node;
  switch (params.type) {
    case 'FRAME': node = figma.createFrame(); break;
    case 'RECTANGLE': node = figma.createRectangle(); break;
    case 'ELLIPSE': node = figma.createEllipse(); break;
    case 'POLYGON': node = figma.createPolygon(); break;
    case 'STAR': node = figma.createStar(); break;
    case 'LINE': node = figma.createLine(); break;
    case 'VECTOR': node = figma.createVector(); break;
    case 'TEXT': node = figma.createText(); break;
    default:
      throw { code: 'INVALID_PARAMS', message: 'Unknown type: ' + params.type + '. Use dedicated commands for Slides-specific types.' };
  }
  parent.appendChild(node);
  applyProps(node, params.props);
  return { nodeId: node.id, name: node.name };
};

handlers.setProperties = async function(params) {
  var node = await getNode(params.nodeId);
  applyProps(node, params.props);
  return {};
};

handlers.deleteNode = async function(params) {
  var node = await getNode(params.nodeId);
  node.remove();
  return {};
};

handlers.cloneNode = async function(params) {
  var node = await getNode(params.nodeId);
  var clone = node.clone();
  if (params.parentId) {
    var parent = await getNode(params.parentId);
    parent.appendChild(clone);
  }
  return { nodeId: clone.id };
};

handlers.reparentNode = async function(params) {
  var node = await getNode(params.nodeId);
  var parent = await getNode(params.parentId);
  if (params.index !== undefined) {
    parent.insertChild(params.index, node);
  } else {
    parent.appendChild(node);
  }
  return {};
};

handlers.groupNodes = async function(params) {
  var nodes = [];
  for (var i = 0; i < params.nodeIds.length; i++) {
    nodes.push(await getNode(params.nodeIds[i]));
  }
  var parent = params.parentId ? await getNode(params.parentId) : nodes[0].parent;
  var group = figma.group(nodes, parent);
  return { nodeId: group.id };
};

handlers.ungroupNode = async function(params) {
  var node = await getNode(params.nodeId);
  var childIds = [];
  var children = node.children.slice();
  var parent = node.parent;
  for (var i = 0; i < children.length; i++) {
    childIds.push(children[i].id);
    parent.appendChild(children[i]);
  }
  node.remove();
  return { childIds: childIds };
};

// --- Text ---
handlers.setText = async function(params) {
  var node = await getNode(params.nodeId);
  var fontName = params.fontName
    ? parseFontName(params.fontName)
    : (node.fontName !== figma.mixed ? node.fontName : { family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync(fontName);
  if (params.fontName) node.fontName = fontName;
  node.characters = params.text;
  return {};
};

handlers.setTextRangeStyle = async function(params) {
  var node = await getNode(params.nodeId);
  var start = params.start;
  var end = params.end;
  var props = params.props;
  // Load all fonts for the range
  var fonts = node.getRangeAllFontNames(start, end);
  for (var i = 0; i < fonts.length; i++) {
    await figma.loadFontAsync(fonts[i]);
  }
  if (props.fontSize) node.setRangeFontSize(start, end, props.fontSize);
  if (props.fontName) {
    var fn = parseFontName(props.fontName);
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

handlers.getTextContent = async function(params) {
  var node = await getNode(params.nodeId);
  var segments = node.getStyledTextSegments([
    'fontSize', 'fontName', 'fills', 'fontWeight',
    'textDecoration', 'textCase', 'letterSpacing', 'lineHeight'
  ]);
  return {
    text: node.characters,
    segments: segments.map(function(s) {
      return {
        start: s.start, end: s.end,
        fontSize: s.fontSize,
        fontName: s.fontName ? s.fontName.family + ' ' + s.fontName.style : undefined,
        fills: s.fills, fontWeight: s.fontWeight,
        textDecoration: s.textDecoration, textCase: s.textCase,
        letterSpacing: s.letterSpacing, lineHeight: s.lineHeight
      };
    })
  };
};

handlers.listFonts = async function(params) {
  var fonts = await figma.listAvailableFontsAsync();
  var families = {};
  var query = params.query ? params.query.toLowerCase() : null;
  for (var i = 0; i < fonts.length; i++) {
    var family = fonts[i].fontName.family;
    // Filter by query if provided
    if (query && family.toLowerCase().indexOf(query) === -1) continue;
    if (!families[family]) families[family] = [];
    families[family].push(fonts[i].fontName.style);
  }
  var result = [];
  var limit = params.limit || (query ? 500 : 50);
  var count = 0;
  for (var fam in families) {
    if (count >= limit) break;
    result.push({ family: fam, styles: families[fam] });
    count++;
  }
  var totalFamilies = Object.keys(families).length;
  return { fonts: result, total: totalFamilies, showing: result.length, query: query || 'none (showing first ' + limit + ')' };
};

// --- Images ---
handlers.placeImage = async function(params) {
  var parent = params.parentId ? await getNode(params.parentId) : figma.currentPage;
  var rect = figma.createRectangle();
  parent.appendChild(rect);

  var imageHash;
  if (params.bytes) {
    var img = figma.createImage(new Uint8Array(params.bytes));
    imageHash = img.hash;
  } else if (params.url) {
    var requestId = 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    var bytesPromise = new Promise(function(resolve, reject) {
      pendingImages.set(requestId, { resolve: resolve, reject: reject });
      setTimeout(function() {
        if (pendingImages.has(requestId)) {
          pendingImages.delete(requestId);
          reject({ code: 'TIMEOUT', message: 'Image fetch timed out' });
        }
      }, 30000);
    });
    figma.ui.postMessage({ type: 'fetchImage', url: params.url, requestId: requestId });
    var bytes = await bytesPromise;
    var img2 = figma.createImage(bytes);
    imageHash = img2.hash;
  } else {
    throw { code: 'INVALID_PARAMS', message: 'placeImage requires url or bytes' };
  }

  var w = params.width || 400;
  var h = params.height || 300;
  rect.resize(w, h);
  if (params.x !== undefined) rect.x = params.x;
  if (params.y !== undefined) rect.y = params.y;
  rect.fills = [{ type: 'IMAGE', imageHash: imageHash, scaleMode: params.scaleMode || 'FILL' }];
  return { nodeId: rect.id };
};

// --- Introspection: Structure ---
handlers.getSlideGrid = async function() {
  if (figma.editorType !== 'slides') {
    throw { code: 'UNSUPPORTED_IN_FIGMA', message: 'getSlideGrid only available in Slides editor' };
  }
  // Find the SLIDE_GRID node — it's the direct child of the current page
  var gridNode = null;
  var children = figma.currentPage.children;
  for (var i = 0; i < children.length; i++) {
    if (children[i].type === 'SLIDE_GRID') {
      gridNode = children[i];
      break;
    }
  }
  if (!gridNode) {
    throw { code: 'NODE_NOT_FOUND', message: 'No SLIDE_GRID found on current page' };
  }
  var rows = [];
  for (var r = 0; r < gridNode.children.length; r++) {
    var row = gridNode.children[r];
    if (row.type !== 'SLIDE_ROW') continue;
    var slides = [];
    for (var s = 0; s < row.children.length; s++) {
      var slide = row.children[s];
      if (slide.type !== 'SLIDE') continue;
      slides.push({ slideId: slide.id, name: slide.name, isSkipped: slide.isSkippedSlide || false });
    }
    rows.push({ rowId: row.id, slides: slides });
  }
  return { rows: rows };
};

function buildNodeTree(node, depth, currentDepth) {
  var result = {
    nodeId: node.id, type: node.type, name: node.name,
    x: node.x, y: node.y, width: node.width, height: node.height,
    visible: node.visible, locked: node.locked
  };
  if (depth !== null && currentDepth >= depth) return result;
  if ('children' in node && node.children) {
    result.children = node.children.map(function(child) {
      return buildNodeTree(child, depth, currentDepth + 1);
    });
  }
  return result;
}

handlers.getNodeTree = async function(params) {
  var node = params.nodeId ? await getNode(params.nodeId) : figma.currentPage;
  var depth = params.depth !== undefined ? params.depth : null;
  return buildNodeTree(node, depth, 0);
};

handlers.findNodes = async function(params) {
  var parent = params.parentId ? await getNode(params.parentId) : figma.currentPage;
  var criteria = params.criteria || {};
  var results = parent.findAll(function(n) {
    if (criteria.type && n.type !== criteria.type) return false;
    if (criteria.name && !n.name.includes(criteria.name)) return false;
    if (criteria.visible !== undefined && n.visible !== criteria.visible) return false;
    if (criteria.locked !== undefined && n.locked !== criteria.locked) return false;
    return true;
  });
  return {
    nodes: results.map(function(n) {
      return { nodeId: n.id, type: n.type, name: n.name, x: n.x, y: n.y, width: n.width, height: n.height };
    })
  };
};

handlers.getSelection = async function() {
  return { nodeIds: figma.currentPage.selection.map(function(n) { return n.id; }) };
};

handlers.setSelection = async function(params) {
  var nodes = [];
  for (var i = 0; i < params.nodeIds.length; i++) {
    nodes.push(await getNode(params.nodeIds[i]));
  }
  figma.currentPage.selection = nodes;
  return {};
};

// --- Introspection: Context ---
handlers.getNodeProperties = async function(params) {
  var node = await getNode(params.nodeId);
  var keys = params.properties || [
    'type', 'name', 'x', 'y', 'width', 'height', 'rotation',
    'fills', 'strokes', 'strokeWeight', 'effects', 'opacity',
    'blendMode', 'cornerRadius', 'visible', 'locked', 'constraints',
    'layoutMode', 'itemSpacing', 'paddingLeft', 'paddingRight',
    'paddingTop', 'paddingBottom'
  ];
  var result = {};
  for (var i = 0; i < keys.length; i++) {
    try {
      var val = node[keys[i]];
      if (val !== undefined && typeof val !== 'function') {
        result[keys[i]] = (val && typeof val === 'object') ? JSON.parse(JSON.stringify(val)) : val;
      }
    } catch (e) { /* skip unsupported props */ }
  }
  return result;
};

handlers.getSlideContext = async function(params) {
  var slide = await getNode(params.slideId);
  var bg = slide.fills ? JSON.parse(JSON.stringify(slide.fills)) : [];
  var elements = [];
  var children = slide.children || [];
  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    var el = {
      nodeId: child.id, type: child.type, name: child.name,
      x: child.x, y: child.y, width: child.width, height: child.height
    };
    if (child.type === 'TEXT') {
      el.text = child.characters;
      if (child.fontSize !== figma.mixed) el.fontSize = child.fontSize;
      if (child.fontName !== figma.mixed) el.fontName = child.fontName.family + ' ' + child.fontName.style;
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
  return { slideId: slide.id, name: slide.name, background: bg, elements: elements };
};

// --- Introspection: Visual ---
handlers.exportNode = async function(params) {
  var node = await getNode(params.nodeId);
  var format = params.format || 'PNG';
  var settings = { format: format };
  if (params.scale) settings.constraint = { type: 'SCALE', value: params.scale };
  if (params.constraint) settings.constraint = params.constraint;
  var bytes = await node.exportAsync(settings);
  return { base64: figma.base64Encode(bytes), width: node.width, height: node.height, format: format };
};

handlers.exportSlide = async function(params) {
  return handlers.exportNode({ nodeId: params.slideId, format: 'PNG', scale: params.scale || 1 });
};

handlers.exportAllSlides = async function(params) {
  if (figma.editorType !== 'slides') {
    throw { code: 'UNSUPPORTED_IN_FIGMA', message: 'exportAllSlides only available in Slides editor' };
  }
  // Find SLIDE_GRID node
  var gridNode = null;
  var pageChildren = figma.currentPage.children;
  for (var i = 0; i < pageChildren.length; i++) {
    if (pageChildren[i].type === 'SLIDE_GRID') { gridNode = pageChildren[i]; break; }
  }
  if (!gridNode) throw { code: 'NODE_NOT_FOUND', message: 'No SLIDE_GRID found' };
  var slides = [];
  var maxSlides = params.maxSlides || 50;
  var count = 0;
  for (var r = 0; r < gridNode.children.length; r++) {
    var row = gridNode.children[r];
    if (row.type !== 'SLIDE_ROW') continue;
    for (var s = 0; s < row.children.length; s++) {
      if (count >= maxSlides) break;
      var slide = row.children[s];
      if (slide.type !== 'SLIDE') continue;
      var bytes = await slide.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: params.scale || 0.5 } });
      slides.push({ slideId: slide.id, name: slide.name, base64: figma.base64Encode(bytes) });
      count++;
    }
  }
  return { slides: slides };
};

// --- Slide Lifecycle ---
handlers.createSlide = async function(params) {
  if (figma.editorType !== 'slides') {
    throw { code: 'UNSUPPORTED_IN_FIGMA', message: 'createSlide only available in Slides editor' };
  }
  var slide = figma.createSlide();
  if (params.fills) slide.fills = expandFills(params.fills);
  // createSlide() auto-places the slide. Find its parent row.
  var rowId = slide.parent ? slide.parent.id : null;
  return { nodeId: slide.id, rowId: rowId };
};

handlers.createSlideRow = async function(params) {
  if (figma.editorType !== 'slides') {
    throw { code: 'UNSUPPORTED_IN_FIGMA', message: 'createSlideRow only available in Slides editor' };
  }
  var row = figma.createSlideRow();
  return { nodeId: row.id };
};

handlers.duplicateSlide = async function(params) {
  var slide = await getNode(params.slideId);
  var clone = slide.clone();
  return { nodeId: clone.id, rowId: clone.parent ? clone.parent.id : null };
};

handlers.deleteSlide = async function(params) {
  var node = await getNode(params.slideId);
  node.remove();
  return {};
};

handlers.deleteSlideRow = async function(params) {
  var node = await getNode(params.rowId);
  node.remove();
  return {};
};

handlers.reorderSlides = async function(params) {
  if (figma.editorType !== 'slides') {
    throw { code: 'UNSUPPORTED_IN_FIGMA', message: 'reorderSlides only available in Slides editor' };
  }
  // Find grid node and reorder rows by re-inserting them
  var gridNode = null;
  var pageChildren = figma.currentPage.children;
  for (var i = 0; i < pageChildren.length; i++) {
    if (pageChildren[i].type === 'SLIDE_GRID') { gridNode = pageChildren[i]; break; }
  }
  if (!gridNode) throw { code: 'NODE_NOT_FOUND', message: 'No SLIDE_GRID found' };
  for (var j = 0; j < params.rowIds.length; j++) {
    var row = await getNode(params.rowIds[j]);
    gridNode.insertChild(j, row);
  }
  return {};
};

handlers.moveSlideToRow = async function(params) {
  var slide = await getNode(params.slideId);
  var row = await getNode(params.rowId);
  if (params.index !== undefined) {
    row.insertChild(params.index, slide);
  } else {
    row.appendChild(slide);
  }
  return {};
};

handlers.setSlideTransition = async function(params) {
  var slide = await getNode(params.slideId);
  slide.setSlideTransition({
    style: params.style || 'NONE',
    duration: params.duration || 0.4,
    curve: params.curve || 'EASE_OUT',
    timing: params.timing || { type: 'ON_CLICK' }
  });
  return {};
};

handlers.setSlideSkipped = async function(params) {
  var slide = await getNode(params.slideId);
  slide.isSkippedSlide = params.isSkipped;
  return {};
};

handlers.setSlideTheme = async function(params) {
  var slide = await getNode(params.slideId);
  slide.themeId = params.themeId;
  return {};
};

handlers.listThemes = async function() {
  return { themes: [] };
};

handlers.focusSlide = async function(params) {
  var slide = await getNode(params.slideId);
  figma.currentPage.focusedSlide = slide;
  return {};
};

handlers.setSlidesViewMode = async function(params) {
  figma.viewport.slidesMode = params.mode;
  return {};
};

// --- Slides-Specific Types ---
handlers.createTable = async function(params) {
  var parent = params.parentId ? await getNode(params.parentId) : figma.currentPage;
  var table = figma.createTable(params.rows, params.cols);
  parent.appendChild(table);
  return { nodeId: table.id };
};

handlers.setCellContent = async function(params) {
  var table = await getNode(params.tableId);
  var cell = table.cellAt(params.row, params.col);
  if (cell.text) {
    var fontName = cell.text.fontName !== figma.mixed ? cell.text.fontName : { family: 'Inter', style: 'Regular' };
    await figma.loadFontAsync(fontName);
    cell.text.characters = params.text;
    if (params.props) applyProps(cell.text, params.props);
  }
  return {};
};

handlers.getCellContent = async function(params) {
  var table = await getNode(params.tableId);
  var cell = table.cellAt(params.row, params.col);
  return {
    text: cell.text ? cell.text.characters : '',
    props: cell.text ? { fontSize: cell.text.fontSize } : {}
  };
};

handlers.insertTableRow = async function(params) {
  var table = await getNode(params.tableId);
  table.insertRow(params.index !== undefined ? params.index : table.numRows);
  return {};
};

handlers.insertTableColumn = async function(params) {
  var table = await getNode(params.tableId);
  table.insertColumn(params.index !== undefined ? params.index : table.numColumns);
  return {};
};

handlers.deleteTableRow = async function(params) {
  var table = await getNode(params.tableId);
  table.removeRow(params.index);
  return {};
};

handlers.deleteTableColumn = async function(params) {
  var table = await getNode(params.tableId);
  table.removeColumn(params.index);
  return {};
};

handlers.createShapeWithText = async function(params) {
  var parent = params.parentId ? await getNode(params.parentId) : figma.currentPage;
  var shape = figma.createShapeWithText();
  if (params.shapeType) shape.shapeType = params.shapeType;
  var fontName = shape.text.fontName !== figma.mixed ? shape.text.fontName : { family: 'Inter', style: 'Regular' };
  await figma.loadFontAsync(fontName);
  shape.text.characters = params.text || '';
  parent.appendChild(shape);
  if (params.props) applyProps(shape, params.props);
  return { nodeId: shape.id };
};

handlers.createGif = async function(params) {
  try {
    var parent = params.parentId ? await getNode(params.parentId) : figma.currentPage;
    var gif = figma.createGif();
    parent.appendChild(gif);
    return { nodeId: gif.id };
  } catch (e) {
    throw { code: 'UNSUPPORTED_IN_SLIDES', message: 'createGif failed: ' + (e.message || e) };
  }
};

handlers.createVideo = async function(params) {
  try {
    var parent = params.parentId ? await getNode(params.parentId) : figma.currentPage;
    var bytes;
    if (params.url) {
      // Fetch video from URL via iframe relay (same pattern as placeImage)
      var requestId = 'vid-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      var bytesPromise = new Promise(function(resolve, reject) {
        pendingImages.set(requestId, { resolve: resolve, reject: reject });
        setTimeout(function() {
          if (pendingImages.has(requestId)) {
            pendingImages.delete(requestId);
            reject({ code: 'TIMEOUT', message: 'Video fetch timed out' });
          }
        }, 60000);
      });
      figma.ui.postMessage({ type: 'fetchImage', url: params.url, requestId: requestId });
      bytes = await bytesPromise;
    } else if (params.data) {
      bytes = new Uint8Array(params.data);
    } else {
      throw { code: 'INVALID_PARAMS', message: 'createVideo requires url or data' };
    }
    var video = await figma.createVideoAsync(bytes);
    // createVideoAsync returns empty {} in Slides — API exists but is non-functional
    if (!video || !video.id) {
      throw { code: 'UNSUPPORTED_IN_SLIDES', message: 'createVideoAsync returned empty object — video creation not supported via plugin API. Add videos manually in Figma UI.' };
    }
    parent.appendChild(video);
    if (params.x !== undefined) video.x = params.x;
    if (params.y !== undefined) video.y = params.y;
    if (params.width && params.height) video.resize(params.width, params.height);
    return { nodeId: video.id, type: video.type };
  } catch (e) {
    throw { code: 'UNSUPPORTED_IN_SLIDES', message: 'createVideo failed: ' + (e.message || e) };
  }
};

handlers.replaceMedia = async function(params) {
  var node = await getNode(params.nodeId);
  try {
    if (typeof node.setVideoAsync === 'function') {
      await node.setVideoAsync(new Uint8Array(params.data));
    } else {
      var img = figma.createImage(new Uint8Array(params.data));
      node.fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FILL' }];
    }
  } catch (e) {
    throw { code: 'INVALID_PARAMS', message: 'replaceMedia failed: ' + (e.message || e) };
  }
  return {};
};

// --- SVG Import ---
handlers.createNodeFromSvg = async function(params) {
  var parent = params.parentId ? await getNode(params.parentId) : figma.currentPage;
  var node = figma.createNodeFromSvg(params.svg);
  parent.appendChild(node);
  if (params.x !== undefined) node.x = params.x;
  if (params.y !== undefined) node.y = params.y;
  if (params.width && params.height) node.resize(params.width, params.height);
  return { nodeId: node.id, type: node.type, name: node.name, width: node.width, height: node.height };
};

handlers.getInteractiveElements = async function(params) {
  var slide = await getNode(params.slideId);
  var elements = [];
  var children = slide.children || [];
  for (var i = 0; i < children.length; i++) {
    if (children[i].type === 'INTERACTIVE_SLIDE_ELEMENT') {
      elements.push({
        nodeId: children[i].id,
        interactiveType: children[i].interactiveType,
        x: children[i].x, y: children[i].y,
        width: children[i].width, height: children[i].height
      });
    }
  }
  return { elements: elements };
};

// --- Viewport ---
handlers.setViewport = async function(params) {
  if (params.center) figma.viewport.center = params.center;
  if (params.zoom) figma.viewport.zoom = params.zoom;
  return {};
};

handlers.zoomToFit = async function(params) {
  if (params.nodeIds && params.nodeIds.length > 0) {
    var nodes = [];
    for (var i = 0; i < params.nodeIds.length; i++) {
      nodes.push(await getNode(params.nodeIds[i]));
    }
    figma.viewport.scrollAndZoomIntoView(nodes);
  } else {
    figma.viewport.scrollAndZoomIntoView(figma.currentPage.children);
  }
  return {};
};

// --- Convenience ---
handlers.clearSlide = async function(params) {
  var slide = await getNode(params.slideId);
  var children = (slide.children || []).slice();
  for (var i = 0; i < children.length; i++) {
    children[i].remove();
  }
  return {};
};

// ============================================================
// Batch execution with $N reference resolution
// ============================================================
async function executeBatch(commands) {
  var results = [];

  // Pre-scan for text commands, pre-load fonts for undo grouping
  for (var i = 0; i < commands.length; i++) {
    var cmd = commands[i];
    if (cmd.cmd === 'setText' && cmd.params && cmd.params.fontName) {
      try {
        await figma.loadFontAsync(parseFontName(cmd.params.fontName));
      } catch (e) { /* will fail again during execution */ }
    }
    if (cmd.cmd === 'createNode' && cmd.params && cmd.params.type === 'TEXT') {
      try {
        await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      } catch (e) { /* best effort */ }
    }
  }

  for (var j = 0; j < commands.length; j++) {
    var command = commands[j];
    // Resolve $N.field references
    var paramsStr = JSON.stringify(command.params || {});
    var resolvedStr = paramsStr.replace(/"\$(\d+)\.(\w+)"/g, function(match, idx, field) {
      var refIdx = parseInt(idx);
      if (refIdx >= results.length || results[refIdx].error) {
        throw { code: 'INVALID_PARAMS', message: 'Reference $' + idx + ' failed or not yet available' };
      }
      return JSON.stringify(results[refIdx].result[field]);
    });
    var resolvedParams = JSON.parse(resolvedStr);

    try {
      var handler = handlers[command.cmd];
      if (!handler) throw { code: 'INVALID_PARAMS', message: 'Unknown command: ' + command.cmd };
      var result = await handler(resolvedParams);
      results.push({ result: result });
    } catch (e) {
      results.push({ error: { code: e.code || 'UNKNOWN', message: e.message || String(e) } });
    }
  }

  try { figma.commitUndo(); } catch (e) { /* best effort */ }
  return results;
}

handlers.batch = async function(params) {
  return executeBatch(params.commands);
};

// ============================================================
// Message dispatcher
// ============================================================
figma.ui.onmessage = async function(msg) {
  // Handle image fetch responses
  if (msg.type === 'imageData') {
    var pending = pendingImages.get(msg.requestId);
    if (pending) {
      pendingImages.delete(msg.requestId);
      pending.resolve(msg.bytes);
    }
    return;
  }
  if (msg.type === 'imageError') {
    var pendingErr = pendingImages.get(msg.requestId);
    if (pendingErr) {
      pendingImages.delete(msg.requestId);
      pendingErr.reject({ code: 'INVALID_PARAMS', message: msg.error });
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
    var id = msg.id;
    var cmd = msg.cmd;
    var params = msg.params;
    try {
      var handler = handlers[cmd];
      if (!handler) {
        throw { code: 'INVALID_PARAMS', message: 'Unknown command: ' + cmd };
      }
      var result = await handler(params || {});
      figma.ui.postMessage({ type: 'response', data: { id: id, result: result } });
    } catch (e) {
      figma.ui.postMessage({
        type: 'response',
        data: { id: id, error: { code: e.code || 'UNKNOWN', message: e.message || String(e) } }
      });
    }
  }
};
