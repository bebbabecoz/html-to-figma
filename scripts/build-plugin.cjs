// Inlines browser.js content into figma-plugin/ui.html
// Run: node scripts/build-plugin.js

const fs   = require('fs');
const path = require('path');

const root      = path.join(__dirname, '..');
const browserJs = fs.readFileSync(path.join(root, 'node_modules/@builder.io/html-to-figma/dist/browser.js'), 'utf8');
const uiSrc     = fs.readFileSync(path.join(root, 'figma-plugin/ui.html'), 'utf8');

const injected = uiSrc.replace(
  '/* __BROWSER_JS_SRC__ */',
  'var BROWSER_JS_SRC = ' + JSON.stringify(browserJs) + ';'
);

if (injected === uiSrc) {
  console.error('ERROR: placeholder /* __BROWSER_JS_SRC__ */ not found in ui.html');
  process.exit(1);
}

fs.writeFileSync(path.join(root, 'figma-plugin/ui.html'), injected);
console.log('✅ figma-plugin/ui.html built — browser.js inlined (' + Math.round(browserJs.length / 1024) + ' KB)');
