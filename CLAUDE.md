# HTML → Figma Importer — Project Brief for AI Agents

## เป้าหมายโปรเจกต์

แปลงไฟล์ HTML เป็น Figma layers โดยตรง ผ่าน **Figma Plugin** ที่รับ `.html` ไฟล์แล้วสร้าง nested frame tree ที่มี Auto Layout เหมือนกับที่ plugin `html.to.design` ทำ

---

## โครงสร้างโปรเจกต์

```
html-to-figma-json/
├── figma-plugin/          ← ส่วนหลัก (Figma Plugin)
│   ├── manifest.json      ← config ของ plugin
│   ├── code.js            ← runs in Figma sandbox (main thread)
│   └── ui.html            ← plugin UI + converter logic (browser context)
│
├── src/                   ← React web app (เดิม, ไม่ค่อยใช้แล้ว)
│   ├── App.jsx
│   ├── components/
│   │   ├── DropZone.jsx
│   │   ├── HtmlPreview.jsx
│   │   └── JsonOutput.jsx
│   └── utils/htmlToFigma.js   ← custom converter เก่า (deprecated)
│
├── scripts/
│   └── build-plugin.cjs   ← script เก่า inline browser.js (deprecated)
│
├── package.json           ← React+Vite+Tailwind web app
└── CLAUDE.md              ← ไฟล์นี้
```

---

## สถาปัตยกรรมหลัก

### Figma Plugin (`figma-plugin/`)

Plugin ทำงาน 2 thread:

```
[ui.html - browser context]          [code.js - Figma sandbox]
     |                                         |
     | 1. user drop .html file                 |
     | 2. render in hidden iframe (1440×900)   |
     | 3. inject __convert() script            |
     | 4. DOM tree → layer JSON tree           |
     |                                         |
     |── postMessage { type:'import',         |
     |                 layers: [...] } ───────>|
     |                                         | 5. buildNode() recursive
     |                                         | 6. figma.createFrame() etc.
     |<── postMessage { type:'success' } ──────|
```

### Converter (`ui.html` → `__convert()` function)

แปลง DOM → Figma layer tree แบบ **nested** (ไม่ใช่ flat):

```
HTML element → FRAME node
  ├── display:flex → layoutMode: HORIZONTAL/VERTICAL
  ├── gap → itemSpacing
  ├── padding → paddingTop/Right/Bottom/Left
  ├── align-items → counterAxisAlignItems
  ├── justify-content → primaryAxisAlignItems
  ├── background-color → fills[]
  ├── border → strokes[]
  ├── border-radius → cornerRadius / topLeftRadius etc.
  ├── box-shadow → effects[]
  └── children (recursive)

Text leaf element → TEXT node
  ├── innerText → characters
  ├── font-size → fontSize
  ├── font-weight → fontWeight (→ weightToStyle())
  ├── color → fills[]
  ├── text-align → textAlignHorizontal
  └── line-height → lineHeight

<input>/<textarea>/<select> → FRAME + TEXT child
<img> → RECTANGLE (gray placeholder)
<svg>,<canvas>,<script>,<style> → skipped
```

---

## ไฟล์สำคัญและหน้าที่

### `figma-plugin/ui.html`

**ทั้งไฟล์นี้ทำงานใน browser context** (ไม่ใช่ Figma sandbox)

#### ส่วน `CONVERTER_SRC` (บรรทัด ~125–350)
- function `__convert()` ที่ embed เป็น string แล้ว inject เข้า sub-iframe
- ทำงานใน iframe ที่ render HTML ไฟล์ของ user
- Return: `[{ type:'FRAME', name:'Page', ... children:[...] }]`

#### Key functions ใน `__convert()`:
| Function | หน้าที่ |
|----------|---------|
| `buildNode(el, parentLeft, parentTop)` | main recursive builder |
| `mkFrame(el, style, x, y, w, h)` | สร้าง base FRAME object |
| `styleFrame(f, el, style)` | ใส่ fill/stroke/radius/shadow/opacity |
| `applyAutoLayout(f, style)` | map CSS flex → Figma Auto Layout |
| `mkTextNode(el, style, x, y, w, h)` | สร้าง TEXT node |
| `parseShadow(str)` | parse CSS box-shadow → Figma effect |
| `borderInfo(style)` | parse border width/color/style |

#### Logic การตัดสินใจ node type:
```
hasElemChild = มี element children หรือเปล่า
hasDirectText = มี text node โดยตรง (เช่น "Hello <b>world</b>")

if (!hasElemChild || hasDirectText) → TEXT node (ใช้ el.innerText)
else → FRAME + recurse children
```

