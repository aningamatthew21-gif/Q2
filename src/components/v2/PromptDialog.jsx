import React, { createContext, useContext, useCallback, useRef, useState } from 'react';
import Dialog from './Dialog';
import Button from './Button';

/**
 * PromptDialog system — replacement for the native `window.prompt()` and
 * `window.confirm()` calls scattered across the app.
 *
 * Native prompts look like the browser-chrome alert in the user's screenshot
 * ("localhost:5173 says…") and break the Fluent 2 visual language. They also
 * can't accept multi-line text, validation, or rich confirmation copy.
 *
 * Usage — wrap your tree once:
 *   <PromptProvider>...</PromptProvider>     // mounted at the AppContext root
 *
 * Then call from any component via the hook:
 *   const { askText, askConfirm } = usePrompt();
 *
 *   const reason = await askText({
 *     title:       'Reject invoice INV-2026-0118',
 *     description: 'Tell the salesperson what to change. They will see this exact message in their My Invoices view.',
 *     label:       'Reason for rejection',
 *     placeholder: 'e.g. price mismatch on line 2…',
 *     multiline:   true,
 *     required:    true,
 *     confirmLabel:'Reject invoice',
 *     confirmTone: 'danger'
 *   });
 *   if (reason === null) return;       // user cancelled
 *
 *   const ok = await askConfirm({
 *     title:        'Mark PR-2026-0004 as fulfilled?',
 *     description:  'This confirms the item has been received. The action cannot be undone from the UI.',
 *     confirmLabel: 'Mark fulfilled',
 *     confirmTone:  'primary'
 *   });
 *
 * Where the reason "goes":
 *   - The text the user types is returned to the caller, who passes it to
 *     the existing /api endpoint (e.g. POST /invoices/:id/reject).
 *   - The backend persists it on the entity (invoice.rejectionReason,
 *     pr.cancelReason, rfq.rejectionReason). The next user opening that
 *     entity sees it in the history / activity panel rendered by the
 *     respective detail page (already wired today).
 *   - The activity-log entry also captures the reason via logActivity().
 */

/* ────────────────────────────────────────────────────────────────── */

const PromptCtx = createContext(null);
export const usePrompt = () => {
  const ctx = useContext(PromptCtx);
  if (!ctx) throw new Error('usePrompt() must be used inside <PromptProvider>');
  return ctx;
};

/* ────────────────────────────────────────────────────────────────── */

export function PromptProvider({ children }) {
  const [config, setConfig] = useState(null);   // { kind, ...opts }
  const [value,  setValue]  = useState('');
  const [error,  setError]  = useState(null);
  const resolverRef = useRef(null);

  const close = useCallback((result) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setConfig(null);
    setValue('');
    setError(null);
  }, []);

  const askText = useCallback((opts = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setValue(opts.defaultValue ?? '');
      setError(null);
      setConfig({ kind: 'text', ...opts });
    });
  }, []);

  const askConfirm = useCallback((opts = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setError(null);
      setConfig({ kind: 'confirm', ...opts });
    });
  }, []);

  const askChoice = useCallback((opts = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setValue(opts.defaultValue ?? opts.choices?.[0]?.value ?? '');
      setError(null);
      setConfig({ kind: 'choice', ...opts });
    });
  }, []);

  const onCancel  = () => close(config?.kind === 'confirm' ? false : null);
  const onConfirm = () => {
    if (!config) return;
    if (config.kind === 'confirm') return close(true);
    const trimmed = String(value ?? '').trim();
    if (config.required && !trimmed) {
      setError(config.requiredMessage || 'This field is required.');
      return;
    }
    if (config.validate) {
      const v = config.validate(value);
      if (v) { setError(v); return; }
    }
    close(value);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && (config?.kind === 'confirm' || (config?.kind !== 'confirm' && !config?.multiline))) {
      e.preventDefault();
      onConfirm();
    }
  };

  return (
    <PromptCtx.Provider value={{ askText, askConfirm, askChoice }}>
      {children}
      <Dialog
        open={!!config}
        onClose={onCancel}
        size="sm"
        title={config?.title}
        description={config?.description}
        footer={
          <>
            <Button variant="ghost"   onClick={onCancel}>{config?.cancelLabel || 'Cancel'}</Button>
            <Button
              variant={config?.confirmTone === 'danger' ? 'danger' : 'primary'}
              onClick={onConfirm}
              disabled={config?.kind === 'text' && config?.required && !String(value ?? '').trim()}
            >{config?.confirmLabel || (config?.kind === 'confirm' ? 'Confirm' : 'OK')}</Button>
          </>
        }
      >
        {config?.kind === 'text' && (
          <div className="space-y-2">
            {config.label && (
              <label className="block text-[12px] font-semibold text-n-700">
                {config.label}{config.required && <span className="text-err"> *</span>}
              </label>
            )}
            {config.multiline ? (
              <textarea
                autoFocus
                value={value}
                onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
                onKeyDown={onKeyDown}
                placeholder={config.placeholder}
                rows={config.rows ?? 4}
                maxLength={config.maxLength}
                className="w-full px-3 py-2 text-[13px] bg-white dark:bg-n-50 border border-n-300 rounded-md text-n-800 placeholder:text-n-400 focus:outline-none focus:border-accent focus:shadow-focus transition-colors resize-y"
              />
            ) : (
              <input
                autoFocus
                type={config.inputType || 'text'}
                value={value}
                onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
                onKeyDown={onKeyDown}
                placeholder={config.placeholder}
                maxLength={config.maxLength}
                className="w-full h-9 px-3 text-[13px] bg-white dark:bg-n-50 border border-n-300 rounded-md text-n-800 placeholder:text-n-400 focus:outline-none focus:border-accent focus:shadow-focus transition-colors"
              />
            )}
            {error && (
              <div className="text-[12px] text-err bg-err-soft border border-err/30 px-2.5 py-1.5 rounded-md">{error}</div>
            )}
            {config.helperText && !error && (
              <div className="text-[11.5px] text-n-500">{config.helperText}</div>
            )}
            {config.maxLength && (
              <div className="text-[10.5px] text-n-400 text-right">{(value ?? '').length} / {config.maxLength}</div>
            )}
          </div>
        )}
        {config?.kind === 'choice' && (
          <div className="space-y-2">
            {(config.choices || []).map((c) => (
              <label key={c.value} className="flex items-start gap-3 px-3 py-2 border border-n-200 rounded-md cursor-pointer hover:bg-n-50">
                <input
                  type="radio"
                  name="prompt-choice"
                  className="mt-0.5"
                  checked={value === c.value}
                  onChange={() => setValue(c.value)}
                />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-n-800">{c.label}</div>
                  {c.hint && <div className="text-xs text-n-500">{c.hint}</div>}
                </div>
              </label>
            ))}
          </div>
        )}
      </Dialog>
    </PromptCtx.Provider>
  );
}
