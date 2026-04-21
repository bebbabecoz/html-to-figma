// ─── Color helpers ────────────────────────────────────────────────────────────

function cssColorToFigma(cssColor) {
  if (!cssColor || cssColor === 'transparent' || cssColor === 'rgba(0, 0, 0, 0)') return null;

  const m = cssColor.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/
  );
  if (m) {
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    if (a === 0) return null;
    return { r: parseFloat(m[1]) / 255, g: parseFloat(m[2]) / 255, b: parseFloat(m[3]) / 255, a };
  }

  // hex fallback
  const hex = cssColor.replace('#', '');
  if (/^[0-9a-fA-F]{3,8}$/.test(hex)) {
    const full = hex.length <= 4
      ? hex.split('').map(c => c + c).join('')
      : hex;
    return {
      r: parseInt(full.slice(0, 2), 16) / 255,
      g: parseInt(full.slice(2, 4), 16) / 255,
      b: parseInt(full.slice(4, 6), 16) / 255,
      a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    };
  }
  return null;
}

function toFill(color) {
  if (!color) return null;
  return { type: 'SOLID', color: { r: color.r, g: color.g, b: color.b }, opacity: color.a };
}

// ─── CSS → Figma value maps ───────────────────────────────────────────────────

const JUSTIFY_MAP = {
  'flex-start': 'MIN', start: 'MIN', left: 'MIN', normal: 'MIN',
  'flex-end': 'MAX', end: 'MAX', right: 'MAX',
  center: 'CENTER',
  'space-between': 'SPACE_BETWEEN',
  'space-around': 'SPACE_BETWEEN',
  'space-evenly': 'SPACE_BETWEEN',
};

const ALIGN_MAP = {
  'flex-start': 'MIN', start: 'MIN', normal: 'MIN',
  'flex-end': 'MAX', end: 'MAX',
  center: 'CENTER',
  stretch: 'MIN',
  baseline: 'MIN',
};

const TEXT_ALIGN_MAP = {
  left: 'LEFT', start: 'LEFT',
  right: 'RIGHT', end: 'RIGHT',
  center: 'CENTER',
  justify: 'JUSTIFIED',
};

function px(val) { return Math.round(parseFloat(val) || 0); }

// ─── Element type detection ───────────────────────────────────────────────────

const INLINE_TAGS = new Set(['span', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'mark', 'code', 'kbd', 'sup', 'sub', 'abbr', 'cite', 'q', 'time']);
const TEXT_ROOT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'li', 'td', 'th', 'caption', 'dt', 'dd', 'blockquote']);

function hasOnlyTextContent(el, win) {
  for (const child of el.childNodes) {
    if (child.nodeType === 3 /* TEXT_NODE */) continue;
    if (child.nodeType === 1 /* ELEMENT_NODE */) {
      const tag = child.tagName.toLowerCase();
      if (!INLINE_TAGS.has(tag)) return false;
      if (!hasOnlyTextContent(child, win)) return false;
    }
  }
  return el.textContent.trim().length > 0;
}

function resolveType(el, style, win) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'img') return 'RECTANGLE';
  if (tag === 'svg') return 'VECTOR';

  const isTextRoot = TEXT_ROOT_TAGS.has(tag) || (tag === 'a' && !el.querySelector('div,section,article,header,nav'));
  if (isTextRoot && hasOnlyTextContent(el, win)) {
    // Ensure no block-level children that would break text node assumption
    const hasBlock = Array.from(el.children).some(c => {
      const cs = win.getComputedStyle(c);
      return cs.display === 'block' || cs.display === 'flex' || cs.display === 'grid';
    });
    if (!hasBlock) return 'TEXT';
  }

  // Pure button/input with only text → TEXT
  if ((tag === 'button' || tag === 'input') && hasOnlyTextContent(el, win)) return 'TEXT';

  return 'FRAME';
}

// ─── Name builder ─────────────────────────────────────────────────────────────