#### Positioning:
- `x, y` ของ child = `child.getBoundingClientRect() - parent.getBoundingClientRect()`
- `position:absolute` children ใน flex parent → set `layoutPositioning: 'ABSOLUTE'`

#### Auto Layout sizing:
- `primaryAxisSizingMode: 'FIXED'` และ `counterAxisSizingMode: 'FIXED'` เสมอ
- เพื่อให้ frame ขนาดตรงกับ HTML จริง ไม่ขยายเองตาม children

---

### `figma-plugin/code.js`

**ทำงานใน Figma sandbox** — มีข้อจำกัดสำคัญ:
- ❌ ไม่มี `??` (nullish coalescing) — ใช้ `(x !== undefined ? x : default)` แทน
- ❌ ไม่มี `?.` (optional chaining)
- ❌ ไม่มี DOM API
- ✅ มี `figma.*` API
- ✅ ES6+ (class, async/await, destructuring)

#### Key functions:
| Function | หน้าที่ |
|----------|---------|
| `buildNode(layer)` | dispatcher → buildFrame/buildText/buildRect |
| `buildFrame(layer)` | สร้าง Figma Frame, apply Auto Layout, recurse children |
| `buildText(layer)` | สร้าง Text node พร้อม font loading |
| `buildRect(layer)` | สร้าง Rectangle |
| `preloadFonts(layers)` | collect + load ทุก font ที่ต้องใช้ล่วงหน้า |
| `applyFills/Strokes/Radius/Opacity/Effects` | helper apply styles |

#### Order การ build frame ที่สำคัญ:
```js
1. createFrame()
2. resize(w, h)            // set initial size
3. apply fills/strokes/radius/opacity/effects
4. set layoutMode + padding + alignment  // Auto Layout
5. set primaryAxisSizingMode = 'FIXED'   // lock size
6. appendChild(childNode) loop           // add children
7. set layoutPositioning = 'ABSOLUTE'    // for abs-pos children
8. resize(w, h) AGAIN                    // enforce size after children
```

Step 8 สำคัญมาก — Auto Layout จะขยาย frame ถ้าไม่ resize อีกรอบ

---

## Layer Schema (ส่งระหว่าง ui.html → code.js)

```typescript
type Layer = FrameLayer | TextLayer | RectLayer;

interface FrameLayer {
  type: 'FRAME';
  name: string;
  x: number; y: number; width: number; height: number;
  fills: FillPaint[];
  strokes: FillPaint[];
  strokeWeight?: number;
  strokeAlign?: 'INSIDE' | 'OUTSIDE' | 'CENTER';
  dashPattern?: number[];          // [6,4] = dashed, [2,3] = dotted
  cornerRadius?: number;
  topLeftRadius?: number; topRightRadius?: number;
  bottomLeftRadius?: number; bottomRightRadius?: number;
  opacity?: number;
  clipsContent?: boolean;
  effects?: Effect[];
  // Auto Layout
  layoutMode?: 'HORIZONTAL' | 'VERTICAL';
  itemSpacing?: number;
  paddingTop?: number; paddingRight?: number;
  paddingBottom?: number; paddingLeft?: number;
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX';
  primaryAxisSizingMode?: 'FIXED' | 'AUTO';
  counterAxisSizingMode?: 'FIXED' | 'AUTO';
  layoutWrap?: 'WRAP' | 'NO_WRAP';
  // Position within parent auto layout
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';
  children: Layer[];
}

interface TextLayer {
  type: 'TEXT';
  name: string;
  x: number; y: number; width: number; height: number;
  characters: string;
  fontSize: number;
  fontWeight: number;             // numeric: 400, 700 etc.
  fontFamily: string;             // first font name only
  textAlignHorizontal: 'LEFT' | 'RIGHT' | 'CENTER' | 'JUSTIFIED';
  lineHeight: { value: number; unit: 'PIXELS' } | { unit: 'AUTO' };
  letterSpacing?: { value: number; unit: 'PIXELS' };
  textDecoration?: 'UNDERLINE' | 'STRIKETHROUGH';
  // WIDTH_AND_HEIGHT = nowrap text, expands freely (no clip)
  // HEIGHT           = wrapping text, fixed width, auto height
  textAutoResize?: 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'NONE';
  fills: FillPaint[];
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';
}

interface RectLayer {
  type: 'RECTANGLE';
  name: string;
  x: number; y: number; width: number; height: number;
  fills: FillPaint[];
  strokes: FillPaint[];
  effects: Effect[];
  cornerRadius?: number;
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';
}

interface FillPaint {
  type: 'SOLID';
  color: { r: number; g: number; b: number }; // 0–1
  opacity: number;                              // 0–1
}

interface Effect {
  type: 'DROP_SHADOW';
  offset: { x: number; y: number };
  radius: number;
  spread: number;
  color: { r: number; g: number; b: number; a: number }; // 0–1
  visible: true;
  blendMode: 'NORMAL';
}
```

