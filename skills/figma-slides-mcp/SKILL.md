---
name: figma-slides-mcp
description: Use when creating or editing Figma Slides via the figma-slides MCP server. Covers the verify-after-every-block workflow, batch sizing, text handling, coordinate planning, graphics renderers (D3, Satori, Rough.js), slide design theory, and visual design patterns. Use this skill whenever the user mentions "figma slides", "presentation", "slide deck", "make slides", or wants to create/edit slides programmatically via MCP tools.
---

# Figma Slides MCP

## I. Design Philosophy — The Non-Negotiables

You are a slide designer, not a text renderer. Every slide should look like a human designer made it.

### Think in Layers, Build in Modules

Never generate a page in one shot. Decompose every slide into visual layers:

```
Layer 1: Background (color, gradient glow, subtle texture)
Layer 2: Structure (cards, panels, dividers, regions)
Layer 3: Graphics (charts, diagrams, icons, images)
Layer 4: Typography (headings, body, labels, accents)
Layer 5: Polish (alignment fixes, spacing tweaks, accent details)
```

Build each layer, screenshot, verify, then add the next. This is how designers work — and it's how you avoid spending 20 tool calls on something that's fundamentally misaligned.

### Visual > Verbal

| Bad | Good |
|-----|------|
| Bullet points listing features | Card grid with icons + short labels |
| Table of numbers | Bar chart or donut chart |
| Process described in paragraph | Flow diagram with arrows |
| "We have 4 pillars" | 4 visual columns with icons |
| Wall of text | Pull quote + supporting visual |

If information can be a chart, diagram, flow, or image — make it one. Words are the fallback, not the default.

### Restraint is Design

- **1-2 accent colors max.** One accent for emphasis, one for secondary. Everything else is grayscale.
- **Negative space is not wasted space.** A slide with breathing room looks professional. A crammed slide looks amateur.
- **One idea per slide.** If you have 3 points, consider 3 slides.
- **Repetition is the enemy.** If slide 5 looks like slide 4 looks like slide 3, you've failed. Vary layouts: left-right, centered, full-bleed, grid, asymmetric.

### Typography is Design

Font size ratios, letter spacing, and line height are not afterthoughts — they ARE the design.

| Role | Size | Weight | Spacing | Font |
|------|------|--------|---------|------|
| Section label | 11-13px | Regular | +15-20% tracking | Monospace |
| Main heading | 44-64px | Regular/400 | -2% to -3% tracking | Serif |
| Subheading | 22-32px | SemiBold | -1% tracking | Sans |
| Body text | 15-18px | Regular | 0% | Sans |
| Caption/meta | 12-14px | Regular | +5% tracking | Mono or Sans |
| Accent number | 36-72px | Regular | -2% tracking | Serif |

Always set `lineHeight` (150-180% for body, 100-120% for headings) and `letterSpacing`. Default Figma values look generic.


## II. Session Setup

### Starting

```
start_session          → binds WebSocket, returns connection status
get_slide_grid         → see existing deck structure
screenshot_slide(id)   → SEE what exists before touching anything
list_fonts(query: "X") → check exact font names (ALWAYS use query param)
get_slide_context(id)  → read fonts, colors, spacing from existing slides
```

Three outcomes from `start_session`:
- **Port free**: "WebSocket running on 3055. Open Figma and run the plugin."
- **Port taken**: "Port 3055 in use. Set FIGMA_WS_PORT or close other instance."
- **Already connected**: "Connected to [document] (slides)"

### Before Creating Anything

If the deck already has slides, inspect 2-3 with `get_slide_context` + `screenshot_slide` to learn the existing design language. Match it — don't impose your own.


## III. The Build Loop

```
PLAN → CREATE MODULE → SCREENSHOT → ASSESS → FIX → SCREENSHOT → NEXT MODULE
```

This loop is **mandatory**. You will get coordinates wrong, text will overlap, sizing will be off — that's expected. The discipline is catching it immediately, not after 5 slides.

### When to Screenshot

