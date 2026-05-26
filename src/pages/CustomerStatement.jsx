/**
 * CustomerStatement — Module 2 per-customer ledger view.
 *
 * Renders the running statement returned by /api/collections/customer/:id/statement
 * with PDF download via the existing jsPDF + autoTable pattern.
 *
 * Navigation:
 *   navigateTo('customerStatement', { customerId, from?, to? })
 *
 * The page is read-mostly for sales (`customer.statement.read`); finance can
 * download/print/send via the Send button.
 */

import React, { useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import api from '../api';
import Icon from '../components/common/Icon';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
import { SortableHeader, useSortable } from '../components/v2';
import { usePrompt } from '../components/v2/PromptDialog';
import { useApp } from '../context/AppContext';
import { can } from '../utils/permissions';

const fmtMoney = (currency, amount) =>
    `${currency || 'GHS'} ${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (s) => s ? new Date(s).toLocaleDateString() : '—';

const CustomerStatement = ({ navigateTo, pageContext, currentUser }) => {
    const customerId = pageContext?.customerId || pageContext;
    const [statement, setStatement] = useState(null);
    const [loading, setLoading]     = useState(true);
    const [error, setError]         = useState(null);
    const [notification, setNotification] = useState(null);
    const [from, setFrom]           = useState(pageContext?.from || '');
    const [to, setTo]               = useState(pageContext?.to   || '');

    const { appUser } = useApp();
    const { askText } = usePrompt();
    const canReverse  = can(appUser, 'payment.reverse');

    const role     = currentUser?.role;
    const backPage = (role === 'sales_head' || role === 'sales_officer' || role === 'sales')
        ? 'salesDashboard'
        : 'controllerDashboard';

    // Reload state when the user wants to refresh after a reverse.
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        if (!customerId) { setLoading(false); return; }
        let cancelled = false;
        setLoading(true);
        const params = {};
        if (from) params.from = from;
        if (to)   params.to   = to;
        api.get(`/collections/customer/${customerId}/statement`, { params })
            .then(res => {
                if (cancelled) return;
                if (res?.success) setStatement(res.data);
                else setError(res?.error || 'Could not load statement.');
            })
            .catch(err => {
                if (cancelled) return;
                const msg = err?.response?.data?.error || err?.message || 'Unknown error';
                setError(`Failed to load statement: ${msg}`);
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [customerId, from, to, reloadKey]);

    // Reverse a payment row directly from the statement. Reuses the
    // backend gate (24h window for finance_officer, anytime for head).
    // The statement entries carry a `meta.paymentId` we pass to the
    // reverse endpoint; non-payment rows (Invoice debits) never get the
    // Reverse button so this is only ever called with a real payment id.
    const handleReversePayment = async (entry) => {
        const paymentId = entry?.meta?.paymentId;
        if (!paymentId) {
            setNotification({ type: 'error', message: 'Cannot reverse — payment id missing on this entry.' });
            return;
        }
        const reason = await askText({
            title:        `Reverse ${entry.reference}?`,
            description:  'This marks the payment as REVERSED, restores the customer\'s outstanding balance, and is permanent. A reason is required for the audit trail.',
            label:        'Reason for reversal',
            placeholder:  'e.g. duplicate entry, cheque bounced, wrong invoice',
            multiline:    true,
            maxLength:    500,
            confirmLabel: 'Reverse payment',
            confirmTone:  'danger',
            cancelLabel:  'Keep payment'
        });
        if (reason === null) return;
        try {
            const res = await api.post(`/collections/payments/${paymentId}/reverse`, { reason: String(reason).trim() });
            if (res?.success) {
                setNotification({ type: 'success', message: `Payment ${entry.reference} reversed.` });
                setReloadKey(k => k + 1);   // re-fetch statement
            } else {
                setNotification({ type: 'error', message: res?.error || 'Could not reverse payment.' });
            }
        } catch (err) {
            const status = err?.response?.status;
            const msg    = err?.response?.data?.error || err?.message || 'Unknown error';
            // 422 = 24h-window block — surface server's clear message verbatim
            setNotification({
                type: 'error',
                message: status === 422 ? msg : `Failed to reverse${status ? ` (${status})` : ''}: ${msg}`
            });
        }
    };

    const handleDownloadPDF = () => {
        if (!statement) return;
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageWidth = pdf.internal.pageSize.getWidth();

        // Header
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(18);
        pdf.text('Statement of Account', 14, 20);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        pdf.text(`${statement.customer.name}`, 14, 28);
        if (statement.customer.tin) pdf.text(`TIN: ${statement.customer.tin}`, 14, 34);
        if (statement.period.from || statement.period.to) {
            const range = `Period: ${statement.period.from || '—'} to ${statement.period.to || '—'}`;
            pdf.text(range, 14, statement.customer.tin ? 40 : 34);
        }

        const startY = statement.customer.tin ? 46 : 40;

        // Ledger table
        autoTable(pdf, {
            startY,
            head: [['Date', 'Reference', 'Description', 'Debit', 'Credit', 'Balance']],
            body: [
                // Opening balance row
                ['', '', 'Opening balance', '', '', fmtMoney('GHS', statement.openingBalance)],
                ...statement.entries.map(e => [
                    fmtDate(e.date),
                    e.reference || '',
                    e.description || '',
                    e.debit ? Number(e.debit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',
                    e.credit ? Number(e.credit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',
                    Number(e.runningBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                ]),
                ['', '', 'Closing balance', '', '', fmtMoney('GHS', statement.closingBalance)]
            ],
            styles:      { fontSize: 8, cellPadding: 2 },
            headStyles:  { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [248, 250, 252] },
            columnStyles: {
                0: { cellWidth: 22 },
                1: { cellWidth: 28 },
                2: { cellWidth: 'auto' },
                3: { halign: 'right', cellWidth: 22 },
                4: { halign: 'right', cellWidth: 22 },
                5: { halign: 'right', cellWidth: 28 }
            },
            margin: { left: 14, right: 14 },
            didDrawPage: (data) => {
                const pageHeight = pdf.internal.pageSize.getHeight();
                pdf.setFontSize(8);
                pdf.setTextColor(120);
                pdf.text(
                    `Page ${data.pageNumber} · Generated ${new Date().toLocaleString()}`,
                    pageWidth / 2,
                    pageHeight - 8,
                    { align: 'center' }
                );
                pdf.setTextColor(0);
            }
        });

        // Aging summary below the ledger
        const afterY = pdf.lastAutoTable.finalY + 8;
        if (afterY < 250) {
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(10);
            pdf.text('Aging summary', 14, afterY);
            autoTable(pdf, {
                startY: afterY + 3,
                head: [['0-30', '31-60', '61-90', '90+', 'Total Outstanding']],
                body: [[
                    fmtMoney('GHS', statement.aging['0-30']  || 0),
                    fmtMoney('GHS', statement.aging['31-60'] || 0),
                    fmtMoney('GHS', statement.aging['61-90'] || 0),
                    fmtMoney('GHS', statement.aging['90+']   || 0),
                    fmtMoney('GHS', statement.closingBalance)
                ]],
                styles: { fontSize: 9, halign: 'right' },
                headStyles: { fillColor: [37, 99, 235], textColor: 255 },
                margin: { left: 14, right: 14 }
            });
        }

        const dateStr = new Date().toISOString().split('T')[0];
        pdf.save(`statement-${statement.customer.id}-${dateStr}.pdf`);
    };

    if (!customerId) {
        return (
            <div className="p-8 text-center text-gray-500">
                No customer selected. Open a statement from the Collections Workbench or a customer page.
            </div>
        );
    }

    return (
        <>
            <PageHeader
                title="Customer Statement"
                actions={
                    <>
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={handleDownloadPDF}
                            disabled={!statement || loading}
                            leftIcon={<Icon id="download" />}
                        >
                            Download PDF
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigateTo(backPage)}
                            leftIcon={<Icon id="arrow-left" />}
                        >
                            Back
                        </Button>
                    </>
                }
            />

            <div className="bg-surface p-6 rounded-panel shadow-card border border-line">
                {error && (
                    <div className="mb-4 p-3 rounded border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
                )}

                {loading ? (
                    <div className="text-center py-12 text-gray-500">
                        <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-2"></div>
                        Loading statement…
                    </div>
                ) : statement ? (
                    <>
                        {/* Customer header */}
                        <div className="flex flex-wrap justify-between items-start mb-4 pb-4 border-b border-line">
                            <div>
                                <h2 className="text-xl font-semibold text-gray-800">{statement.customer.name}</h2>
                                {statement.customer.tin && <div className="text-sm text-gray-600">TIN: {statement.customer.tin}</div>}
                                {statement.customer.address && <div className="text-sm text-gray-500">{statement.customer.address}</div>}
                                {statement.customer.paymentTerms && <div className="text-sm text-gray-500">Terms: {statement.customer.paymentTerms}</div>}
                            </div>
                            <div className="flex gap-2 items-end">
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">From</label>
                                    <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="p-1.5 text-sm border border-gray-300 rounded" />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">To</label>
                                    <input type="date" value={to} onChange={e => setTo(e.target.value)} className="p-1.5 text-sm border border-gray-300 rounded" />
                                </div>
                            </div>
                        </div>

                        {/* Aging tiles */}
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
                            {['0-30','31-60','61-90','90+'].map(k => (
                                <div key={k} className={`p-3 rounded border ${
                                    k === '90+'   ? 'border-red-200 bg-red-50' :
                                    k === '61-90' ? 'border-orange-200 bg-orange-50' :
                                    k === '31-60' ? 'border-amber-200 bg-amber-50' :
                                                    'border-gray-200 bg-gray-50'
                                }`}>
                                    <div className="text-xs font-medium text-gray-600 uppercase">{k}</div>
                                    <div className="text-lg font-bold mt-1">{fmtMoney('GHS', statement.aging[k] || 0)}</div>
                                </div>
                            ))}
                            <div className="p-3 rounded border border-blue-200 bg-blue-50">
                                <div className="text-xs font-medium text-blue-700 uppercase">Closing Balance</div>
                                <div className="text-lg font-bold mt-1 text-blue-900">{fmtMoney('GHS', statement.closingBalance)}</div>
                            </div>
                        </div>

                        {/* Notification (e.g. successful reverse) */}
                        {notification && (
                            <div className={`mb-3 p-3 rounded text-sm flex items-center justify-between ${
                                notification.type === 'error'
                                    ? 'bg-red-50 border border-red-200 text-red-700'
                                    : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                            }`}>
                                <span>{notification.message}</span>
                                <button onClick={() => setNotification(null)} className="text-gray-400 hover:text-gray-600 ml-2">×</button>
                            </div>
                        )}

                        {/* Ledger — sortable middle section, opening + closing
                            rows pinned. The view sorts entries, NOT the running
                            balances — those stay as computed at insertion order
                            (which is the only sensible interpretation since a
                            running balance only makes sense in chronological
                            order). The default sort is Date asc, matching the
                            "natural" ledger reading order. */}
                        <StatementLedger
                            statement={statement}
                            canReverse={canReverse}
                            onReverse={handleReversePayment}
                        />
                    </>
                ) : null}
            </div>
        </>
    );
};

// Sortable ledger view extracted so the parent stays readable. Opening
// and closing rows are pinned (rendered outside the useSortable result)
// so they always bracket the entries regardless of sort direction.
const StatementLedger = ({ statement, canReverse, onReverse }) => {
    const sortableEntries = useMemo(() => (statement.entries || []).map((e, idx) => ({
        ...e,
        __idx:    idx,                                  // stable React key
        _date:    Date.parse(e.date) || 0,
        _debit:   Number(e.debit) || 0,
        _credit:  Number(e.credit) || 0,
        _balance: Number(e.runningBalance) || 0
    })), [statement.entries]);
    const { sortKey, sortDir, toggle, sortedRows } = useSortable(sortableEntries, '_date', 'asc');

    return (
        <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        <th className="px-3 py-2 text-left"><SortableHeader label="Date"        sortKey="_date"      current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                        <th className="px-3 py-2 text-left"><SortableHeader label="Reference"   sortKey="reference"  current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                        <th className="px-3 py-2 text-left"><SortableHeader label="Description" sortKey="description" current={sortKey} dir={sortDir} onToggle={toggle} /></th>
                        <th className="px-3 py-2 text-right"><SortableHeader label="Debit"      sortKey="_debit"     current={sortKey} dir={sortDir} onToggle={toggle} align="right" /></th>
                        <th className="px-3 py-2 text-right"><SortableHeader label="Credit"     sortKey="_credit"    current={sortKey} dir={sortDir} onToggle={toggle} align="right" /></th>
                        <th className="px-3 py-2 text-right"><SortableHeader label="Balance"    sortKey="_balance"   current={sortKey} dir={sortDir} onToggle={toggle} align="right" /></th>
                        {canReverse && <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase"></th>}
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {/* Pinned opening row */}
                    <tr className="bg-gray-50">
                        <td className="px-3 py-2 text-sm text-gray-500" colSpan="3"><em>Opening balance</em></td>
                        <td colSpan="2"></td>
                        <td className="px-3 py-2 text-right text-sm font-mono font-semibold">{fmtMoney('GHS', statement.openingBalance)}</td>
                        {canReverse && <td></td>}
                    </tr>
                    {sortedRows.map(e => {
                        const isPayment = e.type === 'PAYMENT' && e.meta?.paymentId;
                        return (
                            <tr key={e.__idx} className="hover:bg-gray-50">
                                <td className="px-3 py-2 text-sm">{fmtDate(e.date)}</td>
                                <td className="px-3 py-2 text-sm font-mono">{e.reference}</td>
                                <td className="px-3 py-2 text-sm text-gray-700">{e.description}</td>
                                <td className="px-3 py-2 text-right text-sm font-mono">{e.debit  ? fmtMoney('GHS', e.debit)  : ''}</td>
                                <td className="px-3 py-2 text-right text-sm font-mono text-emerald-700">{e.credit ? fmtMoney('GHS', e.credit) : ''}</td>
                                <td className="px-3 py-2 text-right text-sm font-mono font-semibold">{fmtMoney('GHS', e.runningBalance)}</td>
                                {canReverse && (
                                    <td className="px-3 py-2 text-right">
                                        {isPayment && (
                                            <button
                                                type="button"
                                                onClick={() => onReverse(e)}
                                                className="text-xs text-red-600 hover:underline"
                                                title="Reverse this payment"
                                            >
                                                Reverse
                                            </button>
                                        )}
                                    </td>
                                )}
                            </tr>
                        );
                    })}
                    {sortedRows.length === 0 && (
                        <tr><td colSpan={canReverse ? 7 : 6} className="px-3 py-6 text-center text-sm text-gray-500">No activity in this period.</td></tr>
                    )}
                    {/* Pinned closing row */}
                    <tr className="bg-blue-50">
                        <td className="px-3 py-2 text-sm font-semibold" colSpan="3">Closing balance</td>
                        <td colSpan="2"></td>
                        <td className="px-3 py-2 text-right text-sm font-mono font-bold text-blue-900">{fmtMoney('GHS', statement.closingBalance)}</td>
                        {canReverse && <td></td>}
                    </tr>
                </tbody>
            </table>
        </div>
    );
};

export default CustomerStatement;
