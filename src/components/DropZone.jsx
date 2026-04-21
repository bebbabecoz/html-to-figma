import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileCode } from 'lucide-react';

export default function DropZone({ onFileDrop, fileName }) {
  const onDrop = useCallback((accepted) => {
    if (accepted.length > 0) onFileDrop(accepted[0]);
  }, [onFileDrop]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/html': ['.html', '.htm'] },
    maxFiles: 1,
  });

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-300">Upload HTML File</label>
      <div
        {...getRootProps()}
        className={[
          'relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200',
          isDragActive
            ? 'border-indigo-400 bg-indigo-500/10'
            : 'border-slate-700 hover:border-slate-500 hover:bg-slate-900/50',
        ].join(' ')}
      >
        <input {...getInputProps()} />
        {fileName ? (
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
              <FileCode className="w-5 h-5 text-indigo-400" />
            </div>
            <span className="text-sm font-medium text-slate-200">{fileName}</span>
            <span className="text-xs text-slate-500">Drop a new file to replace</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${isDragActive ? 'bg-indigo-500/20' : 'bg-slate-800'}`}>
              <Upload className={`w-6 h-6 ${isDragActive ? 'text-indigo-400' : 'text-slate-400'}`} />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">
                {isDragActive ? 'Release to upload' : 'Drop your HTML file here'}
              </p>
              <p className="text-xs text-slate-500 mt-1">or click to browse — .html, .htm only</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