| Event | Screenshot? | Scale |
|-------|------------|-------|
| After creating a new slide background | Yes | 1 |
| After adding a text group (label + title) | Yes | 1 |
| After a D3/SVG render | Yes — these often need tweaks | 1 |
| After placing an image | Yes | 1 |
| After a simple property fix (color, position) | Only if unsure | 1 |
| After completing a full slide | Yes — final check | 1 |
| Similar slide to one you just verified | Can skip intermediate screenshots | - |

**Context management**: `screenshot_slide` at scale:1 returns a 1920x1080 image. Use scale:1 for verification (not scale:2). For overview of many slides, use `screenshot_all_slides` with scale:0.5.

### Coordinate Planning

Slides are **1920 x 1080**. Plan your layout grid BEFORE placing anything:

| Region | Y Range | Usage |
|--------|---------|-------|
| Top label | 50-70 | Section name, mono, accent |
| Title | 85-170 | Main heading, large serif |
| Subtitle area | 170-220 | Supporting text, dividers |
| Content zone | 230-750 | Cards, charts, images, text |
| Footer tagline | 780-830 | Pull quotes, summary lines |
| Brand footer | 1000-1060 | Logo, attribution |

**Common column layouts:**

| Layout | Columns | X positions | Width each |
|--------|---------|-------------|------------|
| Full width | 1 | x=115 | ~1690 |
| Two columns | 2 | x=115, x=1000 | ~800, ~800 |
| Three columns | 3 | x=115, x=670, x=1225 | ~520 each |
| Four columns | 4 | x=115, x=540, x=965, x=1390 | ~400 each |
| Left heavy | 2 | x=115 (w=780), x=1000 (w=800) | asymmetric |


## IV. Building Blocks — Choosing Your Tool

The most important decision on every slide: **use native Figma nodes or a renderer?**

```
Is it text + simple shapes (rects, lines, circles)?
  → YES → Use batch_operations with create_node + setText + setTextRangeStyle
  → NO ↓

Is it a data visualization (chart, graph, diagram with data binding)?
  → YES → Use render_d3
  → NO ↓

Is it a hand-drawn / sketchy aesthetic?
  → YES → Use render_rough
  → NO ↓

Is it a complex layout that REQUIRES CSS flexbox?
  → YES → Use render_satori (last resort — text becomes non-editable paths)
  → NO → Use create_svg for simple vector graphics
```

### When to Use Native Nodes (PREFERRED for most slide content)

Native nodes give you **editable text**, **individual element control**, and **no renderer overhead**. Use them for:

- Headings, labels, body text
- Background rectangles, cards, panels
- Divider lines
- Simple geometric decorations
- Any layout where you can calculate coordinates

**Pattern: Card with label + title + body**
```
batch_operations: [
  // Card background (create FIRST — z-order)
  { cmd: "createNode", params: { type: "RECTANGLE", parentId: slideId, props: { x: 115, y: 200, width: 780, height: 300, fills: "rgba(255,255,255,0.02)", strokes: [...], strokeWeight: 1, cornerRadius: 0 }}},
  // Label text
  { cmd: "createNode", params: { type: "TEXT", parentId: slideId, props: { x: 140, y: 220, width: 730 }}},
  { cmd: "setText", params: { nodeId: "$1.nodeId", text: "CATEGORY", fontName: "Space Mono Regular" }},
  // Title text
  { cmd: "createNode", params: { type: "TEXT", parentId: slideId, props: { x: 140, y: 255, width: 730 }}},
  { cmd: "setText", params: { nodeId: "$3.nodeId", text: "Card Title Here", fontName: "DM Sans SemiBold" }},
]
// → then getTextContent for lengths → then setTextRangeStyle
```

### When to Use D3 (data-driven graphics)

D3 shines when you have **data arrays** to render — tables, charts, positioned lists, flow diagrams. See Section VI for comprehensive D3 guidance.

### When to Use place_image (photos, external graphics)

For photographs, illustrations, and external assets. Supports URL fetching.

### Icons — How to Actually Use Them

Fetch SVG icons from CDN and place them with `create_svg` or `place_image`:

```
place_image → parentId, url: "https://unpkg.com/lucide-static/icons/flask-conical.svg", x, y, width: 20, height: 20
```

