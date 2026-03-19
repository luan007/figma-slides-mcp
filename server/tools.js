import { z } from 'zod';

function toolResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
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
    description: 'Get a rich semantic dump of everything on a slide: text content, shapes, images, positions, styles. Best for understanding what is on a slide before editing.',
    inputSchema: z.object({
      slideId: z.string().describe('The ID of the slide to inspect')
    })
  }, async ({ slideId }) => {
    const result = await bridge.send('getSlideContext', { slideId });
    return toolResult(result);
  });

  server.registerTool('screenshot_slide', {
    title: 'Screenshot Slide',
    description: 'Capture a visual screenshot of a slide as PNG. Returns base64-encoded image.',
    inputSchema: z.object({
      slideId: z.string().describe('The ID of the slide to screenshot'),
      scale: z.number().optional().describe('Export scale (1 = 1920x1080, 2 = 3840x2160). Default: 1')
    })
  }, async ({ slideId, scale }) => {
    const result = await bridge.send('exportSlide', { slideId, scale }, { timeout: 30000 });
    return { content: [{ type: 'image', data: result.base64, mimeType: 'image/png' }] };
  });

  server.registerTool('screenshot_all_slides', {
    title: 'Screenshot All Slides',
    description: 'Capture thumbnails of all slides. Returns array of base64 PNG images.',
    inputSchema: z.object({
      scale: z.number().optional().describe('Export scale. Default: 0.5 (960x540 thumbnails)'),
      maxSlides: z.number().optional().describe('Max slides to export. Default: 50')
    })
  }, async ({ scale, maxSlides }) => {
    const result = await bridge.send('exportAllSlides', { scale, maxSlides }, { timeout: 60000 });
    return { content: result.slides.map(s => ({ type: 'image', data: s.base64, mimeType: 'image/png' })) };
  });

  server.registerTool('create_slide', {
    title: 'Create Slide',
    description: 'Create a new empty slide (fixed 1920x1080).',
    inputSchema: z.object({
      rowIndex: z.number().optional().describe('Row index to add slide to. Default: last row.'),
      fills: z.any().optional().describe('Background fill. Hex "#ff0000" or Figma Paint array.'),
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
      slideId: z.string().describe('The slide to clear')
    })
  }, async ({ slideId }) => {
    const result = await bridge.send('clearSlide', { slideId });
    return toolResult(result);
  });

  // ============================
  // Tier 2: Node CRUD
  // ============================

  server.registerTool('create_node', {
    title: 'Create Node',
    description: 'Create a node (FRAME, RECTANGLE, ELLIPSE, POLYGON, STAR, LINE, VECTOR, TEXT) with optional properties. For tables, shapes-with-text, etc., use dedicated tools.',
    inputSchema: z.object({
      type: z.enum(['FRAME', 'RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'LINE', 'VECTOR', 'TEXT']).describe('Node type'),
      parentId: z.string().describe('Parent node ID (typically the slide ID)'),
      props: z.record(z.any()).optional().describe('Properties: x, y, width, height, fills ("#ff0000" or Paint array), strokes, rotation, opacity, cornerRadius, etc.')
    })
  }, async (params) => {
    const result = await bridge.send('createNode', params);
    return toolResult(result);
  });

  server.registerTool('set_properties', {
    title: 'Set Properties',
    description: 'Modify properties of any node. Supports x, y, width, height, rotation, fills, strokes, strokeWeight, effects, opacity, blendMode, cornerRadius, visible, locked, layoutMode, itemSpacing, padding.',
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
    inputSchema: z.object({ nodeId: z.string().describe('Node ID to delete') })
  }, async ({ nodeId }) => {
    const result = await bridge.send('deleteNode', { nodeId });
    return toolResult(result);
  });

  server.registerTool('clone_node', {
    title: 'Clone Node',
    description: 'Duplicate a node, optionally reparenting the clone.',
    inputSchema: z.object({
      nodeId: z.string().describe('Node to clone'),
      parentId: z.string().optional().describe('Parent for clone. Default: same parent.')
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
    description: 'Ungroup a group node, returning children to parent',
    inputSchema: z.object({ nodeId: z.string().describe('Group node to ungroup') })
  }, async ({ nodeId }) => {
    const result = await bridge.send('ungroupNode', { nodeId });
    return toolResult(result);
  });

  // ============================
  // Tier 2: Text
  // ============================

  server.registerTool('set_text', {
    title: 'Set Text',
    description: 'Set text content of a text node. Font loading is automatic.',
    inputSchema: z.object({
      nodeId: z.string().describe('Text node ID'),
      text: z.string().describe('New text content'),
      fontName: z.string().optional().describe('Font, e.g. "Inter Bold", "Roboto Regular"')
    })
  }, async (params) => {
    const result = await bridge.send('setText', params);
    return toolResult(result);
  });

  server.registerTool('set_text_range_style', {
    title: 'Set Text Range Style',
    description: 'Apply styles to a character range: fontSize, fontName, fills, letterSpacing, lineHeight, textDecoration, textCase',
    inputSchema: z.object({
      nodeId: z.string().describe('Text node ID'),
      start: z.number().describe('Start index (0-based)'),
      end: z.number().describe('End index (exclusive)'),
      props: z.record(z.any()).describe('Style props')
    })
  }, async (params) => {
    const result = await bridge.send('setTextRangeStyle', params);
    return toolResult(result);
  });

  server.registerTool('get_text_content', {
    title: 'Get Text Content',
    description: 'Read text content and style segments from a text node',
    inputSchema: z.object({ nodeId: z.string().describe('Text node ID') })
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
  // Tier 2: Images
  // ============================

  server.registerTool('place_image', {
    title: 'Place Image',
    description: 'Place an image from URL or bytes. Creates a rectangle with IMAGE fill.',
    inputSchema: z.object({
      parentId: z.string().describe('Parent node ID'),
      url: z.string().optional().describe('Image URL to fetch'),
      bytes: z.array(z.number()).optional().describe('Raw image bytes'),
      x: z.number().optional(), y: z.number().optional(),
      width: z.number().optional().describe('Default: 400'),
      height: z.number().optional().describe('Default: 300'),
      scaleMode: z.enum(['FILL', 'FIT', 'CROP', 'TILE']).optional().describe('Default: FILL')
    })
  }, async (params) => {
    const result = await bridge.send('placeImage', params, { timeout: 30000 });
    return toolResult(result);
  });

  // ============================
  // Tier 2: Slide Lifecycle
  // ============================

  server.registerTool('create_slide_row', {
    title: 'Create Slide Row',
    description: 'Create a new slide row in the deck grid',
    inputSchema: z.object({ index: z.number().optional().describe('Position in grid') })
  }, async (params) => {
    const result = await bridge.send('createSlideRow', params);
    return toolResult(result);
  });

  server.registerTool('duplicate_slide', {
    title: 'Duplicate Slide',
    description: 'Clone a slide with all content',
    inputSchema: z.object({ slideId: z.string().describe('Slide to duplicate') })
  }, async ({ slideId }) => {
    const result = await bridge.send('duplicateSlide', { slideId });
    return toolResult(result);
  });

  server.registerTool('delete_slide', {
    title: 'Delete Slide',
    description: 'Remove a slide from the deck',
    inputSchema: z.object({ slideId: z.string().describe('Slide to delete') })
  }, async ({ slideId }) => {
    const result = await bridge.send('deleteSlide', { slideId });
    return toolResult(result);
  });

  server.registerTool('delete_slide_row', {
    title: 'Delete Slide Row',
    description: 'Remove a slide row and all slides in it',
    inputSchema: z.object({ rowId: z.string().describe('Row to delete') })
  }, async ({ rowId }) => {
    const result = await bridge.send('deleteSlideRow', { rowId });
    return toolResult(result);
  });

  server.registerTool('reorder_slides', {
    title: 'Reorder Slides',
    description: 'Set the order of slide rows in the deck',
    inputSchema: z.object({ rowIds: z.array(z.string()).describe('Row IDs in desired order') })
  }, async ({ rowIds }) => {
    const result = await bridge.send('reorderSlides', { rowIds });
    return toolResult(result);
  });

  server.registerTool('move_slide_to_row', {
    title: 'Move Slide to Row',
    description: 'Move a slide to a different row',
    inputSchema: z.object({
      slideId: z.string(), rowId: z.string(),
      index: z.number().optional().describe('Position within row')
    })
  }, async (params) => {
    const result = await bridge.send('moveSlideToRow', params);
    return toolResult(result);
  });

  server.registerTool('set_slide_transition', {
    title: 'Set Slide Transition',
    description: 'Set transition: DISSOLVE, SLIDE_FROM_LEFT/RIGHT/TOP/BOTTOM, PUSH_FROM_*, SMART_ANIMATE, NONE',
    inputSchema: z.object({
      slideId: z.string(), style: z.string().describe('Transition style'),
      duration: z.number().optional().describe('Seconds. Default: 0.4'),
      curve: z.string().optional().describe('Easing. Default: EASE_OUT'),
      timing: z.record(z.any()).optional().describe('Default: { type: "ON_CLICK" }')
    })
  }, async (params) => {
    const result = await bridge.send('setSlideTransition', params);
    return toolResult(result);
  });

  server.registerTool('set_slide_skipped', {
    title: 'Set Slide Skipped',
    description: 'Mark slide as skipped in presentation',
    inputSchema: z.object({ slideId: z.string(), isSkipped: z.boolean() })
  }, async (params) => {
    const result = await bridge.send('setSlideSkipped', params);
    return toolResult(result);
  });

  server.registerTool('set_slide_theme', {
    title: 'Set Slide Theme',
    description: 'Apply a theme to a slide',
    inputSchema: z.object({ slideId: z.string(), themeId: z.string() })
  }, async (params) => {
    const result = await bridge.send('setSlideTheme', params);
    return toolResult(result);
  });

  server.registerTool('focus_slide', {
    title: 'Focus Slide',
    description: 'Navigate to a specific slide in the editor',
    inputSchema: z.object({ slideId: z.string() })
  }, async ({ slideId }) => {
    const result = await bridge.send('focusSlide', { slideId });
    return toolResult(result);
  });

  server.registerTool('set_slides_view_mode', {
    title: 'Set Slides View Mode',
    description: 'Switch between grid and single-slide view',
    inputSchema: z.object({ mode: z.enum(['grid', 'single-slide']).describe('View mode') })
  }, async ({ mode }) => {
    const result = await bridge.send('setSlidesViewMode', { mode });
    return toolResult(result);
  });

  // ============================
  // Tier 2: Tables
  // ============================

  server.registerTool('create_table', {
    title: 'Create Table',
    description: 'Create a table (Slides/FigJam only)',
    inputSchema: z.object({
      parentId: z.string(), rows: z.number(), cols: z.number(),
      cellWidth: z.number().optional(), cellHeight: z.number().optional()
    })
  }, async (params) => {
    const result = await bridge.send('createTable', params);
    return toolResult(result);
  });

  server.registerTool('set_cell_content', {
    title: 'Set Cell Content',
    description: 'Set text of a table cell',
    inputSchema: z.object({
      tableId: z.string(), row: z.number(), col: z.number(),
      text: z.string(), props: z.record(z.any()).optional()
    })
  }, async (params) => {
    const result = await bridge.send('setCellContent', params);
    return toolResult(result);
  });

  server.registerTool('get_cell_content', {
    title: 'Get Cell Content',
    description: 'Read text of a table cell',
    inputSchema: z.object({ tableId: z.string(), row: z.number(), col: z.number() })
  }, async (params) => {
    const result = await bridge.send('getCellContent', params);
    return toolResult(result);
  });

  server.registerTool('insert_table_row', {
    title: 'Insert Table Row',
    inputSchema: z.object({ tableId: z.string(), index: z.number().optional() }),
    description: 'Insert a row into a table'
  }, async (params) => {
    const result = await bridge.send('insertTableRow', params);
    return toolResult(result);
  });

  server.registerTool('insert_table_column', {
    title: 'Insert Table Column',
    inputSchema: z.object({ tableId: z.string(), index: z.number().optional() }),
    description: 'Insert a column into a table'
  }, async (params) => {
    const result = await bridge.send('insertTableColumn', params);
    return toolResult(result);
  });

  server.registerTool('delete_table_row', {
    title: 'Delete Table Row',
    inputSchema: z.object({ tableId: z.string(), index: z.number() }),
    description: 'Remove a row from a table'
  }, async (params) => {
    const result = await bridge.send('deleteTableRow', params);
    return toolResult(result);
  });

  server.registerTool('delete_table_column', {
    title: 'Delete Table Column',
    inputSchema: z.object({ tableId: z.string(), index: z.number() }),
    description: 'Remove a column from a table'
  }, async (params) => {
    const result = await bridge.send('deleteTableColumn', params);
    return toolResult(result);
  });

  // ============================
  // Tier 2: Media
  // ============================

  server.registerTool('create_shape_with_text', {
    title: 'Create Shape With Text',
    description: 'Create a shape with built-in text label (Slides/FigJam). shapeType: SQUARE, ELLIPSE, ROUNDED_RECTANGLE, DIAMOND, TRIANGLE_UP, etc.',
    inputSchema: z.object({
      parentId: z.string(), text: z.string(),
      shapeType: z.string().optional(), props: z.record(z.any()).optional()
    })
  }, async (params) => {
    const result = await bridge.send('createShapeWithText', params);
    return toolResult(result);
  });

  server.registerTool('create_gif', {
    title: 'Create GIF',
    description: 'Create a GIF node (Slides only, may have limited support)',
    inputSchema: z.object({
      parentId: z.string(), data: z.array(z.number()).optional()
    })
  }, async (params) => {
    const result = await bridge.send('createGif', params);
    return toolResult(result);
  });

  server.registerTool('create_video', {
    title: 'Create Video',
    description: 'Create a video node from URL or bytes (Slides only, MP4/MOV/WebM)',
    inputSchema: z.object({
      parentId: z.string(),
      url: z.string().optional().describe('Video URL to fetch (MP4/MOV/WebM)'),
      data: z.array(z.number()).optional().describe('Raw video bytes'),
      x: z.number().optional(), y: z.number().optional(),
      width: z.number().optional(), height: z.number().optional()
    })
  }, async (params) => {
    const result = await bridge.send('createVideo', params, { timeout: 60000 });
    return toolResult(result);
  });

  server.registerTool('replace_media', {
    title: 'Replace Media',
    description: 'Replace media content of a video/image node',
    inputSchema: z.object({ nodeId: z.string(), data: z.array(z.number()) })
  }, async (params) => {
    const result = await bridge.send('replaceMedia', params);
    return toolResult(result);
  });

  // ============================
  // Tier 3: Introspection
  // ============================

  server.registerTool('get_node_tree', {
    title: 'Get Node Tree',
    description: 'Get structural tree: IDs, types, names, bounds. Use depth to limit recursion.',
    inputSchema: z.object({
      nodeId: z.string().optional().describe('Root node. Default: current page.'),
      depth: z.number().optional().describe('Max depth. null = unlimited.')
    })
  }, async (params) => {
    const result = await bridge.send('getNodeTree', params);
    return toolResult(result);
  });

  server.registerTool('get_node_properties', {
    title: 'Get Node Properties',
    description: 'Read all or specific properties of a node',
    inputSchema: z.object({
      nodeId: z.string(),
      properties: z.array(z.string()).optional().describe('Specific props. Default: all common.')
    })
  }, async (params) => {
    const result = await bridge.send('getNodeProperties', params);
    return toolResult(result);
  });

  server.registerTool('find_nodes', {
    title: 'Find Nodes',
    description: 'Search for nodes by name (substring), type, visible, locked. All criteria AND-combined.',
    inputSchema: z.object({
      parentId: z.string().optional(),
      criteria: z.object({
        name: z.string().optional(), type: z.string().optional(),
        visible: z.boolean().optional(), locked: z.boolean().optional()
      })
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
    description: 'Select specific nodes',
    inputSchema: z.object({ nodeIds: z.array(z.string()) })
  }, async ({ nodeIds }) => {
    const result = await bridge.send('setSelection', { nodeIds });
    return toolResult(result);
  });

  server.registerTool('get_interactive_elements', {
    title: 'Get Interactive Elements',
    description: 'List interactive elements on a slide (polls, embeds). Read-only.',
    inputSchema: z.object({ slideId: z.string() })
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
      nodeId: z.string(),
      format: z.enum(['PNG', 'JPG', 'SVG', 'PDF']).optional().describe('Default: PNG'),
      scale: z.number().optional().describe('Scale factor. Default: 1')
    })
  }, async (params) => {
    const result = await bridge.send('exportNode', params, { timeout: 30000 });
    if (params.format === 'SVG') {
      return { content: [{ type: 'text', text: result.base64 }] };
    }
    const mimeMap = { PNG: 'image/png', JPG: 'image/jpeg', PDF: 'application/pdf' };
    return { content: [{ type: 'image', data: result.base64, mimeType: mimeMap[params.format || 'PNG'] }] };
  });

  // ============================
  // Tier 2: Viewport
  // ============================

  server.registerTool('set_viewport', {
    title: 'Set Viewport',
    description: 'Set editor viewport center and zoom',
    inputSchema: z.object({
      center: z.object({ x: z.number(), y: z.number() }).optional(),
      zoom: z.number().optional()
    })
  }, async (params) => {
    const result = await bridge.send('setViewport', params);
    return toolResult(result);
  });

  server.registerTool('zoom_to_fit', {
    title: 'Zoom to Fit',
    description: 'Zoom to fit specific nodes or all content',
    inputSchema: z.object({ nodeIds: z.array(z.string()).optional() })
  }, async (params) => {
    const result = await bridge.send('zoomToFit', params);
    return toolResult(result);
  });

  // ============================
  // Tier 4: Batch
  // ============================

  server.registerTool('batch_operations', {
    title: 'Batch Operations',
    description: 'Execute multiple commands in one round-trip. Use "$N.field" to reference results from earlier commands (e.g. "$0.nodeId"). All execute as single undo step.',
    inputSchema: z.object({
      commands: z.array(z.object({
        cmd: z.string().describe('Command name'),
        params: z.record(z.any()).optional().describe('Params. "$N.field" references result of command N.')
      }))
    })
  }, async ({ commands }) => {
    const result = await bridge.send('batch', { commands }, { timeout: 30000 });
    return toolResult(result);
  });
}
