import React, { useState, useEffect } from 'react';
import Dialog from '../v2/Dialog';
import Button from '../common/Button';
import Icon from '../common/Icon';

/**
 * ExportFormatModal — used by every Module 5 report page (via
 * ReportPage.jsx) to let the user pick PDF, XLSX, or both-in-ZIP
 * before download. Owned-state minimal — just the format + filename.
 *
 *   <ExportFormatModal
 *     open
 *     onClose={...}
 *     defaultFilename="ar-aging-2026-05-24"
 *     onExport={async (format) => exportPDF(...) | exportXLSX(...) | exportZip(...)}
 *   />
 */

const FORMATS = [
    { id: 'pdf',  label: 'PDF (.pdf)',                  icon: 'file-pdf',   desc: 'Branded report with company header, page numbers, and filter caption.' },
    { id: 'xlsx', label: 'Excel (.xlsx)',               icon: 'file-excel', desc: 'Formatted workbook with totals row, frozen header, and a Run Info sheet.' },
    { id: 'zip',  label: 'Both — bundled in a ZIP',     icon: 'file-zipper', desc: 'PDF + XLSX in one download. Hand-off bundle for finance / audit.' }
];

const ExportFormatModal = ({ open, onClose, defaultFilename = 'report', onExport }) => {
    const [format, setFormat] = useState('pdf');
    const [filename, setFilename] = useState(defaultFilename);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (open) {
            setFormat('pdf');
            setFilename(defaultFilename);
            setBusy(false);
            setError(null);
        }
    }, [open, defaultFilename]);

    const submit = async () => {
        setError(null);
        setBusy(true);
        try {
            await onExport(format, { filename });
        } catch (e) {
            setError(e?.message || 'Export failed');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog
            open={open}
            onClose={busy ? undefined : onClose}
            title="Export report"
            description="Pick a format. Both files keep the same filters and as-of date."
            size="md"
        >
            <div className="space-y-3">
                {error && (
                    <div className="p-3 rounded border border-red-200 bg-red-50 text-sm text-red-700">
                        {error}
                    </div>
                )}

                <fieldset className="space-y-2">
                    {FORMATS.map(f => (
                        <label
                            key={f.id}
                            className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${
                                format === f.id
                                    ? 'border-primary bg-primary-soft'
                                    : 'border-gray-200 hover:bg-gray-50'
                            }`}
                        >
                            <input
                                type="radio"
                                name="format"
                                value={f.id}
                                checked={format === f.id}
                                onChange={() => setFormat(f.id)}
                                className="mt-1"
                            />
                            <div className="flex items-start gap-2 flex-1 min-w-0">
                                <Icon id={f.icon} className="w-4 h-4 mt-0.5 text-gray-600 flex-shrink-0" />
                                <div className="min-w-0">
                                    <div className="text-sm font-medium text-gray-800">{f.label}</div>
                                    <div className="text-xs text-gray-500 mt-0.5">{f.desc}</div>
                                </div>
                            </div>
                        </label>
                    ))}
                </fieldset>

                <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Filename</label>
                    <input
                        type="text"
                        value={filename}
                        onChange={(e) => setFilename(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded text-sm font-mono"
                        placeholder="report-name"
                    />
                    <div className="text-[11px] text-gray-500 mt-1">
                        File extension is added automatically.
                    </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                    <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
                    <Button variant="primary" onClick={submit} disabled={busy || !filename.trim()}>
                        {busy ? 'Generating…' : 'Download'}
                    </Button>
                </div>
            </div>
        </Dialog>
    );
};

export default ExportFormatModal;