**Icon sources:**

| Source | URL Pattern | Notes |
|--------|-------------|-------|
| Lucide | `https://unpkg.com/lucide-static/icons/{name}.svg` | 1400+ icons, confirmed working |
| Simple Icons (brands) | `https://cdn.simpleicons.org/{brand}/{color}` | Google, Anthropic, etc. |
| Tabler | `https://unpkg.com/@tabler/icons/icons/outline/{name}.svg` | 4000+ icons |
| Feather | `https://unpkg.com/feather-icons/dist/icons/{name}.svg` | Lucide predecessor |
| Heroicons | `https://unpkg.com/heroicons/24/outline/{name}.svg` | Tailwind team |
| Phosphor | `https://unpkg.com/@phosphor-icons/core/assets/regular/{name}.svg` | 6 weights |

Icons placed via `place_image` render as image fills. For recolorable vector icons, fetch the SVG content and use `create_svg`.

### Images

| Source | URL Pattern | Notes |
|--------|-------------|-------|
| Lorem Picsum | `https://picsum.photos/{w}/{h}` | Random photo placeholder |
| Picsum by ID | `https://picsum.photos/id/{id}/{w}/{h}` | Specific image |
| Picsum filtered | `https://picsum.photos/{w}/{h}?grayscale&blur=2` | Built-in effects |
| Unsplash | `https://images.unsplash.com/photo-{id}?w={w}&fit=crop` | Direct links work |
| Placeholder | `https://placehold.co/{w}x{h}/{bg}/{text}` | Solid color blocks |

Use `place_image` with `scaleMode: "FILL"` or `"FIT"`. Apply Figma native effects (blur, opacity) via `set_properties` after placing.


## V. Text Mastery

Text is the #1 source of errors. Follow this pattern religiously.

### The Three-Step Dance

```
Step 1: createNode (type: TEXT, with x, y, width)
Step 2: setText (nodeId, text, fontName)   ← sets content + loads font
Step 3: getTextContent (nodeId)            ← READ the actual character count
Step 4: setTextRangeStyle (nodeId, 0, actualLength, props)  ← style with REAL length
```

**Never guess character counts.** Unicode characters (→, ×, ·, —), emoji, and CJK characters may differ from what you expect. Always read first.

### Font Names Must Be Exact

Wrong: `"Inter Semi Bold"` → Right: `"Inter SemiBold"`

Always use `list_fonts(query: "Inter")` to verify. The format is `"Family Style"` — e.g., `"DM Sans SemiBold"`, `"Space Mono Regular"`, `"Instrument Serif Italic"`.

### Text Width Controls Line Wrapping

| Width set? | Behavior |
|-----------|----------|
| No width | Auto-width, single line, may overflow slide |
| Width set | Text wraps within the width box |

For any text that might be multi-line, ALWAYS set `width` in createNode props.

### Text Alignment

Text alignment is a **node property**, not a range style:

```
set_properties(nodeId, { textAlignHorizontal: "CENTER" })  // LEFT, CENTER, RIGHT
```

This is separate from `setTextRangeStyle` which handles fontSize, fills, fontName, letterSpacing, lineHeight.

### Efficient Multi-Style Text

For text with mixed styles (e.g., "Design **Principles**" where one word is accent):

1. Set the full text with one `setText` call
2. `getTextContent` → read actual length
3. Calculate substring positions from the actual text
4. Apply `setTextRangeStyle` to each range

Common pattern — title with accent word:
```
"The Void in Physical UX"
 ^^^^                       0-4   → white
     ^^^^                   4-8   → accent orange
         ^^^^^^^^^^^^^^^    8-23  → white
```


## VI. D3 Mastery — The Graphics Powerhouse

D3 is your primary renderer for anything beyond simple shapes. In this context, D3 is not about interactive web viz — it's a **precise SVG layout engine** that produces editable Figma nodes.

### How It Works

```js
// Your script runs in a plugin iframe with:
// - d3 (full D3 v7)
// - scratch (offscreen div to render into)

var svg = d3.select(scratch).append('svg')
  .attr('width', 800).attr('height', 400);

// Build your SVG with d3...
// The SVG is auto-extracted and converted to editable Figma nodes
// Text elements become REAL Figma text nodes (editable!)
```

