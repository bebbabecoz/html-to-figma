import React, { useState } from 'react';
import { Code2, Eye } from 'lucide-react';

export default function HtmlPreview({ html }) {
  const [view, setView] = useState('source');

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-slate-300">HTML Content</label>
        <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs">
          {[
            { id: 'source', icon: <Code2 className="w-3 h-3" />, label: 'Source' },
            { id: 'render', icon: <Eye className="w-3 h-3" />, label: 'Render' },
          ].map(({ id, icon, label }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`px-3 py-1.5 flex items-center gap-1.5 transition-colors ${view === id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {icon} {label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 overflow-hidden h-56">
        {view === 'source' ? (
          <pre className="p-4 text-xs text-slate-300 font-mono overflow-auto h-full bg-slate-900 leading-relaxed whitespace-pre-wrap">
            {html.length > 8000 ? html.slice(0, 8000) + '\n\n… (truncated)' : html}
          </pre>
        ) : (
          <iframe
            srcDoc={html}
            sandbox="allow-same-origin"
            className="w-full h-full bg-white"
            title="HTML Render Preview"
          />
        )}
      </div>
    </div>
  );
}
