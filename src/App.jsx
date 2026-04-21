import React, { useState, useCallback, useRef } from 'react';
import DropZone from './components/DropZone';
import HtmlPreview from './components/HtmlPreview';
import JsonOutput from './components/JsonOutput';
import { Layers, ExternalLink } from 'lucide-react';

// Import the official @builder.io/html-to-figma browser script as a raw string.
// This is the SAME script the Builder.io Chrome Extension uses to capture pages,
// so its output is guaranteed to match the builder.json format the Figma plugin expects.
import builderBrowserJs from '@builder.io/html-to-figma/browser?raw';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Wait for all images in an iframe document to finish loading. */
function waitForImages(doc, timeout = 6000) {
  return new Promise(resolve => {
    const imgs = Array.from(doc.querySelectorAll('img')).filter(i => !i.complete);
    if (!imgs.length) return resolve();
    let pending = imgs.length;
    const timer = setTimeout(resolve, timeout);
    const done = () => { if (--pending <= 0) { clearTimeout(timer); resolve(); } };
    imgs.forEach(img => {
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  });
}

/** Run htmlToFigma inside the iframe via injected scripts and collect the result. */
function runHtmlToFigmaInIframe(iframe) {
  return new Promise((resolve, reject) => {
    const CHANNEL = '__h2f_' + Date.now();
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error('Conversion timed out (30 s). The HTML may be too complex.'));
    }, 30000);

    function handler(evt) {
      if (evt.source !== iframe.contentWindow) return;
      if (!evt.data || evt.data.__channel !== CHANNEL) return;
      clearTimeout(timeout);
      window.removeEventListener('message', handler);
      if (evt.data.error) return reject(new Error(evt.data.error));
      resolve(evt.data.layers);
    }
    window.addEventListener('message', handler);

    // 1. Inject the official Builder.io browser library
    const libScript = iframe.contentDocument.createElement('script');
    libScript.textContent = builderBrowserJs;
    iframe.contentDocument.head.appendChild(libScript);

    // 2. Inject a runner that calls htmlToFigma and posts the result back.
    //    htmlToFigma is exposed as window.htmlToFigma.htmlToFigma by the library.
    //    useFrames=true  → produces a nested tree (one root FRAME with children).
    //    useFrames=false → produces a flat array (Builder.io Chrome Extension default).
    const runScript = iframe.contentDocument.createElement('script');
    runScript.textContent = `
      (function() {
        var CHANNEL = ${JSON.stringify(CHANNEL)};
        try {
          // The library exposes: window.htmlToFigma = { htmlToFigma: fn }
          var layers = window.htmlToFigma.htmlToFigma(document.body, true, false);
          // Safely serialise (removes any residual DOM refs)
          var serialised = JSON.parse(JSON.stringify(layers));
          window.parent.postMessage({ __channel: CHANNEL, layers: serialised }, '*');
        } catch(e) {
          window.parent.postMessage({ __channel: CHANNEL, error: e.message }, '*');
        }
      })();
    `;
    iframe.contentDocument.body.appendChild(runScript);
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function App() {
  const [htmlContent, setHtmlContent] = useState('');
  const [fileName, setFileName]       = useState('');
  const [figmaJson, setFigmaJson]     = useState('');
  const [status, setStatus]           = useState('idle');
  const [error, setError]             = useState('');
  const iframeRef = useRef(null);

  const processHtml = useCallback(async (html) => {
    setStatus('loading');
    setError('');
    setFigmaJson('');

    if (iframeRef.current) {
      document.body.removeChild(iframeRef.current);
      iframeRef.current = null;
    }

    const iframe = document.createElement('iframe');
    // Hidden, wide enough to match a typical desktop viewport
    iframe.style.cssText =
      'position:fixed;left:-9999px;top:-9999px;width:1440px;height:900px;border:none;pointer-events:none;';
    document.body.appendChild(iframe);
    iframeRef.current = iframe;

    try {
      // Load the HTML into the iframe
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Iframe load timed out (15 s)')), 15000);
        iframe.addEventListener('load', () => { clearTimeout(t); resolve(); }, { once: true });
        iframe.srcdoc = html;
      });

      // Let images finish loading so getBoundingClientRect is accurate
      await waitForImages(iframe.contentDocument);

      // Run the official Builder.io htmlToFigma library inside the iframe
      const layers = await runHtmlToFigmaInIframe(iframe);

      if (!layers || layers.length === 0) {
        throw new Error('No visible elements found. Make sure the HTML file has visible content.');
      }

      // builder.json format: { layers: [...], images: {} }
      // This exactly matches the format the Builder.io Chrome Extension produces,
      // which is what "upload a builder.json file" in the Figma plugin expects.
      const builderJson = { layers, images: {} };
      setFigmaJson(JSON.stringify(builderJson, null, 2));
      setStatus('success');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    } finally {
      if (iframeRef.current) {
        document.body.removeChild(iframeRef.current);
        iframeRef.current = null;
      }
    }
  }, []);

  const handleFileDrop = useCallback((file) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const html = e.target.result;
      setHtmlContent(html);
      processHtml(html);
    };
    reader.readAsText(file);
  }, [processHtml]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0">
              <Layers className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-white leading-tight">HTML → Figma Converter</h1>
              <p className="text-xs text-slate-500">Generates builder.json compatible with Builder.io Figma plugin</p>
            </div>
          </div>
          <a
            href="https://www.figma.com/community/plugin/747985167520967365"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            Builder.io plugin <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <div className="space-y-5">
            <DropZone onFileDrop={handleFileDrop} fileName={fileName} />
            {htmlContent && <HtmlPreview html={htmlContent} />}
          </div>
          <JsonOutput json={figmaJson} status={status} error={error} />
        </div>

        {!htmlContent && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
            {[
              { step: '01', title: 'Drop HTML File', desc: 'Drag & drop your .html file into the upload zone' },
              { step: '02', title: 'Auto Convert', desc: 'App renders the HTML with official Builder.io library' },
              { step: '03', title: 'Download JSON', desc: 'Click "Download" to save the file as builder.json' },
              { step: '04', title: 'Import to Figma', desc: 'Builder.io plugin → Import tab → upload a builder.json file' },
            ].map(({ step, title, desc }) => (
              <div key={step} className="bg-slate-900 rounded-xl p-4 border border-slate-800/80">
                <div className="text-indigo-400 text-xs font-mono font-bold mb-2">{step}</div>
                <div className="text-sm font-medium text-white mb-1">{title}</div>
                <div className="text-xs text-slate-500 leading-relaxed">{desc}</div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
