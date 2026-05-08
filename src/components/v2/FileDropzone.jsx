import React, { useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, X, FileText, Image as ImageIcon, FileQuestion } from 'lucide-react';
import clsx from 'clsx';

/**
 * FileDropzone — Fluent 2 drag-drop file input with thumbnails.
 *
 *   const [files, setFiles] = useState([]);
 *   <FileDropzone
 *     value={files}
 *     onChange={setFiles}
 *     accept="application/pdf,image/*"
 *     multiple
 *     maxFileSizeMB={10}
 *     hint="Attach the vendor's signed RFQ + any quotation documents"
 *   />
 *
 * Files come through `onChange` as an array of:
 *   { name, type, size, dataUrl, file }
 *
 * `dataUrl` is a base64 representation so callers can ship the bytes
 * via JSON in the existing /api/* endpoints. `file` is the original
 * File object for callers that need streamed uploads.
 *
 * Image files render a real preview thumbnail; PDFs / other docs show
 * a tinted file-type icon. Each thumbnail has a remove button.
 */

const ICON_BY_KIND = {
  image: ImageIcon,
  pdf:   FileText,
  other: FileQuestion
};

function kindFor(file) {
  if (file.type?.startsWith('image/')) return 'image';
  if (file.type === 'application/pdf') return 'pdf';
  return 'other';
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export default function FileDropzone({
  value = [],
  onChange,
  accept = '*/*',
  multiple = true,
  maxFileSizeMB = 10,
  hint,
  required = false,
  disabled = false,
  className = ''
}) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError]       = useState(null);

  const ingest = useCallback(async (incoming) => {
    if (disabled) return;
    setError(null);
    const list = Array.from(incoming || []);
    if (list.length === 0) return;

    const accepted = [];
    for (const f of list) {
      if (f.size > maxFileSizeMB * 1024 * 1024) {
        setError(`"${f.name}" is larger than ${maxFileSizeMB}MB and was skipped.`);
        continue;
      }
      try {
        const dataUrl = await readAsDataUrl(f);
        accepted.push({ name: f.name, type: f.type, size: f.size, dataUrl, file: f });
      } catch (e) {
        setError(`Could not read "${f.name}".`);
      }
    }
    onChange?.(multiple ? [...value, ...accepted] : accepted.slice(0, 1));
  }, [disabled, maxFileSizeMB, multiple, onChange, value]);

  const onDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    setDragOver(false);
    ingest(e.dataTransfer?.files);
  };

  const onDragOver = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!dragOver) setDragOver(true);
  };

  const onDragLeave = (e) => {
    e.preventDefault(); e.stopPropagation();
    setDragOver(false);
  };

  const removeAt = (idx) => {
    onChange?.(value.filter((_, i) => i !== idx));
  };

  const onPick = () => { if (!disabled) inputRef.current?.click(); };

  const isInvalid = required && value.length === 0;

  return (
    <div className={className}>
      <div
        role="button"
        tabIndex={0}
        onClick={onPick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={clsx(
          'relative w-full rounded-card border border-dashed transition-colors',
          'flex flex-col items-center justify-center text-center px-4 py-6 cursor-pointer',
          dragOver
            ? 'border-accent bg-accent-soft'
            : isInvalid
              ? 'border-err/60 bg-err-soft/40 hover:bg-err-soft/60'
              : 'border-n-300 bg-n-50 hover:bg-n-100',
          disabled && 'opacity-60 cursor-not-allowed'
        )}
      >
        <span className={clsx(
          'w-10 h-10 rounded-full grid place-items-center mb-2',
          dragOver ? 'bg-accent text-white' : 'bg-n-100 text-n-500'
        )}>
          <Upload className="w-4 h-4" />
        </span>
        <div className="text-[13px] font-medium text-n-800">
          {dragOver
            ? 'Drop to attach'
            : (multiple ? 'Drag files here, or click to browse' : 'Drag a file here, or click to browse')}
        </div>
        {hint && <div className="text-[11.5px] text-n-500 mt-1 max-w-md">{hint}</div>}
        <div className="text-[10.5px] text-n-400 mt-1.5">
          {accept === '*/*' ? 'Any file' : accept.replace(/,/g, ', ')} · max {maxFileSizeMB}MB each
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={(e) => { ingest(e.target.files); e.target.value = ''; }}
        />
      </div>

      {error && (
        <div className="mt-2 text-[12px] text-err bg-err-soft border border-err/30 px-2.5 py-1.5 rounded-md">{error}</div>
      )}

      {value.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          <AnimatePresence initial={false}>
            {value.map((f, idx) => {
              const k    = kindFor(f);
              const Icon = ICON_BY_KIND[k];
              return (
                <motion.li
                  key={f.name + idx + f.size}
                  layout
                  initial={{ opacity: 0, y: 4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{    opacity: 0, y: -4, scale: 0.96 }}
                  transition={{ duration: 0.18 }}
                  className="relative bg-white border border-n-200 rounded-md p-2 flex items-center gap-2"
                >
                  <span className="w-10 h-10 rounded-md bg-n-100 grid place-items-center flex-shrink-0 overflow-hidden">
                    {k === 'image' && f.dataUrl
                      ? <img src={f.dataUrl} alt={f.name} className="w-full h-full object-cover" />
                      : <Icon className="w-4 h-4 text-n-500" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium text-n-800 truncate" title={f.name}>{f.name}</div>
                    <div className="text-[10.5px] text-n-500">{fmtSize(f.size)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeAt(idx); }}
                    className="w-6 h-6 grid place-items-center rounded-md text-n-500 hover:bg-n-100 hover:text-err"
                    aria-label={`Remove ${f.name}`}
                  ><X className="w-3.5 h-3.5" /></button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}

      {required && (
        <div className={clsx('mt-2 text-[11.5px]', value.length === 0 ? 'text-err' : 'text-n-500')}>
          {value.length === 0
            ? 'At least one attachment is required.'
            : `${value.length} attachment${value.length === 1 ? '' : 's'} ready.`}
        </div>
      )}
    </div>
  );
}
