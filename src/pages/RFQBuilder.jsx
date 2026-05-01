import React, { useState, useMemo } from 'react';
import api from '../api';
import Icon from '../components/common/Icon';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
import Notification from '../components/common/Notification';
import RFQPreviewModal from '../components/modals/RFQPreviewModal';
import { useRealtimePRs } from '../hooks/useRealtimePRs';
import { useRealtimeVendors } from '../hooks/useRealtimeVendors';
import { logActivity } from '../utils/logger';
import { useApp } from '../context/AppContext';

const RFQBuilder = ({ navigateTo, currentUser, pageContext }) => {
    const { userEmail } = useApp();
    const username = userEmail ? userEmail.split('@')[0] : 'System';

    const { data: openPRs, loading: prsLoading } = useRealtimePRs({ status: 'OPEN' });
    const { data: vendors, loading: vendorsLoading } = useRealtimeVendors();

    // Initialise from pre-selected PR IDs passed from PR detail page
    const preselectedPrIds = pageContext?.preselectedPrIds || [];

    const [title, setTitle] = useState('');
    const [submissionDeadline, setSubmissionDeadline] = useState('');
    const [deliveryDeadline, setDeliveryDeadline] = useState('');
    const [currency, setCurrency] = useState('GHS');
    const [notes, setNotes] = useState('');
    const [selectedPRs, setSelectedPRs] = useState(() => new Set(preselectedPrIds));
    const [selectedVendors, setSelectedVendors] = useState(new Set());
    const [vendorSearch, setVendorSearch] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [notification, setNotification] = useState(null);
    const [showPreview, setShowPreview] = useState(false);

    const role = currentUser?.role;
    const backPage = role === 'procurement' ? 'procurementDashboard' : 'controllerDashboard';

    const activeVendors = useMemo(
        () => vendors.filter(v => v.status === 'active'),
        [vendors]
    );

    const filteredVendors = useMemo(() => {
        if (!vendorSearch.trim()) return activeVendors;
        const q = vendorSearch.toLowerCase();
        return activeVendors.filter(v =>
            v.name?.toLowerCase().includes(q) ||
            v.category?.toLowerCase().includes(q)
        );
    }, [activeVendors, vendorSearch]);

    const togglePR = (id) => {
        const next = new Set(selectedPRs);
        next.has(id) ? next.delete(id) : next.add(id);
        setSelectedPRs(next);
    };

    const toggleVendor = (id) => {
        const next = new Set(selectedVendors);
        next.has(id) ? next.delete(id) : next.add(id);
        setSelectedVendors(next);
    };

    const canSubmit =
        title.trim().length > 0 &&
        selectedPRs.size > 0 &&
        selectedVendors.size > 0 &&
        submissionDeadline;

    // Build the rfqData payload for the preview modal
    const previewRfqData = useMemo(() => {
        if (!canSubmit) return null;

        const selectedPRList = openPRs.filter(pr => selectedPRs.has(pr.id));
        const selectedVendorList = activeVendors.filter(v => selectedVendors.has(v.id));

        return {
            rfqNumber: 'RFQ-PREVIEW',
            title,
            submissionDeadline,
            deliveryDeadline: deliveryDeadline || null,
            currency,
            notes: notes || null,
            lineItems: selectedPRList.map(pr => ({
                itemName: pr.itemName,
                quantity: pr.quantity,
                uom: pr.uom || 'EA',
                description: pr.itemDescription || pr.itemName,
            })),
            vendors: selectedVendorList.map(v => ({
                vendorId: v.id,
                vendorName: v.name,
                contactPerson: v.contactPerson || '',
                contactEmail: v.contactEmail || '',
                contactPhone: v.contactPhone || '',
                address: v.address || '',
            })),
        };
    }, [canSubmit, openPRs, selectedPRs, activeVendors, selectedVendors, title, submissionDeadline, deliveryDeadline, currency, notes]);

    // Open preview instead of sending directly
    const handlePreview = () => {
        if (!canSubmit) {
            setNotification({ type: 'error', message: 'Title, deadline, at least 1 PR and 1 vendor are required.' });
            return;
        }
        setShowPreview(true);
    };

    // Actually create the RFQ and optionally send emails (called from preview modal)
    const handleCreate = async (sendImmediately) => {
        setSubmitting(true);
        try {
            const res = await api.post('/rfqs', {
                title,
                submissionDeadline,
                deliveryDeadline: deliveryDeadline || null,
                currency,
                notes: notes || null,
                prIds:     Array.from(selectedPRs),
                vendorIds: Array.from(selectedVendors)
            });
            if (!res.success) throw new Error(res.error || 'Create failed');
            await logActivity(username, 'Created RFQ', res.rfqNumber);

            if (sendImmediately) {
                const sendRes = await api.post(`/rfqs/${res.id}/send`);
                if (sendRes.success) {
                    const successCount = (sendRes.sendResults || []).filter(r => r.sent).length;
                    const failCount    = (sendRes.sendResults || []).length - successCount;
                    setNotification({
                        type: failCount > 0 ? 'warning' : 'success',
                        message: `RFQ ${res.rfqNumber} created. Emails sent: ${successCount}${failCount > 0 ? `, failed: ${failCount}` : ''}.`
                    });
                    await logActivity(username, 'Sent RFQ Emails', res.rfqNumber);
                }
            } else {
                setNotification({ type: 'success', message: `RFQ ${res.rfqNumber} saved as draft.` });
            }

            setShowPreview(false);
            setTimeout(() => navigateTo('rfqDetail', res.id), 800);
        } catch (err) {
            setNotification({ type: 'error', message: err.message || 'Failed to create RFQ.' });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <>
            {notification && (
                <Notification
                    message={notification.message}
                    type={notification.type}
                    onDismiss={() => setNotification(null)}
                />
            )}

            {/* RFQ Preview Modal */}
            <RFQPreviewModal
                open={showPreview}
                onClose={() => setShowPreview(false)}
                rfqData={previewRfqData}
                onConfirmSend={() => handleCreate(true)}
                onSaveDraft={() => handleCreate(false)}
            />

            <PageHeader
                title="New Request for Quotation"
                actions={
                    <Button variant="ghost" size="sm" onClick={() => navigateTo('rfqList')} leftIcon={<Icon id="arrow-left" />}>
                        Back
                    </Button>
                }
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Left column — header + PR selection */}
                    <div className="lg:col-span-2 space-y-6">
                        <div className="bg-surface p-6 rounded-panel shadow-card border border-line">
                            <h2 className="text-lg font-semibold mb-4">RFQ Details</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="md:col-span-2">
                                    <label className="block text-xs text-gray-500 mb-1">Title *</label>
                                    <input
                                        type="text"
                                        value={title}
                                        onChange={(e) => setTitle(e.target.value)}
                                        placeholder="e.g. Sourcing for Q2 ID card stock"
                                        className="w-full p-2 border rounded-md"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">Submission Deadline *</label>
                                    <input
                                        type="date"
                                        value={submissionDeadline}
                                        onChange={(e) => setSubmissionDeadline(e.target.value)}
                                        className="w-full p-2 border rounded-md"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">Delivery Deadline</label>
                                    <input
                                        type="date"
                                        value={deliveryDeadline}
                                        onChange={(e) => setDeliveryDeadline(e.target.value)}
                                        className="w-full p-2 border rounded-md"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">Currency</label>
                                    <select
                                        value={currency}
                                        onChange={(e) => setCurrency(e.target.value)}
                                        className="w-full p-2 border rounded-md"
                                    >
                                        <option value="GHS">GHS</option>
                                        <option value="USD">USD</option>
                                        <option value="EUR">EUR</option>
                                    </select>
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-xs text-gray-500 mb-1">Notes for vendors</label>
                                    <textarea
                                        rows={3}
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        placeholder="Specifications, packing requirements, delivery location..."
                                        className="w-full p-2 border rounded-md"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="bg-surface p-6 rounded-panel shadow-card border border-line">
                            <h2 className="text-lg font-semibold mb-2">
                                Open Purchase Requisitions
                                <span className="ml-2 text-sm text-gray-500">({selectedPRs.size} selected)</span>
                            </h2>
                            <p className="text-xs text-gray-500 mb-3">Select the PRs you want to source through this RFQ.</p>
                            {prsLoading ? (
                                <div className="text-center py-6 text-gray-500">Loading PRs...</div>
                            ) : openPRs.length === 0 ? (
                                <div className="text-center py-6 text-gray-500">
                                    No open requisitions. Sales can create one by submitting a quote with sourced items.
                                </div>
                            ) : (
                                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-gray-50 sticky top-0">
                                            <tr>
                                                <th className="p-2 w-8"></th>
                                                <th className="p-2 text-xs uppercase text-gray-500">PR #</th>
                                                <th className="p-2 text-xs uppercase text-gray-500">Item</th>
                                                <th className="p-2 text-xs uppercase text-gray-500 text-center">Qty</th>
                                                <th className="p-2 text-xs uppercase text-gray-500">Customer</th>
                                                <th className="p-2 text-xs uppercase text-gray-500">Needed By</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {openPRs.map(pr => (
                                                <tr
                                                    key={pr.id}
                                                    onClick={() => togglePR(pr.id)}
                                                    className={`border-b cursor-pointer ${
                                                        selectedPRs.has(pr.id) ? 'bg-blue-50' : 'hover:bg-gray-50'
                                                    }`}
                                                >
                                                    <td className="p-2">
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedPRs.has(pr.id)}
                                                            onChange={() => togglePR(pr.id)}
                                                            onClick={(e) => e.stopPropagation()}
                                                        />
                                                    </td>
                                                    <td className="p-2 font-mono text-xs">{pr.prNumber || pr.id.slice(0, 8)}</td>
                                                    <td className="p-2">{pr.itemName}</td>
                                                    <td className="p-2 text-center">{pr.quantity} {pr.uom}</td>
                                                    <td className="p-2 text-gray-600">{pr.customerName || '—'}</td>
                                                    <td className="p-2 text-gray-600">{pr.neededBy || '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right column — vendors + actions */}
                    <div className="space-y-6">
                        <div className="bg-surface p-6 rounded-panel shadow-card border border-line">
                            <h2 className="text-lg font-semibold mb-2">
                                Vendors <span className="ml-2 text-sm text-gray-500">({selectedVendors.size} selected)</span>
                            </h2>
                            <input
                                type="text"
                                value={vendorSearch}
                                onChange={(e) => setVendorSearch(e.target.value)}
                                placeholder="Search vendors..."
                                className="w-full p-2 border rounded-md mb-3 text-sm"
                            />
                            {vendorsLoading ? (
                                <div className="text-center py-4 text-gray-500 text-sm">Loading vendors...</div>
                            ) : filteredVendors.length === 0 ? (
                                <div className="text-center py-4 text-gray-500 text-sm">
                                    No active vendors found. Add vendors first via the Vendor Directory.
                                </div>
                            ) : (
                                <div className="space-y-2 max-h-80 overflow-y-auto">
                                    {filteredVendors.map(v => (
                                        <label
                                            key={v.id}
                                            className={`flex items-start gap-2 p-2 rounded border cursor-pointer ${
                                                selectedVendors.has(v.id)
                                                    ? 'border-blue-500 bg-blue-50'
                                                    : 'border-gray-200 hover:bg-gray-50'
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedVendors.has(v.id)}
                                                onChange={() => toggleVendor(v.id)}
                                                className="mt-1"
                                            />
                                            <div className="flex-1">
                                                <div className="text-sm font-medium">{v.name}</div>
                                                <div className="text-xs text-gray-500">{v.category || '—'}</div>
                                                <div className="text-xs text-gray-400">{v.contactEmail || 'no email'}</div>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="bg-surface p-6 rounded-panel shadow-card border border-line space-y-3">
                            <button
                                disabled={!canSubmit || submitting}
                                onClick={handlePreview}
                                className={`w-full py-2 px-4 rounded-md text-sm text-white ${
                                    canSubmit && !submitting ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-300 cursor-not-allowed'
                                }`}
                            >
                                {submitting ? 'Working...' : 'Preview & Send'}
                            </button>
                            <button
                                disabled={!canSubmit || submitting}
                                onClick={() => {
                                    const prNames = openPRs.filter(p => selectedPRs.has(p.id)).map(p => p.itemName).join(', ');
                                    const vNames  = activeVendors.filter(v => selectedVendors.has(v.id)).map(v => v.name).join(', ');
                                    if (!window.confirm(`Save as draft without preview?\n\nTitle: ${title}\nPRs: ${prNames}\nVendors: ${vNames}\n\nYou can send to vendors later from the RFQ detail page.`)) return;
                                    handleCreate(false);
                                }}
                                className={`w-full py-2 px-4 rounded-md text-sm border ${
                                    canSubmit && !submitting
                                        ? 'border-blue-600 text-blue-600 hover:bg-blue-50'
                                        : 'border-gray-200 text-gray-400 cursor-not-allowed'
                                }`}
                            >
                                Save as Draft
                            </button>
                        </div>
                    </div>
                </div>
        </>
    );
};

export default RFQBuilder;