### Core Patterns

**Pattern 1: Data Table**
```js
var data = [
  {col1: 'Input', col2: 'Keyboard', col3: 'No keyboard'},
  {col1: 'Duration', col2: 'Long sessions', col3: 'Seconds only'}
];
var headers = ['DIMENSION', 'CURRENT', 'PHYSICAL'];
var colX = [0, 250, 530]; // column positions
var rowH = 50;

// Headers
headers.forEach(function(h, i) {
  svg.append('text').attr('x', colX[i] + 20).attr('y', 30)
    .attr('fill', '#666').attr('font-size', 11)
    .attr('font-family', 'Space Mono').text(h);
});

// Rows
data.forEach(function(d, i) {
  var y = 50 + i * rowH;
  svg.append('text').attr('x', colX[0] + 20).attr('y', y + 30)
    .attr('fill', '#999').attr('font-size', 15).attr('font-family', 'DM Sans').text(d.col1);
  svg.append('text').attr('x', colX[1] + 20).attr('y', y + 30)
    .attr('fill', '#666').attr('font-size', 15).text(d.col2);
  svg.append('text').attr('x', colX[2] + 20).attr('y', y + 30)
    .attr('fill', '#ff4d00').attr('font-size', 15).text(d.col3);
  // Row divider
  svg.append('line').attr('x1', 0).attr('y1', y + rowH)
    .attr('x2', 800).attr('y2', y + rowH)
    .attr('stroke', 'rgba(255,255,255,0.06)');
});
```

**Pattern 2: Flow Diagram**
```js
var nodes = ['Context', 'Reasoning', 'Decision', 'Output'];
var nodeW = 180, nodeH = 50, gap = 60;

nodes.forEach(function(label, i) {
  var x = i * (nodeW + gap);
  svg.append('rect').attr('x', x).attr('y', 20)
    .attr('width', nodeW).attr('height', nodeH)
    .attr('fill', 'rgba(255,255,255,0.03)')
    .attr('stroke', 'rgba(255,255,255,0.1)');
  svg.append('text').attr('x', x + nodeW/2).attr('y', 50)
    .attr('text-anchor', 'middle')
    .attr('fill', '#fafafa').attr('font-size', 15).text(label);
  // Arrow between nodes
  if (i < nodes.length - 1) {
    svg.append('text').attr('x', x + nodeW + gap/2).attr('y', 50)
      .attr('text-anchor', 'middle')
      .attr('fill', '#666').attr('font-size', 18).text('\u2192');
  }
});
```

**Pattern 3: Comparison Columns**
```js
var colW = 400, gap = 30;
// Left column (dim)
svg.append('rect').attr('x', 0).attr('y', 0)
  .attr('width', colW).attr('height', 300)
  .attr('fill', 'rgba(255,255,255,0.02)')
  .attr('stroke', 'rgba(255,255,255,0.05)');

// Right column (highlighted)
svg.append('rect').attr('x', colW + gap).attr('y', 0)
  .attr('width', colW).attr('height', 300)
  .attr('fill', 'rgba(255,77,0,0.04)')
  .attr('stroke', 'rgba(255,77,0,0.25)');
// Top accent bar
svg.append('rect').attr('x', colW + gap).attr('y', 0)
  .attr('width', colW).attr('height', 2)
  .attr('fill', '#ff4d00');
```

**Pattern 4: Bar Chart**
```js
var data = [{label: 'Q1', value: 45}, {label: 'Q2', value: 72}, {label: 'Q3', value: 58}];
var barW = 60, gap = 30, maxH = 200;
var maxVal = d3.max(data, function(d) { return d.value; });

data.forEach(function(d, i) {
  var x = 50 + i * (barW + gap);
  var h = (d.value / maxVal) * maxH;
  svg.append('rect').attr('x', x).attr('y', 250 - h)
    .attr('width', barW).attr('height', h)
    .attr('fill', '#ff4d00').attr('rx', 2);
  svg.append('text').attr('x', x + barW/2).attr('y', 275)
    .attr('text-anchor', 'middle')
    .attr('fill', '#666').attr('font-size', 12).text(d.label);
  svg.append('text').attr('x', x + barW/2).attr('y', 245 - h)
    .attr('text-anchor', 'middle')
    .attr('fill', '#ff4d00').attr('font-size', 14).text(d.value);
});
```