function layerName(el) {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  if (el.className && typeof el.className === 'string') {
    const cls = el.className.trim().split(/\s+/)[0];
    if (cls) return `${tag}.${cls}`;
  }
  const text = el.textContent.trim().slice(0, 20);
  if (text) return `${tag} "${text}"`;
  return tag;
}

// ─── Box shadow parser ────────────────────────────────────────────────────────

function parseShadow(boxShadow) {
  if (!boxShadow || boxShadow === 'none') return null;
  // Match: [inset] offset-x offset-y blur [spread] color
  const m = boxShadow.match(
    /(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?\s+(rgba?\([^)]+\)|#[\da-fA-F]+)/
  );
  if (!m) return null;
  const color = cssColorToFigma(m[5]);
  if (!color) return null;
  const isInset = boxShadow.includes('inset');
  return {
    type: isInset ? 'INNER_SHADOW' : 'DROP_SHADOW',
    offset: { x: parseFloat(m[1]), y: parseFloat(m[2]) },
    radius: parseFloat(m[3]),
    spread: parseFloat(m[4]) || 0,
    color: { r: color.r, g: color.g, b: color.b, a: color.a },
    visible: true,
    blendMode: 'NORMAL',
  };
}

// ─── Core node builder ────────────────────────────────────────────────────────

function elementToNode(el, win, parentRect) {
  const style = win.getComputedStyle(el);

  if (style.display === 'none' || style.visibility === 'hidden') return null;

  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;

  const type = resolveType(el, style, win);
  const node = {
    type,
    name: layerName(el),
    x: Math.round(rect.left - parentRect.left),
    y: Math.round(rect.top - parentRect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };

  // ── IMAGE ──────────────────────────────────────────────────────────────────
  if (type === 'RECTANGLE' && el.tagName.toLowerCase() === 'img') {
    node.fills = [{ type: 'SOLID', color: { r: 0.88, g: 0.88, b: 0.88 }, opacity: 1 }];
    node.name = el.alt || layerName(el);
    if (el.src) node.imageUrl = el.src;
    return node;
  }

  // ── TEXT ───────────────────────────────────────────────────────────────────
  if (type === 'TEXT') {
    const color = cssColorToFigma(style.color);
    node.characters = el.textContent.trim();
    node.fontSize = px(style.fontSize) || 14;
    node.fontWeight = parseInt(style.fontWeight) || 400;
    node.fontFamily = style.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
    node.textAlignHorizontal = TEXT_ALIGN_MAP[style.textAlign] || 'LEFT';
    node.lineHeight = style.lineHeight !== 'normal'
      ? { value: px(style.lineHeight), unit: 'PIXELS' }
      : { unit: 'AUTO' };
    const letterSpacing = parseFloat(style.letterSpacing);
    if (!isNaN(letterSpacing) && letterSpacing !== 0) {
      node.letterSpacing = { value: letterSpacing, unit: 'PIXELS' };
    }
    node.fills = color ? [toFill(color)] : [];
    return node;
  }

  // ── FRAME / RECTANGLE (non-image) ─────────────────────────────────────────

  // Background
  const bgColor = cssColorToFigma(style.backgroundColor);
  node.fills = bgColor ? [toFill(bgColor)] : [];

  // Background image gradient (simplified)
  if (style.backgroundImage && style.backgroundImage !== 'none') {
    if (style.backgroundImage.startsWith('linear-gradient') || style.backgroundImage.startsWith('radial-gradient')) {
      node.fills = [{ type: 'GRADIENT_LINEAR', gradientStops: [], opacity: 1 }];
    }
  }

  // Border
  const borderWidth = parseFloat(style.borderWidth) || 0;
  const borderColor = cssColorToFigma(style.borderColor);
  if (borderWidth > 0 && borderColor) {
    node.strokes = [toFill(borderColor)];
    node.strokeWeight = borderWidth;
    node.strokeAlign = 'INSIDE';
  }

  // Corner radius
  const tl = px(style.borderTopLeftRadius);
  const tr = px(style.borderTopRightRadius);
  const bl = px(style.borderBottomLeftRadius);
  const br = px(style.borderBottomRightRadius);
  if (tl === tr && tl === bl && tl === br) {
    if (tl > 0) node.cornerRadius = tl;
  } else if (tl > 0 || tr > 0 || bl > 0 || br > 0) {
    node.topLeftRadius = tl;
    node.topRightRadius = tr;
    node.bottomLeftRadius = bl;
    node.bottomRightRadius = br;
  }

  // Opacity
  const opacity = parseFloat(style.opacity);
  if (!isNaN(opacity) && opacity < 1) node.opacity = opacity;

  // Box shadow
  const shadow = parseShadow(style.boxShadow);
  if (shadow) node.effects = [shadow];

  // ── Auto Layout ────────────────────────────────────────────────────────────
  const display = style.display;
  if (display === 'flex' || display === 'inline-flex') {
    const isColumn = (style.flexDirection || 'row').startsWith('column');
    node.layoutMode = isColumn ? 'VERTICAL' : 'HORIZONTAL';

    const gap = parseFloat(style.gap);
    const rowGap = parseFloat(style.rowGap);
    const colGap = parseFloat(style.columnGap);
    const spacing = isColumn
      ? (isNaN(rowGap) ? (isNaN(gap) ? 0 : gap) : rowGap)
      : (isNaN(colGap) ? (isNaN(gap) ? 0 : gap) : colGap);
    node.itemSpacing = Math.round(spacing) || 0;

    node.paddingTop = px(style.paddingTop);
    node.paddingRight = px(style.paddingRight);
    node.paddingBottom = px(style.paddingBottom);
    node.paddingLeft = px(style.paddingLeft);

    node.primaryAxisAlignItems = JUSTIFY_MAP[style.justifyContent] || 'MIN';
    node.counterAxisAlignItems = ALIGN_MAP[style.alignItems] || 'MIN';
    node.primaryAxisSizingMode = 'FIXED';
    node.counterAxisSizingMode = 'FIXED';

    if (style.flexWrap === 'wrap' || style.flexWrap === 'wrap-reverse') {
      node.layoutWrap = 'WRAP';
    }
  } else if (display === 'grid') {
    // Map CSS Grid as a basic frame with padding
    node.paddingTop = px(style.paddingTop);
    node.paddingRight = px(style.paddingRight);
    node.paddingBottom = px(style.paddingBottom);
    node.paddingLeft = px(style.paddingLeft);
  }

  // ── Children ───────────────────────────────────────────────────────────────
  const children = [];
  for (const child of el.children) {
    const childNode = elementToNode(child, win, rect);
    if (childNode) children.push(childNode);
  }
  if (children.length > 0) node.children = children;

  return node;
}

// ─── Image load waiter ────────────────────────────────────────────────────────

function waitForImages(doc, timeout = 6000) {
  return new Promise(resolve => {
    const imgs = Array.from(doc.querySelectorAll('img'));
    if (imgs.length === 0) return resolve();

    let pending = imgs.filter(img => !img.complete).length;
    if (pending === 0) return resolve();

    const timer = setTimeout(resolve, timeout);
    const done = () => { if (--pending <= 0) { clearTimeout(timer); resolve(); } };
    imgs.forEach(img => {
      if (!img.complete) {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      }
    });
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert an iframe document into a Figma-compatible node array.
 * Compatible with Builder.io plugin "Import from JSON".
 *
 * @param {Document} iframeDoc
 * @returns {Promise<object[]>}
 */
export async function convertHtmlToFigma(iframeDoc) {
  await waitForImages(iframeDoc);

  const win = iframeDoc.defaultView;
  const body = iframeDoc.body;
  const bodyRect = body.getBoundingClientRect();

  const nodes = [];
  for (const child of body.children) {
    const node = elementToNode(child, win, bodyRect);
    if (node) nodes.push(node);
  }

  if (nodes.length === 0) {
    throw new Error('No visible elements found. Make sure the HTML file has visible content.');
  }

  return nodes;
}
