import React, { useState, useCallback } from 'react';
import api from '../api';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
import Icon from '../components/common/Icon';
import Card from '../components/v2/Card';
import ErrorScreen from '../components/v2/ErrorScreen';
import Label from '../components/v2/Label';
import { useApiCall } from '../hooks/useApiCall';
import { useApp } from '../context/AppContext';

/**
 * NumberingSettings — admin/finance-head editor for the standardized
 * document numbering policy.
 *
 * Standards anchor:
 *   - ISO/IEC 27001:2022 A.8.32 (Change Management) — every edit goes
 *     through the existing auditMiddleware (PUT → QA_AUDIT_LOGS)
 *   - SAP "Number Range Maintenance" pattern — read-mostly, edit-rarely
 *   - ISO/IEC 25010 Usability — preview shows "Next number will be: X"
 *     so the admin sees the effect of their edits before saving
 *
 * Permission: system.number_sequences.edit (admin + finance_head).
 *
 * Layout:
 *   One card per doc type (INV / PR / RFQ / GR / MEMO). Each card lets
 *   the admin edit prefix, padding (1-10), reset frequency. The current
 *   counter and last reset period are read-only (only the generator
 *   mutates the counter — preventing duplicate-number accidents).
 */
const RESET_PERIOD_OPTIONS = [
  { value: 'MONTHLY', label: 'Monthly (resets each month — recommended)', sample: 'MIDSA-INV-05-2026-00001' },
  { value: 'YEARLY',  label: 'Yearly (resets each January)',               sample: 'MIDSA-INV-2026-00001'    },
  { value: 'NEVER',   label: 'Never (counter just keeps growing)',         sample: 'MIDSA-INV-00001'         }
];

const DOC_TYPE_DESCRIPTIONS = {
  INV:  { label: 'Invoices',         icon: 'file-text', hint: 'Sales invoices minted on approval by Finance Head.' },
  PR:   { label: 'Purchase Requisitions', icon: 'clipboard-list', hint: 'PRs created by procurement officers.' },
  RFQ:  { label: 'Requests for Quotation', icon: 'file-question', hint: 'RFQs sent to vendors.' },
  GR:   { label: 'Goods Receipts',   icon: 'package-check', hint: 'Receipts logged when goods arrive at the warehouse.' },
  MEMO: { label: 'Credit Memos',     icon: 'file-minus', hint: 'Reversal documents (future feature — placeholder).' }
};

