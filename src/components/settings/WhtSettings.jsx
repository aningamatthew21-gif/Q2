/**
 * WhtSettings — withholding-tax types CRUD.
 *
 * Lives inside System Settings → Withholding Taxes tab. Backend routes
 * already exist (`/api/wht/types`) so this is pure UI on top.
 *
 * Mirrors the look of the existing Tax Configuration tab so finance
 * recognises the pattern without retraining. Stage all edits client-
 * side, persist on "Save Changes" — same UX as the VAT/NHIL grid above.
 *
 * Permissions: rendered only when `currentUser` has `wht.config.edit`
 * (gated in TaxSettings.jsx). Backend re-checks on every save.
 */

import React, { useEffect, useState } from 'react';
import api from '../../api';
import Icon from '../common/Icon';
import Notification from '../common/Notification';
import { usePrompt } from '../v2/PromptDialog';

// "Calculated on" options — kept word-for-word aligned with the Tax & Rates
// tab so finance reads the same vocabulary across both screens.
const APPLIES_TO_OPTIONS = [
    { value: 'subtotal', label: 'Taxable amount only (no cascade)' },
    { value: 'gross',    label: 'Cascade — subtotal + VAT' }
];

// Generate a stable per-row id so the React key doesn't change when the
// user edits the Code field (which caused the input to remount and steal
// focus after the first keystroke).
const newRid = () => `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const WhtSettings = () => {
    const { askConfirm } = usePrompt();
    const [whtTypes, setWhtTypes] = useState([]);
    const [originalCodes, setOriginalCodes] = useState(new Set());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [notification, setNotification] = useState(null);

    const fetchWhtTypes = async () => {
        setLoading(true);
        try {
            const res = await api.get('/wht/types');
            if (res?.success) {
                const rows = (res.data || []).map(r => ({ ...r, __rid: r.code || newRid() }));
                setWhtTypes(rows);
                setOriginalCodes(new Set(rows.map(r => r.code).filter(Boolean)));
            }
        } catch (err) {
            console.error('Failed to load WHT types:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchWhtTypes(); }, []);

    const handleChange = (idx, field, value) => {
        setWhtTypes(rows => rows.map((r, i) => {
            if (i !== idx) return r;
            if (field === 'rate') {
                let num = parseFloat(value);
                if (isNaN(num) || num < 0) num = 0;
                return { ...r, rate: num };
            }
            if (field === 'code') {
                return { ...r, code: String(value).toUpperCase().replace(/[^A-Z0-9_]/g, '') };
            }
            return { ...r, [field]: value };
        }));
    };

    const handleAdd = () => {
        setWhtTypes(rows => [
            ...rows,
            {
                __rid:     newRid(),   // stable React key — lets the user type
                                       // a multi-char Code without remounts
                                       // stealing focus mid-keystroke
                code:      '',
                name:      '',
                rate:      0,
                appliesTo: 'subtotal',
                isActive:  true,
                sortOrder: (rows.length + 1) * 10,
                __new:     true        // UI marker for differential save
            }
        ]);
    };

    const handleDelete = async (idx) => {
        const row = whtTypes[idx];
        // New (unsaved) row → just drop from the staged array. No backend call.
        if (row.__new) {
            const ok = await askConfirm({
                title:        `Remove this new WHT row?`,
                description:  'This row was added in this session — removing it has no effect on saved data.',
                confirmLabel: 'Remove',
                confirmTone:  'danger'
            });
            if (!ok) return;
            setWhtTypes(rows => rows.filter((_, i) => i !== idx));
            return;
        }

        // Persisted row → call DELETE. Backend tries a hard delete first;
        // if any payment references this code it returns 409 and we offer
        // the soft-delete (deactivate) fallback in the same dialog.
        const ok = await askConfirm({
            title:        `Delete WHT "${row.code}"?`,
            description:  'Permanently removes the WHT from the catalogue. If any past payment has used this code the server will block the delete and offer to deactivate it instead (which keeps history intact and hides it from new dropdowns).',
            confirmLabel: 'Delete',
            confirmTone:  'danger'
        });
        if (!ok) return;

        try {
            const res = await api.delete(`/wht/types/${row.code}`);
            if (res?.success) {
                setNotification({ type: 'success', message: `WHT "${row.code}" deleted.` });
                fetchWhtTypes();
            } else {
                setNotification({ type: 'error', message: res?.error || 'Could not delete.' });
            }
        } catch (err) {
            const status = err?.response?.status;
            const code   = err?.response?.data?.code;
            const msg    = err?.response?.data?.error || err?.message || 'Unknown error';

            if (status === 409 && code === 'WHT_IN_USE') {
                // Offer soft-delete as the next step
                const soft = await askConfirm({
                    title:        `"${row.code}" is referenced by past payments`,
                    description:  msg + ' Deactivate it instead? It will be hidden from new payment dropdowns but historical records keep working.',
                    confirmLabel: 'Deactivate',
                    confirmTone:  'danger'
                });
                if (soft) {
                    try {
                        await api.put(`/wht/types/${row.code}`, { isActive: false });
                        setNotification({ type: 'success', message: `WHT "${row.code}" deactivated.` });
                        fetchWhtTypes();
                    } catch (putErr) {
                        const m = putErr?.response?.data?.error || putErr?.message || 'Unknown error';
                        setNotification({ type: 'error', message: `Failed to deactivate: ${m}` });
                    }
                }
            } else {
                setNotification({ type: 'error', message: `Failed to delete (${status || 'n/a'}): ${msg}` });
            }
        }
    };

    const handleSave = async () => {
        // Validate before persisting.
        const seenCodes = new Set();
        for (const r of whtTypes) {
            if (!r.code || !r.name) {
                setNotification({ type: 'error', message: 'Every WHT must have a code and a name.' });
                return;
            }
            if (seenCodes.has(r.code)) {
                setNotification({ type: 'error', message: `Duplicate code "${r.code}". Codes must be unique.` });
                return;
            }
            seenCodes.add(r.code);
            if (r.rate < 0 || r.rate > 100) {
                setNotification({ type: 'error', message: `"${r.code}" rate must be between 0 and 100.` });
                return;
            }
        }

        setSaving(true);
        setNotification(null);

        // Differential save: new codes → POST, existing → PUT. Done
        // sequentially so a mid-loop failure doesn't leave us in an
        // inconsistent state. ALWAYS refetch at the end (success or
        // failure) so the next save attempt sees the latest persisted
        // state — this stops the "second save tries to POST an already-
        // inserted code → ORA-00001 → opaque 500" trap that bit users
        // before this fix.
        let savedCount = 0;
        let firstError = null;
        for (const r of whtTypes) {
            const payload = {
                name:      r.name,
                rate:      Number(r.rate),
                appliesTo: r.appliesTo,
                isActive:  r.isActive !== false,
                sortOrder: Number(r.sortOrder) || 0
            };
            try {
                if (r.__new || !originalCodes.has(r.code)) {
                    await api.post('/wht/types', { code: r.code, ...payload });
                } else {
                    await api.put(`/wht/types/${r.code}`, payload);
                }
                savedCount++;
            } catch (err) {
                if (!firstError) {
                    const status = err?.response?.status;
                    const msg    = err?.response?.data?.error || err?.message || 'Unknown error';
                    firstError = `Row "${r.code || '(new)'}": ${msg}${status ? ` [HTTP ${status}]` : ''}`;
                }
            }
        }
        // Always refetch so __new flags reset for rows that DID save
        await fetchWhtTypes();
        setSaving(false);

        if (firstError) {
            setNotification({
                type: 'error',
                message: `${savedCount} of ${whtTypes.length} rows saved. First failure — ${firstError}`
            });
        } else {
            setNotification({ type: 'success', message: `Withholding-tax settings saved (${savedCount} rows).` });
        }
    };

    if (loading) {
        return (
            <div className="bg-surface p-6 rounded-panel shadow-card border border-line max-w-4xl mx-auto">
                <div className="text-center py-8 text-gray-500">
                    <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-2"></div>
                    Loading WHT settings…
                </div>
            </div>
        );
    }

    return (
        <div className="bg-surface p-6 rounded-panel shadow-card border border-line max-w-4xl mx-auto">
            {notification && <Notification message={notification.message} type={notification.type} onDismiss={() => setNotification(null)} />}

            <div className="flex justify-between items-start mb-4">
                <div>
                    <h2 className="text-xl font-semibold text-gray-700">Withholding Tax Configuration</h2>
                    <p className="text-gray-500 text-sm mt-1">
                        Define withholding-tax codes that finance officers can apply when logging customer payments.
                        Changes here are referenced by the WHT dropdown in the Log Payment dialog.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={handleAdd}
                    className="py-2 px-4 bg-gray-100 text-blue-600 rounded-lg hover:bg-blue-50 border border-blue-200 flex items-center text-sm font-medium"
                >
                    <Icon id="plus" className="mr-2" /> Add WHT
                </button>
            </div>

            {whtTypes.length === 0 ? (
                <div className="text-center py-8 text-gray-500 italic">
                    No WHTs configured. Click "Add WHT" to define one.
                </div>
            ) : (
                <div className="space-y-3">
                    {whtTypes.map((row, idx) => (
                        <div key={row.__rid} className="grid grid-cols-12 gap-3 items-center p-4 bg-gray-50 rounded-lg border border-gray-100 hover:border-blue-200 transition-colors">
                            <div className="col-span-1 flex justify-center">
                                <input
                                    type="checkbox"
                                    checked={row.isActive !== false}
                                    onChange={(e) => handleChange(idx, 'isActive', e.target.checked)}
                                    className="h-5 w-5 text-blue-600 rounded focus:ring-blue-500"
                                    title="Active — uncheck to hide from finance dropdowns"
                                />
                            </div>
                            <div className="col-span-2">
                                <label className="text-xs text-gray-500 block mb-1">Code</label>
                                <input
                                    type="text"
                                    value={row.code}
                                    onChange={(e) => handleChange(idx, 'code', e.target.value)}
                                    disabled={!row.__new}
                                    className="w-full p-2 border border-gray-300 rounded text-sm font-mono uppercase focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                                    placeholder="e.g. VAT_WHT"
                                    maxLength={30}
                                />
                            </div>
                            <div className="col-span-3">
                                <label className="text-xs text-gray-500 block mb-1">Name</label>
                                <input
                                    type="text"
                                    value={row.name}
                                    onChange={(e) => handleChange(idx, 'name', e.target.value)}
                                    className="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                                    placeholder="e.g. VAT Withholding"
                                />
                            </div>
                            <div className="col-span-2">
                                <label className="text-xs text-gray-500 block mb-1">Rate (%)</label>
                                <input
                                    type="number"
                                    value={row.rate}
                                    onChange={(e) => handleChange(idx, 'rate', e.target.value)}
                                    className="w-full p-2 text-right border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                                    min="0"
                                    step="0.01"
                                />
                            </div>
                            <div className="col-span-3">
                                <label className="text-xs text-gray-500 block mb-1">Calculated on</label>
                                <select
                                    value={row.appliesTo || 'subtotal'}
                                    onChange={(e) => handleChange(idx, 'appliesTo', e.target.value)}
                                    className="w-full p-2 border border-gray-300 rounded text-sm bg-white"
                                >
                                    {APPLIES_TO_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="col-span-1 flex justify-center">
                                <button
                                    type="button"
                                    onClick={() => handleDelete(idx)}
                                    className="text-gray-400 hover:text-red-600 transition-colors p-2"
                                    title="Remove WHT"
                                >
                                    <Icon id="trash" className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="mt-6 flex justify-end border-t pt-4">
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || whtTypes.length === 0}
                    className="py-2.5 px-6 text-white bg-green-600 hover:bg-green-700 rounded-lg font-semibold shadow-sm transition-all disabled:opacity-50"
                >
                    {saving ? 'Saving…' : 'Save Changes'}
                </button>
            </div>
        </div>
    );
};

export default WhtSettings;
