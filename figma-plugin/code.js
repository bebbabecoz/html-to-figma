// HTML to Figma Importer — Plugin Main Thread
// Runs in Figma's sandbox (has access to figma.* API)

figma.showUI(__html__, { width: 440, height: 580, title: 'HTML to Figma Importer' });

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'import') {
    await runImport(msg.json);
  }
  if (msg.type === 'close') {
    figma.closePlugin();
  }
};

// ─── Main import flow ─────────────────────────────────────────────────────────

async function runImport(jsonString) {
  try {
    let data;
    try {
      data = JSON.parse(jsonString);
    } catch (e) {
      return send('error', 'JSON ไม่ถูกต้อง: ' + e.message);
    }

    // Accept both { layers: [...] } and raw array
    const layers = Array.isArray(data) ? data : (data.layers || []);
    if (!layers.length) return send('error', 'ไม่พบ layers ใน JSON');

    send('progress', 'กำลังโหลด fonts…');
    await preloadFonts(layers);

    send('progress', 'กำลังสร้าง layers…');
    const created = [];
    for (const layer of layers) {
      const node = await buildNode(layer);
      if (node) {
        figma.currentPage.appendChild(node);
        created.push(node);
      }
    }

    if (!created.length) return send('error', 'ไม่สามารถสร้าง layer ได้');

    figma.currentPage.selection = created;
    figma.viewport.scrollAndZoomIntoView(created);
    send('success', `นำเข้าสำเร็จ ${created.length} layer(s)!`);
  } catch (e) {
    send('error', e.message || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ');
  }
}

function send(type, message) {
  figma.ui.postMessage({ type, message });
}

// ─── Font helpers ─────────────────────────────────────────────────────────────

function parseFontFamily(str) {
  if (!str) return 'Inter';
  return (str.split(',')[0] || '').replace(/['"]/g, '').trim() || 'Inter';
}

function weightToStyle(w) {
  const n = parseInt(w) || 400;
  if (n >= 800) return 'ExtraBold';
  if (n >= 700) return 'Bold';
  if (n >= 600) return 'SemiBold';
  if (n >= 500) return 'Medium';
  if (n >= 300) return 'Light';
  return 'Regular';
}

function collectFontKeys(layers, set) {
  for (const layer of layers) {
    if (layer.type === 'TEXT') {
      const fam = parseFontFamily(layer.fontFamily);
      set.add(fam + '|' + weightToStyle(layer.fontWeight));
      set.add(fam + '|Regular'); // always pre-load Regular as fallback
    }
    if (layer.children) collectFontKeys(layer.children, set);
  }
}

async function preloadFonts(layers) {
  const keys = new Set();
  collectFontKeys(layers, keys);
  keys.add('Inter|Regular'); // final fallback

  await Promise.all(
    Array.from(keys).map(key => {
      const [family, style] = key.split('|');
      return figma.loadFontAsync({ family, style }).catch(() => null);
    })
  );
}

// ─── Node builder ─────────────────────────────────────────────────────────────

async function buildNode(layer) {
  try {
    switch (layer.type) {
      case 'TEXT':      return await buildText(layer);
      case 'RECTANGLE': return buildRect(layer);
      case 'SVG':
      case 'VECTOR':    return buildSvgPlaceholder(layer);
      default:          return await buildFrame(layer); // FRAME, GROUP, anything else
    }
  } catch (e) {
    // Return error placeholder so one bad node doesn't break the whole import
    const ph = figma.createRectangle();
    ph.name = (layer.name || layer.type || '?') + ' [error]';
    ph.resize(Math.max(1, layer.width || 20), Math.max(1, layer.height || 20));
    ph.x = layer.x || 0;
    ph.y = layer.y || 0;
    ph.fills = [solid(1, 0.4, 0.4, 0.35)];
    return ph;
  }
}

// ── FRAME ─────────────────────────────────────────────────────────────────────

async function buildFrame(layer) {
  const node = figma.createFrame();
  node.name = layer.name || 'Frame';

  const w = Math.max(1, Math.round(layer.width)  || 100);
  const h = Math.max(1, Math.round(layer.height) || 100);
  node.resize(w, h);
  node.x = Math.round(layer.x) || 0;
  node.y = Math.round(layer.y) || 0;

  // Fills — builder.io uses "backgrounds", our format uses "fills"
  applyFills(node, layer.fills || layer.backgrounds);

  applyStrokes(node, layer.strokes, layer.strokeWeight);
  applyRadius(node, layer);
  applyOpacity(node, layer.opacity);
  applyEffects(node, layer.effects);

  if (layer.clipsContent !== undefined) node.clipsContent = layer.clipsContent;

  // Auto Layout (CSS Flexbox → Figma)
  if (layer.layoutMode && layer.layoutMode !== 'NONE') {
    node.layoutMode = layer.layoutMode; // 'HORIZONTAL' | 'VERTICAL'
    if (layer.itemSpacing    !== undefined) node.itemSpacing    = layer.itemSpacing;
    if (layer.paddingTop     !== undefined) node.paddingTop     = layer.paddingTop;
    if (layer.paddingRight   !== undefined) node.paddingRight   = layer.paddingRight;
    if (layer.paddingBottom  !== undefined) node.paddingBottom  = layer.paddingBottom;
    if (layer.paddingLeft    !== undefined) node.paddingLeft    = layer.paddingLeft;
    if (layer.primaryAxisAlignItems)  node.primaryAxisAlignItems  = layer.primaryAxisAlignItems;
    if (layer.counterAxisAlignItems)  node.counterAxisAlignItems  = layer.counterAxisAlignItems;
    if (layer.primaryAxisSizingMode)  node.primaryAxisSizingMode  = layer.primaryAxisSizingMode;
    if (layer.counterAxisSizingMode)  node.counterAxisSizingMode  = layer.counterAxisSizingMode;
    if (layer.layoutWrap) node.layoutWrap = layer.layoutWrap;
  }

  // Children
  if (layer.children && layer.children.length) {
    for (const child of layer.children) {
      const childNode = await buildNode(child);
      if (childNode) node.appendChild(childNode);
    }
    // Restore explicit size for non-auto-layout frames (auto layout resizes itself)
    if (!layer.layoutMode || layer.layoutMode === 'NONE') {
      node.resize(w, h);
    }
  }

  return node;
}

// ── RECTANGLE ─────────────────────────────────────────────────────────────────

function buildRect(layer) {
  const node = figma.createRectangle();
  node.name = layer.name || 'Rectangle';
  node.resize(Math.max(1, Math.round(layer.width) || 10), Math.max(1, Math.round(layer.height) || 10));
  node.x = Math.round(layer.x) || 0;
  node.y = Math.round(layer.y) || 0;

  applyFills(node, layer.fills);
  applyStrokes(node, layer.strokes, layer.strokeWeight);
  applyRadius(node, layer);
  applyOpacity(node, layer.opacity);
  applyEffects(node, layer.effects);
  return node;
}

// ── SVG placeholder ───────────────────────────────────────────────────────────

function buildSvgPlaceholder(layer) {
  const node = figma.createFrame();
  node.name = layer.name || 'SVG';
  node.resize(Math.max(1, Math.round(layer.width) || 10), Math.max(1, Math.round(layer.height) || 10));
  node.x = Math.round(layer.x) || 0;
  node.y = Math.round(layer.y) || 0;
  node.fills = [solid(0.85, 0.85, 0.85, 1)];
  return node;
}

// ── TEXT ──────────────────────────────────────────────────────────────────────

async function buildText(layer) {
  const node = figma.createText();
  node.name = layer.name || 'Text';

  const family = parseFontFamily(layer.fontFamily);
  const style  = weightToStyle(layer.fontWeight);

  // Try preferred font → family Regular → Inter Regular
  let loaded = { family: 'Inter', style: 'Regular' };
  for (const f of [{ family, style }, { family, style: 'Regular' }, { family: 'Inter', style: 'Regular' }]) {
    try { await figma.loadFontAsync(f); loaded = f; break; } catch (_) {}
  }
  node.fontName = loaded;

  node.characters = layer.characters || ' ';
  node.fontSize   = Math.max(1, layer.fontSize || 14);
  node.x = Math.round(layer.x) || 0;
  node.y = Math.round(layer.y) || 0;

  applyFills(node, layer.fills);

  if (layer.textAlignHorizontal && ['LEFT','RIGHT','CENTER','JUSTIFIED'].includes(layer.textAlignHorizontal)) {
    node.textAlignHorizontal = layer.textAlignHorizontal;
  }
  if (layer.lineHeight)    node.lineHeight    = layer.lineHeight;
  if (layer.letterSpacing) node.letterSpacing = layer.letterSpacing;
  if (layer.textCase)      node.textCase      = layer.textCase;
  if (layer.textDecoration && layer.textDecoration !== 'NONE') {
    node.textDecoration = layer.textDecoration;
  }

  if (layer.width > 0 && layer.height > 0) {
    node.textAutoResize = 'NONE';
    node.resize(Math.max(1, Math.round(layer.width)), Math.max(1, Math.round(layer.height)));
  }

  applyOpacity(node, layer.opacity);
  return node;
}

// ─── Paint / style helpers ────────────────────────────────────────────────────

function solid(r, g, b, a) {
  return { type: 'SOLID', color: { r, g, b }, opacity: (a !== undefined ? a : 1), visible: true };
}

function applyFills(node, fillsArr) {
  if (!fillsArr || !fillsArr.length) { node.fills = []; return; }
  const paints = fillsArr.map(f => {
    if (!f || f.type !== 'SOLID') return null;
    const c = f.color || {};
    return solid(clamp(c.r), clamp(c.g), clamp(c.b), (f.opacity !== undefined ? f.opacity : 1));
  }).filter(Boolean);
  node.fills = paints;
}

function applyStrokes(node, strokesArr, weight) {
  if (!strokesArr || !strokesArr.length) return;
  node.strokes = strokesArr.map(s => {
    const c = s.color || {};
    return solid(clamp(c.r), clamp(c.g), clamp(c.b), (s.opacity !== undefined ? s.opacity : 1));
  });
  if (weight) node.strokeWeight = weight;
  node.strokeAlign = 'INSIDE';
}

function applyRadius(node, layer) {
  if (layer.cornerRadius !== undefined) {
    node.cornerRadius = layer.cornerRadius;
  } else if (layer.topLeftRadius !== undefined) {
    node.topLeftRadius     = layer.topLeftRadius     || 0;
    node.topRightRadius    = layer.topRightRadius    || 0;
    node.bottomLeftRadius  = layer.bottomLeftRadius  || 0;
    node.bottomRightRadius = layer.bottomRightRadius || 0;
  }
}

function applyOpacity(node, opacity) {
  if (opacity !== undefined && opacity < 1) node.opacity = opacity;
}

function applyEffects(node, effects) {
  if (!effects || !effects.length) return;
  node.effects = effects.map(e => ({
    type:      e.type || 'DROP_SHADOW',
    offset:    e.offset    || { x: 0, y: 2 },
    radius:    (e.radius !== undefined ? e.radius : 4),
    spread:    (e.spread !== undefined ? e.spread : 0),
    color:     { r: (e.color && e.color.r) || 0, g: (e.color && e.color.g) || 0, b: (e.color && e.color.b) || 0, a: (e.color && e.color.a !== undefined ? e.color.a : 0.25) },
    visible:   true,
    blendMode: 'NORMAL',
  }));
}

function clamp(v) { return Math.max(0, Math.min(1, v || 0)); }
