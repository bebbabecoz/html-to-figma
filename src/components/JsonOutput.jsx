import React, { useState } from 'react';
import { Copy, Check, AlertCircle, Loader2, FileJson, Download } from 'lucide-react';

export default function JsonOutput({ json, status, error }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'builder.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const lineCount = json ? json.split('\n').length : 0;

  return (
    <div className="space-y-2 flex flex-col h-full">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-slate-300">Figma JSON Output</label>
        {json && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-colors"
            >
              <Download className="w-3 h-3" /> Download
            </button>
            <button
              onClick={handleCopy}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                copied
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/30'
              }`}
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied!' : 'Copy to Clipboard'}
            </button>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-800 overflow-hidden flex-1 flex flex-col min-h-96">
        {status === 'idle' && (
          <div className="flex flex-col items-center justify-center flex-1 text-slate-700 gap-3 py-16">
            <FileJson className="w-10 h-10" />
            <p className="text-sm">Upload an HTML file to generate Figma JSON</p>
          </div>
        )}

        {status === 'loading' && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 py-16">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
            <p className="text-sm text-slate-400">Converting HTML to Figma JSON…</p>
            <p className="text-xs text-slate-600">Sandboxing, rendering, extracting computed styles…</p>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 py-16 px-8 text-center">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <p className="text-sm text-red-400 font-medium">Conversion Failed</p>
            <p className="text-xs text-slate-500 max-w-xs">{error}</p>
          </div>
        )}

        {status === 'success' && json && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2 bg-slate-900 border-b border-slate-800 text-xs text-slate-500 shrink-0">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Conversion successful — {lineCount} lines</span>
            </div>
            <pre className="p-4 text-xs text-slate-300 font-mono overflow-auto flex-1 bg-slate-950 leading-relaxed">
              {json}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