**Pattern 5: Gantt / Timeline**
```js
var rows = [
  {label: 'Build', cells: [{text: 'Design', type: 'milestone'}, {text: 'Build', type: 'active'}, {text: 'Deploy', type: 'active'}, null, null, null]},
  {label: 'Academic', cells: [{text: 'Research', type: 'active'}, {text: 'Collect', type: 'active'}, {text: 'arXiv', type: 'milestone'}, {text: 'Submit', type: 'active'}, {text: 'Review', type: 'active'}, {text: 'Conf', type: 'milestone'}]}
];
var cellW = 120, cellH = 40, labelW = 130, rowH = 50;

rows.forEach(function(row, ri) {
  var y = ri * rowH;
  svg.append('text').attr('x', labelW - 10).attr('y', y + 28)
    .attr('text-anchor', 'end').attr('fill', '#ff4d00')
    .attr('font-size', 13).text(row.label);
  row.cells.forEach(function(cell, ci) {
    if (!cell) return;
    var x = labelW + ci * (cellW + 3);
    var fill = cell.type === 'milestone' ? '#ff4d00' : 'rgba(255,77,0,0.2)';
    var textFill = cell.type === 'milestone' ? '#fff' : '#999';
    svg.append('rect').attr('x', x).attr('y', y + 5)
      .attr('width', cellW).attr('height', cellH - 5).attr('fill', fill);
    svg.append('text').attr('x', x + cellW/2).attr('y', y + 30)
      .attr('text-anchor', 'middle').attr('fill', textFill)
      .attr('font-size', 11).text(cell.text);
  });
});
```

**Pattern 6: Donut Chart**
```js
var data = [{label: 'Academic', value: 35}, {label: 'Marketing', value: 40}, {label: 'Industry', value: 25}];
var colors = ['#ff4d00', '#ff6b2b', '#cc3d00'];
var pie = d3.pie().value(function(d) { return d.value; }).sort(null);
var arc = d3.arc().innerRadius(60).outerRadius(100);
var g = svg.append('g').attr('transform', 'translate(200,150)');

pie(data).forEach(function(d, i) {
  g.append('path').attr('d', arc(d)).attr('fill', colors[i]);
  // Label
  var pos = arc.centroid(d);
  g.append('text').attr('x', pos[0] * 1.8).attr('y', pos[1] * 1.8)
    .attr('text-anchor', 'middle').attr('fill', '#fafafa')
    .attr('font-size', 12).text(data[i].label);
});
```

### D3 Tips

- **Always set width/height** on the SVG element explicitly
- **Use `d3.select(scratch)`** — don't create a detached SVG
- **Font families in D3** must match Figma font names for editable text
- **Avoid D3 transitions, events, interactivity** — meaningless in static Figma
- **Keep scripts simple** — forEach loops over data arrays, not complex D3 patterns
- **rgba() works in SVG** attributes unlike Figma SOLID fills
- **Test with small data** first, then expand once the layout works


## VII. Slide Design Theory

### The Thought Process for Every Slide

Before touching any tool, answer these questions:

1. **What is the ONE takeaway?** If the audience remembers one thing from this slide, what is it?
2. **What is the visual metaphor?** Comparison → two columns. Process → flow. Hierarchy → stack. Distribution → chart. Timeline → horizontal bars.
3. **Where does the eye go first?** The largest/brightest element wins attention. Make sure it's the right one.
4. **What can be removed?** If removing an element doesn't hurt comprehension, remove it.

### Visualization Chooser