---

## วิธีติดตั้ง Figma Plugin

1. เปิด Figma Desktop
2. **Plugins → Development → Import plugin from manifest**
3. เลือกไฟล์ `figma-plugin/manifest.json`
4. Plugin จะปรากฏใน **Plugins → Development → HTML to Figma Importer**

ไม่ต้อง build step — `ui.html` และ `code.js` ทำงานตรงโดยไม่ผ่าน bundler

---

## วิธีใช้งาน Plugin

1. เปิด Plugin ใน Figma
2. Drop ไฟล์ `.html` หรือ `.htm` เข้าไป
3. กด **Import to Figma**
4. Plugin จะสร้าง Frame ใหม่บน canvas

---

## ปัญหาที่เคยเจอและวิธีแก้

| ปัญหา | สาเหตุ | วิธีแก้ |
|--------|---------|---------|
| `Unexpected token ?` | Figma sandbox ไม่รองรับ `??` / `?.` | ใช้ `(x !== undefined ? x : default)` |
| Frame ขยายเกินกว่า HTML | Auto Layout resize frame ตาม children | `resize(w,h)` อีกครั้งหลัง appendChild |
| Text ถูก clip/truncate | `textAutoResize='NONE'` + width แคบกว่า text | ส่ง `textAutoResize` จาก converter: nowrap→`WIDTH_AND_HEIGHT`, wrap→`HEIGHT` |
| Text หาย (mixed content) | `textContent` ดึงแค่ leaf node | ใช้ `el.innerText` + check `hasDirectText` |
| `fetch('./browser.js')` fail | Plugin UI ไม่มี base URL | inline script เป็น string แทน |
| Background gradient หาย | `parseColor` handle แค่ `rgb()` | detect `backgroundImage !== 'none'` → neutral fill |
| SVG text ปนออกมา | recurse เข้า SVG children | skip `svg`, `canvas`, `script`, `style` tags |

---

## สิ่งที่ยังทำไม่ได้ / อยากทำต่อ

- [ ] **SVG rendering** — ปัจจุบัน SVG ถูก skip ทั้งหมด ควรแปลงเป็น vector node
- [ ] **Image fill** — `<img>` ยังเป็นแค่ gray rectangle, ควร fetch + embed image data
- [ ] **`layoutSizingHorizontal/Vertical`** บน child nodes — ปัจจุบัน children ทุกตัว FIXED, ควรตรวจ `flex:1` / `width:100%` → `FILL`
- [ ] **Grid layout** — `display:grid` ยังไม่ได้ map
- [ ] **CSS variables** — `var(--color)` บางที `getComputedStyle` resolve ได้, แต่บางทีไม่
- [ ] **Pseudo-elements** — `::before`, `::after` ไม่ถูก capture
- [ ] **Multiple box shadows** — ปัจจุบัน parse แค่ shadow แรก
- [ ] **z-index ordering** — layer order ตาม DOM order, ไม่ได้ sort ตาม z-index
- [ ] **Web App** (`src/`) — ยังเป็น Builder.io approach เก่า, อาจ update ให้ match กับ plugin ใหม่

---

## Web App (รอง — `src/`)

React + Vite + Tailwind app ที่แปลง HTML → `builder.json` สำหรับ Builder.io Figma plugin

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # build to dist/
```

**Flow:** Drop HTML → render ใน hidden iframe → inject `@builder.io/html-to-figma/browser` → output `{ layers, images }` JSON → download เป็น `builder.json`

ปัจจุบัน Builder.io plugin version ใหม่มี schema ต่างออกไป ทำให้ไฟล์ที่ generate อาจ import ไม่ได้

---

## Reference

- Figma Plugin API: https://www.figma.com/plugin-docs/
- Figma Auto Layout API: https://www.figma.com/plugin-docs/api/properties/nodes-layoutmode/
- ตัวอย่าง output ที่ต้องการ (html.to.design result): `figma.com/design/hz5nod44JBUXaTPn0C7l3x` node `13013:66746`