const NumberingSettings = ({ navigateTo }) => {
  const { appUser } = useApp();
  const { data, error, loading, retry } = useApiCall(() => api.get('/number-sequences'), []);
  const [savingId, setSavingId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [drafts, setDrafts] = useState({});

  // Auto-dismiss the toast
  React.useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const rows = data?.data?.data || data?.data || [];

  // Local draft state per row keyed by DOC_TYPE
  const draftFor = useCallback((docType) => {
    if (drafts[docType]) return drafts[docType];
    const row = rows.find(r => r.DOC_TYPE === docType);
    return row ? { prefix: row.PREFIX, docCode: row.DOC_CODE, padding: row.PADDING, resetPeriod: row.RESET_PERIOD } : null;
  }, [drafts, rows]);

  const setDraft = (docType, patch) => {
    setDrafts(d => ({ ...d, [docType]: { ...draftFor(docType), ...patch } }));
  };

  const hasUnsaved = (row) => {
    const draft = drafts[row.DOC_TYPE];
    if (!draft) return false;
    return draft.prefix !== row.PREFIX
        || draft.docCode !== row.DOC_CODE
        || Number(draft.padding) !== Number(row.PADDING)
        || draft.resetPeriod !== row.RESET_PERIOD;
  };

  const handleSave = async (docType) => {
    const payload = drafts[docType];
    if (!payload) return;
    setSavingId(docType);
    try {
      await api.put(`/number-sequences/${docType}`, payload);
      setDrafts(d => { const next = { ...d }; delete next[docType]; return next; });
      setNotice({ type: 'success', message: `${docType} numbering saved. Effective on next document.` });
      retry();
    } catch (err) {
      const detail = err?.response?.data?.error?.message || err?.response?.data?.error || err?.message || 'Save failed.';
      setNotice({ type: 'error', message: `${docType} save failed — ${detail}` });
    } finally {
      setSavingId(null);
    }
  };

  const handleReset = (docType) => {
    setDrafts(d => { const next = { ...d }; delete next[docType]; return next; });
  };

  return (
    <>
      <PageHeader
        title="Numbering Settings"
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigateTo('controllerDashboard')} leftIcon={<Icon id="arrow-left" />}>
            Back
          </Button>
        }
      />

      {/* Lead-in explanation — auditor friendly */}
      <Card className="mb-4">
        <div className="p-4 text-sm text-n-700">
          <div className="font-semibold text-n-800 mb-1 flex items-center gap-2">
            <Icon id="info-circle" className="text-blue-600" />
            How document numbering works
          </div>
          <p>
            Every new document (Invoice, PR, RFQ, Goods Receipt, Memo) gets an ID built from:
            <code className="mx-1 bg-n-100 px-1.5 py-0.5 rounded text-[12px]">{'{PREFIX}-{DOC}-{PERIOD}-{NNNNN}'}</code>
            For example, <code className="bg-n-100 px-1.5 py-0.5 rounded text-[12px]">MIDSA-INV-05-2026-00123</code>.
          </p>
          <p className="mt-2">
            Edits here take effect on the <strong>next</strong> document of that type — existing documents keep their original IDs.
            The counter is auto-managed by the system and can't be edited directly (that prevents duplicate-number accidents).
            Changes are audit-logged to <code className="bg-n-100 px-1.5 py-0.5 rounded text-[12px]">QA_AUDIT_LOGS</code> per ISO 27001 A.8.32.
          </p>
        </div>
      </Card>

      {/* Notification */}
      {notice && (
        <div
          role={notice.type === 'error' ? 'alert' : 'status'}
          aria-live={notice.type === 'error' ? 'assertive' : 'polite'}
          className={`mb-4 p-3 rounded border text-sm flex items-center justify-between ${
            notice.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <span className="flex items-center gap-2">
            <Icon id={notice.type === 'error' ? 'alert-circle' : 'check-circle'} className="w-4 h-4" />
            {notice.message}
          </span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="text-current opacity-60 hover:opacity-100">×</button>
        </div>
      )}

      {loading && !rows.length ? (
        <ErrorScreen variant="loading" compact />
      ) : error ? (
        <ErrorScreen
          variant={error.archetype}
          title="Couldn't load numbering policy"
          detail={error.message}
          actions={[{ label: 'Retry', tone: 'primary', onClick: retry, icon: 'rotate-cw' }]}
          requestId={error.requestId}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {rows.map(row => {
            const draft = draftFor(row.DOC_TYPE);
            const unsaved = hasUnsaved(row);
            const meta = DOC_TYPE_DESCRIPTIONS[row.DOC_TYPE] || { label: row.DOC_TYPE, icon: 'file', hint: '' };
            const previewSample = buildPreview(draft || row, row.CURRENT_COUNTER);

            return (
              <Card key={row.DOC_TYPE} className="overflow-visible">
                <div className="px-4 py-3 border-b border-n-200 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 min-w-0">
                    <Icon id={meta.icon} className="text-n-600 mt-0.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-n-800">{meta.label}</div>
                      <div className="text-xs text-n-500 mt-0.5">{meta.hint}</div>
                    </div>
                  </div>
                  {unsaved && <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">Unsaved</span>}
                </div>

                <div className="p-4 space-y-3">
                  {/* Prefix */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="block text-xs font-medium text-n-700 mb-1" required>Prefix</Label>
                      <input
                        type="text"
                        value={draft?.prefix || ''}
                        onChange={(e) => setDraft(row.DOC_TYPE, { prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })}
                        placeholder="MIDSA"
                        maxLength={20}
                        className="w-full p-2 text-sm border border-gray-300 rounded font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <Label className="block text-xs font-medium text-n-700 mb-1" required>Doc Code</Label>
                      <input
                        type="text"
                        value={draft?.docCode || ''}
                        onChange={(e) => setDraft(row.DOC_TYPE, { docCode: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })}
                        placeholder={row.DOC_TYPE}
                        maxLength={20}
                        className="w-full p-2 text-sm border border-gray-300 rounded font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {/* Padding + Reset */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="block text-xs font-medium text-n-700 mb-1" required>Counter padding (digits)</Label>
                      <input
                        type="number"
                        min={1} max={10}
                        value={draft?.padding ?? 5}
                        onChange={(e) => setDraft(row.DOC_TYPE, { padding: Number(e.target.value) })}
                        className="w-full p-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <Label className="block text-xs font-medium text-n-700 mb-1" required>Reset frequency</Label>
                      <select
                        value={draft?.resetPeriod || 'MONTHLY'}
                        onChange={(e) => setDraft(row.DOC_TYPE, { resetPeriod: e.target.value })}
                        className="w-full p-2 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {RESET_PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label.split(' (')[0]}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Live preview */}
                  <div className="border-t border-n-100 pt-3">
                    <div className="text-[11px] uppercase tracking-wide font-semibold text-n-500 mb-1">Next number will be</div>
                    <div className="font-mono text-sm text-n-900 bg-n-50 border border-n-200 rounded p-2.5 select-all">
                      {previewSample}
                    </div>
                    <div className="text-[11px] text-n-500 mt-1.5 flex justify-between">
                      <span>Current counter: <strong>{row.CURRENT_COUNTER}</strong></span>
                      <span>Period in use: <strong>{row.CURRENT_PERIOD_KEY || '—'}</strong></span>
                    </div>
                  </div>

                  {/* Actions */}
                  {unsaved && (
                    <div className="flex justify-end gap-2 pt-2 border-t border-n-100">
                      <Button variant="ghost" size="sm" onClick={() => handleReset(row.DOC_TYPE)} disabled={savingId === row.DOC_TYPE}>
                        Discard
                      </Button>
                      <Button variant="primary" size="sm" onClick={() => handleSave(row.DOC_TYPE)} disabled={savingId === row.DOC_TYPE} leftIcon={<Icon id="check" />}>
                        {savingId === row.DOC_TYPE ? 'Saving…' : 'Save'}
                      </Button>
                    </div>
                  )}

                  {/* Last edit attribution (audit-trail visibility) */}
                  {row.UPDATED_BY && (
                    <div className="text-[10px] text-n-400 pt-1 border-t border-n-100">
                      Last updated by <span className="font-mono">{row.UPDATED_BY}</span>
                      {row.UPDATED_AT && ` at ${new Date(row.UPDATED_AT).toISOString().slice(0, 19).replace('T', ' ')}`}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
};

/**
 * Build the local preview string for the next number based on the
 * CURRENT draft values (so the admin sees the effect of edits live,
 * even before saving). Mirrors backend/utils/numberGenerator.js logic.
 */
function buildPreview(draft, currentCounter) {
  if (!draft) return '—';
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  let period = '';
  if (draft.resetPeriod === 'MONTHLY') period = `${mm}-${yyyy}-`;
  else if (draft.resetPeriod === 'YEARLY') period = `${yyyy}-`;
  const next = Number(currentCounter || 0) + 1;
  const padded = String(next).padStart(Number(draft.padding) || 5, '0');
  return `${draft.prefix || 'PREFIX'}-${draft.docCode || 'DOC'}-${period}${padded}`;
}

export default NumberingSettings;