| You have... | Use this | Not this |
|------------|----------|----------|
| Two things to compare | Side-by-side panels | Paragraph describing differences |
| A process / sequence | Flow diagram with arrows | Numbered list |
| Parts of a whole | Donut chart or stacked bar | Table of percentages |
| Change over time | Line chart or Gantt | Text describing timeline |
| Categories / taxonomy | Card grid or tag pills | Bullet list |
| Hierarchy / layers | Stack diagram | Indented list |
| Relationships | Radial diagram or network | Text describing connections |
| A key metric | Giant number + small label | Sentence with number embedded |
| Pros vs cons | Check/X comparison columns | Two bullet lists |

### Layout Archetypes

**1. Hero Statement** — One big quote or number, centered, lots of whitespace
```
[                                    ]
[         SECTION LABEL              ]
[    Big Bold Statement              ]
[                                    ]
[      "Supporting quote in italic"  ]
[                                    ]
```

**2. Left Text + Right Graphic** — Explain on left, visualize on right
```
[ LABEL                              ]
[ Title with Accent                  ]
[                                    ]
[ Body text on the    | [D3 chart]   ]
[ left side with      | [or card ]   ]
[ supporting detail   | [panel   ]   ]
```

**3. Grid of Cards** — 2x2, 3x1, or 4x1 cards with icons
```
[ LABEL                              ]
[ Title                              ]
[                                    ]
[ [icon] Card 1  | [icon] Card 2     ]
[ description    | description       ]
[                                    ]
[ [icon] Card 3  | [icon] Card 4     ]
[ description    | description       ]
```

**4. Full-Width Visualization** — Chart/diagram takes the stage
```
[ LABEL                              ]
[ Title                              ]
[                                    ]
[ [====== Full-width D3 chart =====] ]
[                                    ]
[ Footer note                        ]
```

**5. Centered Comparison** — Two panels, centered with visual weight
```
[           LABEL                    ]
[      Title with Accent             ]
[                                    ]
[  [ Dim panel  ] [ Bright panel ]   ]
[  [ x items    ] [ ✓ items      ]   ]
[                                    ]
[    Bottom pull quote               ]
```

### Color Systems

**Dark theme (most common for tech/research):**

| Role | Color | Usage |
|------|-------|-------|
| Slide background | `#0a0a0a` or `#000000` | Always |
| Card fill | `#0a0a0a` / `#111111` | Panels, cards |
| Card border | `rgba(255,255,255,0.08)` or `#222222` | Subtle structure |
| Primary text | `#fafafa` / `#ffffff` | Headings, key text |
| Secondary text | `#999999` | Body, descriptions |
| Muted text | `#666666` | Captions, metadata |
| Dimmed text | `#333333` | Fine print, decorative |
| Accent | One color (e.g., `#ff4d00`) | Labels, highlights, data viz |
| Accent dim | `rgba(accent, 0.12)` | Card backgrounds, glows |
| Success | `#00c853` | Checkmarks, positive |
| Info blue | `#4285f4` | Secondary category |

**Accent highlight card:**
```
fills: [{ type: "SOLID", color: {r: 1, g: 0.3, b: 0}, opacity: 0.05 }]
strokes: [{ type: "SOLID", color: {r: 1, g: 0.3, b: 0}, opacity: 0.2 }]
strokeWeight: 1
```

**Subtle background card:**
```
fills: [{ type: "SOLID", color: {r: 1, g: 1, b: 1}, opacity: 0.02 }]
strokes: [{ type: "SOLID", color: {r: 1, g: 1, b: 1}, opacity: 0.08 }]
strokeWeight: 1
```


## VIII. API Gotchas — Hard-Won Lessons

These will save you hours of debugging:

### Gradient Fills Require gradientTransform

```js
// WRONG — will error
fills: [{ type: "GRADIENT_RADIAL", gradientStops: [...] }]

// RIGHT — must include gradientTransform
fills: [{
  type: "GRADIENT_RADIAL",
  gradientStops: [
    { position: 0, color: { r: 1, g: 0.3, b: 0, a: 0.06 } },
    { position: 1, color: { r: 1, g: 0.3, b: 0, a: 0 } }
  ],
  gradientTransform: [[0.7, 0, 0.5], [0, 0.7, -0.1]]
}]
```

The `gradientTransform` is a 2x3 affine matrix `[[a, b, tx], [c, d, ty]]` controlling the gradient's position and scale.

### SOLID Fill Colors Have No Alpha

```js
// WRONG — unrecognized key 'a'
fills: [{ type: "SOLID", color: { r: 1, g: 0.3, b: 0, a: 0.5 } }]

// RIGHT — alpha is on the fill object as opacity
fills: [{ type: "SOLID", color: { r: 1, g: 0.3, b: 0 }, opacity: 0.05 }]
```

For strokes it's the same pattern — opacity is on the stroke entry, not in the color.

### Shorthand fills Works for Simple Colors

```js
fills: "#ff4d00"  // Works! Shorthand for solid color
```

But for gradients, opacity control, or multiple fills, use the array format.

### Element Z-Order = Creation Order

Figma renders children in order — **later = on top**. Create background rectangles BEFORE the text that sits on them.

### Batch Operations — 8-12 Commands Max

The 30s timeout is the limit. Text operations (`setText` with font loading) are expensive. Pure shape commands are cheap.

```
Safe:   20 createNode (rectangles only)
Risky:  12 setText calls with different fonts
Limit:  8-10 mixed operations with setText + setTextRangeStyle
```

### The $N Reference Pattern

Use `$0.nodeId`, `$1.nodeId` to reference results within a batch. But if command $0 fails, everything referencing it fails silently.

**Safe pattern:** Create slides in separate calls, get the literal ID, then use it in batches.

### Slides API Limitations

| Feature | Status |
|---------|--------|
| createSlide, createSlideRow | Works |
| createNode (RECT, ELLIPSE, LINE, TEXT, etc.) | Works |
| create_svg (SVG import) | Works — graphics powerhouse |
| render_d3, render_rough | Works — text becomes editable |
| render_satori | Works — but text becomes paths (non-editable) |
| place_image (URL or bytes) | Works |
| createTable, createShapeWithText | **Unavailable** in Slides editor |
| createVideoAsync | **Broken** — returns empty `{}` |
| list_fonts (no query) | Returns 2000+ → **always use query param** |
| foreignObject in SVG | **Stripped** by Figma parser |

### Working Smart — Duplicate and Modify

For slides with similar layouts:
- `duplicate_slide(slideId)` → creates an exact copy
- `clear_slide(slideId)` → keeps the slide, removes all content
- `clone_node(nodeId, parentId)` → copy an element to another slide

This is far faster than rebuilding from scratch.


## IX. Quick Reference

| Task | Tool | Key Params |
|------|------|------------|
| Start session | `start_session` | — |
| Check connection | `connection_status` | — |
| See deck structure | `get_slide_grid` | — |
| New slide | `create_slide` | `fills: "#0a0a0a"` |
| Screenshot | `screenshot_slide` | `slideId, scale: 1` |
| Read existing slide | `get_slide_context` | `slideId` |
| Copy a slide | `duplicate_slide` | `slideId` |
| Wipe slide content | `clear_slide` | `slideId` |
| Add any shape/text | `create_node` | `type, parentId, props` |
| Modify any property | `set_properties` | `nodeId, props` |
| Set text content | `set_text` | `nodeId, text, fontName` |
| Read text length | `get_text_content` | `nodeId` |
| Style text range | `set_text_range_style` | `nodeId, start, end, props` |
| Place image from URL | `place_image` | `parentId, url, x, y, w, h` |
| D3 visualization | `render_d3` | `parentId, script, x, y, w, h` |
| Rough.js sketch | `render_rough` | `parentId, script, x, y, w, h` |
| Satori CSS layout | `render_satori` | `parentId, script, x, y, w, h` |
| Import SVG string | `create_svg` | `parentId, svg, x, y, w, h` |
| Multi-command batch | `batch_operations` | `commands[]` with `$N.field` refs |
| Search fonts | `list_fonts` | `query: "Inter"` |
| Clone element | `clone_node` | `nodeId, parentId` |
| Group elements | `group_nodes` | `nodeIds[], parentId` |
| Find nodes | `find_nodes` | `criteria: { name, type }` |
| Export as PNG/SVG | `export_node` | `nodeId, format, scale` |
| All slide thumbnails | `screenshot_all_slides` | `scale: 0.5` |
