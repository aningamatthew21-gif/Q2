import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../api';
import socket from '../socket';
import Icon from '../components/common/Icon';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
import Notification from '../components/common/Notification';
import ConfirmationModal from '../components/modals/ConfirmationModal';
import LogVendorResponseModal from '../components/modals/LogVendorResponseModal';
import RFQPreviewModal from '../components/modals/RFQPreviewModal';
import RecommendVendorModal from '../components/modals/RecommendVendorModal';
import RFQWorkflowStepper from '../components/procurement/RFQWorkflowStepper';
import NextActionBanner from '../components/procurement/NextActionBanner';
import VendorResponseCard from '../components/procurement/VendorResponseCard';
import SystemRecommendation from '../components/procurement/SystemRecommendation';
import EscalationBanner from '../components/procurement/EscalationBanner';
import { PDFService } from '../services/PDFService';
import { logActivity } from '../utils/logger';
import { useApp } from '../context/AppContext';
import { usePrompt } from '../components/v2/PromptDialog';
import { can } from '../utils/permissions';

const StatusBadge = ({ value }) => (
    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
        value === 'DRAFT'     ? 'bg-gray-100 text-gray-700'    :
        value === 'SENT'      ? 'bg-blue-100 text-blue-800'    :
        value === 'RECEIVING' ? 'bg-amber-100 text-amber-800'  :
        value === 'COMPARING' ? 'bg-purple-100 text-purple-800':
        value === 'AWARDED'   ? 'bg-green-100 text-green-800'  :
        value === 'PENDING_APPROVAL' ? 'bg-yellow-100 text-yellow-800' :
        value === 'CANCELLED' ? 'bg-red-100 text-red-700'      :
        'bg-gray-100 text-gray-800'
    }`}>{value === 'PENDING_APPROVAL' ? 'Pending Approval' : value}</span>
);

const RFQDetail = ({ navigateTo, pageContext, currentUser }) => {
    const rfqId = pageContext;
    const { userEmail } = useApp();
    const { askText } = usePrompt();
    const username = userEmail ? userEmail.split('@')[0] : 'System';

    const [rfq, setRfq]                       = useState(null);
    const [loading, setLoading]               = useState(true);
    const [error, setError]                   = useState(null);
    const [notification, setNotification]     = useState(null);
    const [logVendor, setLogVendor]           = useState(null);
    const [logDefaultPr, setLogDefaultPr]     = useState(null);
    const [confirmCancel, setConfirmCancel]   = useState(false);
    const [showPreview, setShowPreview]       = useState(false);
    const [downloadingPDF, setDownloadingPDF] = useState(false);
    const [recommendation, setRecommendation] = useState(null);
    const [recommendVendor, setRecommendVendor] = useState(null);
    const [generatingAwardPDF, setGeneratingAwardPDF] = useState(false);

    // ── Permission-driven action gates + RFQ ownership ──────────────
    // Two layers of authorisation now apply to RFQ actions:
    //
    //   1. PERMISSION — does this role hold the action permission at all?
    //      (e.g. procurement_officer has `rfq.response.log`; sales_officer
    //      does not.)
    //
    //   2. OWNERSHIP — is this officer actually assigned to work on THIS
    //      RFQ? Derived from the linked PRs: an officer "owns" an RFQ if
    //      they are the current `ASSIGNED_TO` of at least one PR linked
    //      to the RFQ. Backend gates the same way (`requireRfqOwnership`).
    //
    // PH / admin bypass ownership (they can act on any RFQ) because their
    // `rfq.approve.award` grant signals that authority. The ownership
    // layer exists purely to stop officer A from interfering with officer
    // B's work — both have the permission, but only one has the
    // assignment.
    //
    // `canActOnRfq` is the umbrella visibility gate for the Actions card.
    const role             = currentUser?.role;
    const isMine           = Array.isArray(rfq?.assignedOfficers)
        ? rfq.assignedOfficers.includes(userEmail)
        : false;
    const rawApproveAward  = can(currentUser, 'rfq.approve.award');   // PH/admin
    const rawRejectAward   = can(currentUser, 'rfq.reject');          // PH/admin
    const rawCancelRfq     = can(currentUser, 'rfq.cancel');          // PH/admin
    // Officer-side actions need permission AND ownership; PH bypasses
    // ownership because rawApproveAward implies full RFQ authority.
    const canLogResponse   = can(currentUser, 'rfq.response.log') && (isMine || rawApproveAward);
    const canRecommend     = can(currentUser, 'rfq.recommend')     && (isMine || rawApproveAward);
    const canEscalate      = can(currentUser, 'rfq.escalate')      && (isMine || rawApproveAward);
    const canSend          = can(currentUser, 'rfq.send')          && (isMine || rawApproveAward);
    // PH-only actions don't gate on ownership (they're PH-only by permission).
    const canApproveAward  = rawApproveAward;
    const canRejectAward   = rawRejectAward;
    const canCancelRfq     = rawCancelRfq;
    const canFinanceView   = can(currentUser, 'dashboard.finance.read');
    const canActOnRfq      = canLogResponse || canApproveAward || canCancelRfq;
    // Read-only state — officer has permission but no ownership and isn't
    // PH. Drives the amber notice rendered below the actions panel.
    const isOfficerReadOnly = !canActOnRfq
        && can(currentUser, 'rfq.response.log')   // has permission to act in general
        && !rawApproveAward;                       // but isn't PH/admin

    // Back-link target — procurement users land on their dashboard;
    // anyone else (finance head with cross-dept visibility) on theirs.
    // Matches the tiered-role pattern used in PurchaseRequisitionDetail.
    const backPage = (role === 'procurement_head' || role === 'procurement_officer' || role === 'procurement')
        ? 'procurementDashboard'
        : 'controllerDashboard';

    const fetchRfq = async () => {
        try {
            setLoading(true);
            const res = await api.get(`/rfqs/${rfqId}`);
            if (res.success) {
                setRfq(res.data);
                setError(null);
                // Fetch the multi-criteria recommendation in parallel — non-blocking
                api.get(`/rfqs/${rfqId}/recommendation`)
                    .then(rec => { if (rec.success) setRecommendation(rec.data); })
                    .catch(() => { /* recommendation is best-effort, don't block UI */ });
            } else {
                setError(res.error || 'Not found');
            }
        } catch (err) {
            setError(err.message || 'Failed to load RFQ');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!rfqId) return;
        fetchRfq();
        if (!socket.connected) socket.connect();
        const handler = () => fetchRfq();
        socket.on('rfq:updated', handler);
        return () => socket.off('rfq:updated', handler);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rfqId]);

    // Pre-compute the comparison matrix:  vendor -> pr -> response
    const matrix = useMemo(() => {
        if (!rfq) return {};
        const m = {};
        for (const v of rfq.vendors) m[v.vendorId] = {};
        for (const r of rfq.responses) {
            if (!m[r.vendorId]) m[r.vendorId] = {};
            m[r.vendorId][r.prId] = r;
        }
        return m;
    }, [rfq]);

    // Per-vendor totals (sum of all their responses for this RFQ)
    const vendorTotals = useMemo(() => {
        if (!rfq) return {};
        const totals = {};
        for (const v of rfq.vendors) {
            const sum = rfq.responses
                .filter(r => r.vendorId === v.vendorId)
                .reduce((acc, r) => acc + r.totalCost, 0);
            totals[v.vendorId] = sum;
        }
        return totals;
    }, [rfq]);

    // Find lowest-cost vendor per line item for highlighting
    const lowestPerItem = useMemo(() => {
        if (!rfq) return {};
        const result = {};
        for (const li of rfq.lineItems) {
            let minCost = Infinity;
            let minVendorId = null;
            for (const v of rfq.vendors) {
                const r = matrix[v.vendorId]?.[li.prId];
                if (r && r.unitCost > 0 && r.unitCost < minCost) {
                    minCost = r.unitCost;
                    minVendorId = v.vendorId;
                }
            }
            if (minVendorId) result[li.prId] = minVendorId;
        }
        return result;
    }, [rfq, matrix]);

    const sortedVendorsByCost = useMemo(() => {
        if (!rfq) return [];
        return [...rfq.vendors].sort((a, b) => {
            const ta = vendorTotals[a.vendorId] || 0;
            const tb = vendorTotals[b.vendorId] || 0;
            if (ta === 0 && tb === 0) return 0;
            if (ta === 0) return 1;
            if (tb === 0) return -1;
            return ta - tb;
        });
    }, [rfq, vendorTotals]);

    // Check how many responses each vendor has vs total line items
    const vendorResponseCoverage = useMemo(() => {
        if (!rfq) return {};
        const result = {};
        const totalItems = rfq.lineItems.length;
        for (const v of rfq.vendors) {
            const responded = rfq.lineItems.filter(li => matrix[v.vendorId]?.[li.prId]).length;
            result[v.vendorId] = { responded, total: totalItems, complete: responded === totalItems };
        }
        return result;
    }, [rfq, matrix]);

    // Best value vendor (lowest total with full coverage)
    const bestValueVendorId = useMemo(() => {
        if (!rfq || rfq.responses.length === 0) return null;
        let best = null;
        let bestTotal = Infinity;
        for (const v of rfq.vendors) {
            const cov = vendorResponseCoverage[v.vendorId];
            if (!cov?.complete) continue;
            const total = vendorTotals[v.vendorId] || 0;
            if (total > 0 && total < bestTotal) {
                bestTotal = total;
                best = v.vendorId;
            }
        }
        return best;
    }, [rfq, vendorTotals, vendorResponseCoverage]);

    const handleSendEmails = async () => {
        try {
            const res = await api.post(`/rfqs/${rfqId}/send`);
            if (!res.success) throw new Error(res.error);
            const results = res.sendResults || [];
            const successCount = results.filter(r => r.sent).length;
            const failed = results.filter(r => !r.sent);
            const failCount = failed.length;

            // M9 — surface specific failures so the user knows which vendor to retry/fix.
            // Falls back to vendor ID if server didn't include a name.
            let message;
            if (failCount === 0) {
                message = `Emails sent to ${successCount} vendor${successCount === 1 ? '' : 's'}.`;
            } else {
                const byReason = failed.reduce((acc, f) => {
                    const key = f.error || 'Unknown error';
                    const label = f.vendorName || f.vendorId;
                    (acc[key] = acc[key] || []).push(label);
                    return acc;
                }, {});
                const detail = Object.entries(byReason)
                    .map(([reason, names]) => `${names.join(', ')} — ${reason}`)
                    .join('; ');
                message = `Sent to ${successCount}. Failed: ${failCount} (${detail}).`;
            }
            setNotification({ type: failCount > 0 ? 'warning' : 'success', message });
            await logActivity(username, 'Sent RFQ Emails', rfq.rfqNumber);
            fetchRfq();
        } catch (err) {
            setNotification({ type: 'error', message: err.message || 'Failed to send emails.' });
        }
    };

    const handleSaveResponse = async (payload) => {
        try {
            const res = await api.post(`/rfqs/${rfqId}/responses`, payload);
            if (!res.success) throw new Error(res.error);
            setNotification({ type: 'success', message: 'Vendor response logged.' });
            await logActivity(username, 'Logged Vendor Response', rfq.rfqNumber);
            setLogVendor(null);
            setLogDefaultPr(null);
            fetchRfq();
        } catch (err) {
            setNotification({ type: 'error', message: err.message || 'Failed to save response.' });
        }
    };

    const handleRecommend = async (payload) => {
        // payload = { vendorId, responseIds, score, reason, allowPartial }
        const res = await api.post(`/rfqs/${rfqId}/recommend`, payload);
        if (!res.success) throw new Error(res.error || 'Recommendation failed.');
        await logActivity(username, 'Recommended RFQ Vendor', `${rfq.rfqNumber} -> ${recommendVendor?.vendorName}`);
        setNotification({ type: 'success', message: `Recommendation submitted — awaiting Procurement Head approval.` });
        setRecommendVendor(null);
        fetchRfq();
    };

    // Generate the Award Letter PDF for the winning vendor and optionally open the user's mail client
    const handleDownloadAwardLetter = useCallback(async (openEmail = false) => {
        if (!rfq || generatingAwardPDF) return;
        setGeneratingAwardPDF(true);
        try {
            const winnerId = rfq.awardedVendorId || rfq.recommendedVendorId;
            const vendor = rfq.vendors.find(v => v.vendorId === winnerId);
            if (!vendor) throw new Error('Winning vendor not found.');

            // Build per-line award items using the vendor's winning responses
            const winnerResponses = rfq.responses.filter(r => r.vendorId === winnerId && r.isWinner);
            const lineItems = winnerResponses.map(resp => {
                const line = rfq.lineItems.find(li => li.prId === resp.prId);
                return {
                    itemName: line?.itemName || 'Item',
                    quantity: Number(resp.quantity || 0),
                    uom: line?.uom || 'EA',
                    unitCost: Number(resp.unitCost || 0),
                    totalCost: Number(resp.totalCost || 0)
                };
            });

            // Pick the first non-empty payment term from the winner's responses
            const paymentTerms = winnerResponses.find(r => r.paymentTerms)?.paymentTerms || '';

            const awardData = {
                rfqNumber: rfq.rfqNumber,
                title: rfq.title,
                awardedAt: rfq.awardedAt || rfq.approvedAt,
                approvedBy: rfq.approvedBy || rfq.awardedBy,
                currency: rfq.currency,
                totalAwardAmount: rfq.totalAwardAmount,
                paymentTerms,
                deliveryDeadline: rfq.deliveryDeadline,
                vendor,
                lineItems
            };
            const pdf = await PDFService.generateAwardLetterPDF(awardData);
            const safeName = (vendor.vendorName || 'Vendor').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '-');
            const date = new Date().toISOString().slice(0, 10);
            pdf.save(`Award-Letter-${safeName}-${rfq.rfqNumber}-${date}.pdf`);
            await logActivity(username, 'Downloaded Award Letter', `${rfq.rfqNumber} -> ${vendor.vendorName}`);

            if (openEmail && vendor.contactEmail) {
                const subject = `Award Letter — RFQ ${rfq.rfqNumber}`;
                const body =
`Dear ${vendor.contactPerson || vendor.vendorName},

We are pleased to inform you that Margins ID Systems has selected your bid for RFQ ${rfq.rfqNumber} and hereby awards you the supply of the items previously quoted.

Please find the official Award Letter attached to this email (PDF downloaded to your device — please attach before sending).

Kind regards,
${username}
MIDSA Procurement`;
                const href = `mailto:${vendor.contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                window.location.href = href;
            }

            setNotification({ type: 'success', message: `Award letter generated for ${vendor.vendorName}.` });
        } catch (err) {
            setNotification({ type: 'error', message: err.message || 'Failed to generate award letter.' });
        } finally {
            setGeneratingAwardPDF(false);
        }
    }, [rfq, generatingAwardPDF, username]);

    // Procurement-head approve/reject handlers. Kept the original function names to avoid
    // ripple renames in the JSX below — the "Controller" suffix is a legacy artifact now
    // meaning "the senior approver," which for RFQs is Procurement Head (not Finance).
    // Surface the backend's actual error message rather than the axios default
    // ("Request failed with status code 500"). The interceptor in src/api.js
    // hangs the response payload off `err.response.data`; if present it usually
    // has a useful `error` string from our errorHandler middleware.
    const extractError = (err, fallback) =>
        err?.response?.data?.error
        || err?.message
        || fallback;

    const handleControllerApprove = async () => {
        try {
            const res = await api.post(`/rfqs/${rfqId}/approve`);
            if (!res.success) throw new Error(res.error);
            await logActivity(username, 'Procurement Head Approved RFQ', rfq.rfqNumber);
            setNotification({ type: 'success', message: 'RFQ approved — costs pushed to invoice.' });
            fetchRfq();
        } catch (err) {
            setNotification({ type: 'error', message: extractError(err, 'Approval failed.') });
        }
    };

    const handleControllerReject = async () => {
        try {
            const res = await api.post(`/rfqs/${rfqId}/reject`, { reason: 'Rejected by Procurement Head' });
            if (!res.success) throw new Error(res.error);
            await logActivity(username, 'Procurement Head Rejected RFQ', rfq.rfqNumber);
            setNotification({ type: 'success', message: 'RFQ sent back for re-evaluation.' });
            fetchRfq();
        } catch (err) {
            setNotification({ type: 'error', message: extractError(err, 'Rejection failed.') });
        }
    };

    const handleCancel = async () => {
        const reason = await askText({
            title:        `Cancel ${rfq.rfqNumber}?`,
            description:  'Vendors who already responded will see the RFQ as cancelled. The reason is recorded in the audit trail. Leaving it blank uses the default "No longer required".',
            label:        'Reason for cancellation',
            defaultValue: 'No longer required',
            placeholder:  'No longer required',
            multiline:    true,
            maxLength:    500,
            confirmLabel: 'Cancel RFQ',
            confirmTone:  'danger',
            cancelLabel:  'Keep RFQ'
        });
        if (reason === null) return;
        setConfirmCancel(false);
        try {
            const res = await api.delete(`/rfqs/${rfqId}`, { data: { reason: (reason || '').trim() || 'No longer required' } });
            if (!res.success) throw new Error(res.error);
            await logActivity(username, 'Cancelled RFQ', `${rfq.rfqNumber}: ${reason}`);
            setNotification({ type: 'success', message: 'RFQ cancelled.' });
            fetchRfq();
        } catch (err) {
            setNotification({ type: 'error', message: err.message || 'Cancel failed.' });
        }
    };

    // Phase 5 — manual escalation trigger
    const [escalating, setEscalating] = useState(false);
    const handleEscalate = useCallback(async ({ reason }) => {
        if (!rfq) return;
        setEscalating(true);
        try {
            const res = await api.post(`/rfqs/${rfq.id}/escalate`, { reason });
            if (res.success) {
                setNotification({
                    type: 'success',
                    message: res.escalatedTo
                        ? `RFQ escalated to ${res.escalatedTo}.`
                        : 'RFQ flagged as escalated (no procurement head email configured).'
                });
                // Refresh RFQ to surface new escalation fields in the banner
                const refreshed = await api.get(`/rfqs/${rfq.id}`);
                if (refreshed.success) setRfq(refreshed.data);
            } else {
                setNotification({ type: 'error', message: res.error || 'Escalation failed.' });
            }
        } catch (err) {
            setNotification({ type: 'error', message: err?.message || 'Escalation failed.' });
        } finally {
            setEscalating(false);
        }
    }, [rfq]);

    // Open native mail client with a draft reminder for an unresponsive vendor
    const handleSendReminder = useCallback((vendor) => {
        if (!rfq || !vendor?.vendorEmail) return;
        const subject = `Reminder: RFQ ${rfq.rfqNumber} - ${rfq.title || 'Quotation Request'}`;
        const lines = (rfq.lineItems || []).map(li => `  • ${li.itemName} — ${li.quantity} ${li.uom || 'EA'}`).join('\n');
        const deadline = rfq.submissionDeadline
            ? `\nSubmission deadline: ${new Date(rfq.submissionDeadline).toLocaleDateString()}\n`
            : '';
        const body =
`Dear ${vendor.contactPerson || vendor.vendorName},

This is a friendly reminder that we are still awaiting your quotation for the items below under RFQ ${rfq.rfqNumber}.
${deadline}
Items:
${lines}

If you have any questions or require clarification, please do not hesitate to reply to this email.

Kind regards,
${username}
MIDSA Procurement`;
        const href = `mailto:${vendor.vendorEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.location.href = href;
        logActivity(username, 'Drafted Vendor Reminder', `${rfq.rfqNumber} -> ${vendor.vendorName}`);
    }, [rfq, username]);

    // Download PDF for a specific vendor
    const handleDownloadVendorPDF = useCallback(async (vendor) => {
        if (!rfq || downloadingPDF) return;
        setDownloadingPDF(true);
        try {
            const rfqData = {
                rfqNumber: rfq.rfqNumber,
                title: rfq.title,
                submissionDeadline: rfq.submissionDeadline,
                deliveryDeadline: rfq.deliveryDeadline,
                currency: rfq.currency,
                notes: rfq.notes,
                vendor: {
                    name: vendor.vendorName,
                    contactPerson: vendor.contactPerson || '',
                    contactEmail: vendor.contactEmail || '',
                    contactPhone: vendor.contactPhone || '',
                    address: vendor.address || '',
                },
                lineItems: rfq.lineItems.map(li => ({
                    itemName: li.itemName,
                    quantity: li.quantity,
                    uom: li.uom || 'EA',
                    description: li.itemName,
                })),
            };
            const pdf = await PDFService.generateRFQPDF(rfqData);
            const vName = (vendor.vendorName || 'Vendor').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '-');
            const date = new Date().toISOString().slice(0, 10);
            pdf.save(`${vName}-${rfq.rfqNumber}-${date}.pdf`);
            setNotification({ type: 'success', message: `PDF downloaded for ${vendor.vendorName}.` });
        } catch (err) {
            setNotification({ type: 'error', message: 'Failed to generate PDF.' });
        } finally {
            setDownloadingPDF(false);
        }
    }, [rfq, downloadingPDF]);

    // Build preview data for the RFQ preview modal
    const previewRfqData = useMemo(() => {
        if (!rfq) return null;
        return {
            rfqNumber: rfq.rfqNumber,
            title: rfq.title,
            submissionDeadline: rfq.submissionDeadline,
            deliveryDeadline: rfq.deliveryDeadline,
            currency: rfq.currency,
            notes: rfq.notes,
            lineItems: rfq.lineItems.map(li => ({
                itemName: li.itemName,
                quantity: li.quantity,
                uom: li.uom || 'EA',
                description: li.itemName,
            })),
            vendors: rfq.vendors.map(v => ({
                vendorId: v.vendorId,
                vendorName: v.vendorName,
                contactPerson: v.contactPerson || '',
                contactEmail: v.contactEmail || '',
                contactPhone: v.contactPhone || '',
                address: v.address || '',
            })),
        };
    }, [rfq]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-24">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-4 border-primary"></div>
            </div>
        );
    }

    if (error || !rfq) {
        return (
            <div className="py-8">
                <p className="text-danger">Error: {error || 'RFQ not found.'}</p>
                <Button variant="ghost" size="sm" onClick={() => navigateTo('rfqList')} className="mt-4">Back</Button>
            </div>
        );
    }

    const isFinal = rfq.status === 'AWARDED' || rfq.status === 'CANCELLED';

    return (
        <>
            {notification && (
                <Notification
                    message={notification.message}
                    type={notification.type}
                    onDismiss={() => setNotification(null)}
                />
            )}
            {confirmCancel && (
                <ConfirmationModal
                    title="Cancel RFQ"
                    message={`Cancel RFQ ${rfq.rfqNumber}? Linked PRs will revert to OPEN.`}
                    onConfirm={handleCancel}
                    onCancel={() => setConfirmCancel(false)}
                    confirmText="Cancel RFQ"
                    confirmColor="bg-red-600"
                />
            )}
            {logVendor && (
                <LogVendorResponseModal
                    rfq={rfq}
                    vendor={logVendor}
                    defaultPrId={logDefaultPr}
                    onSave={handleSaveResponse}
                    onCancel={() => { setLogVendor(null); setLogDefaultPr(null); }}
                />
            )}
            {recommendVendor && (
                <RecommendVendorModal
                    rfq={rfq}
                    vendor={recommendVendor}
                    recommendation={recommendation}
                    onSubmit={handleRecommend}
                    onCancel={() => setRecommendVendor(null)}
                />
            )}
            {/* RFQ PDF Preview Modal */}
            <RFQPreviewModal
                open={showPreview}
                onClose={() => setShowPreview(false)}
                rfqData={previewRfqData}
                onConfirmSend={async () => {
                    await handleSendEmails();
                    setShowPreview(false);
                }}
                onSaveDraft={() => setShowPreview(false)}
            />

            <PageHeader
                title={
                    <span className="flex items-center gap-3">
                        {rfq.rfqNumber}
                        <StatusBadge value={rfq.status} />
                    </span>
                }
                subtitle={rfq.title}
                actions={
                    <Button variant="ghost" size="sm" onClick={() => navigateTo('rfqList')} leftIcon={<Icon id="arrow-left" />}>
                        Back
                    </Button>
                }
            />

                {/* Workflow stepper — shows the 7-stage RFQ lifecycle at a glance */}
                <RFQWorkflowStepper status={rfq.status} />

                {/* Phase 5 — escalation / past-deadline risk banner */}
                <EscalationBanner
                    rfq={rfq}
                    canEscalate={canEscalate}
                    onEscalate={handleEscalate}
                    submitting={escalating}
                />

                {/* Contextual next-action banner — tells the user what to do next */}
                <NextActionBanner
                    rfq={rfq}
                    canManage={canActOnRfq}
                    vendorCount={rfq.vendors.length}
                    responseCount={(() => {
                        const respondedSet = new Set(rfq.responses.map(r => r.vendorId));
                        return respondedSet.size;
                    })()}
                    onLogResponse={() => {
                        // Pick the first vendor that has not yet fully responded
                        const target = rfq.vendors.find(v => {
                            const cov = vendorResponseCoverage[v.vendorId];
                            return !cov?.complete;
                        }) || rfq.vendors[0];
                        if (target) {
                            setLogVendor(target);
                            setLogDefaultPr(rfq.lineItems[0]?.prId);
                        }
                    }}
                    onAward={() => {
                        // Prefer the system recommendation; fall back to best-value; finally cheapest
                        const systemRec = recommendation?.recommendedVendorId
                            ? rfq.vendors.find(v => v.vendorId === recommendation.recommendedVendorId)
                            : null;
                        const target = systemRec
                            || (bestValueVendorId ? rfq.vendors.find(v => v.vendorId === bestValueVendorId) : null)
                            || sortedVendorsByCost[0];
                        if (target) setRecommendVendor(target);
                    }}
                    onSend={() => setShowPreview(true)}
                    onPreviewPdfs={() => setShowPreview(true)}
                />

                {/* Multi-criteria system recommendation — shown once responses start coming in */}
                {recommendation && rfq.responses.length > 0 && !isFinal && rfq.status !== 'PENDING_APPROVAL' && (
                    <SystemRecommendation
                        data={recommendation}
                        currency={rfq.currency}
                        canAward={canApproveAward}
                        onAward={(vendor) => setRecommendVendor(vendor)}
                        rfqVendors={rfq.vendors}
                    />
                )}

                {/* Pending-approval summary — shown once a recommendation has been submitted */}
                {rfq.status === 'PENDING_APPROVAL' && rfq.recommendedVendorId && (
                    <div className="bg-amber-50 border-l-4 border-amber-400 rounded-xl p-5 mb-6 shadow-sm">
                        <div className="flex items-start gap-3">
                            <Icon id="user-check" className="text-2xl text-amber-700 mt-1" />
                            <div className="flex-1">
                                <p className="text-xs text-amber-700 uppercase tracking-wider font-semibold">Awaiting Procurement Head Approval</p>
                                <h3 className="text-lg font-bold text-gray-900 mt-1">
                                    {rfq.vendors.find(v => v.vendorId === rfq.recommendedVendorId)?.vendorName || 'Vendor'}
                                </h3>
                                {rfq.recommendationScore != null && (
                                    <p className="text-sm text-gray-700 mt-1">
                                        Score: <strong>{Number(rfq.recommendationScore).toFixed(1)}/100</strong>
                                        {' · '}
                                        Total: <strong>{rfq.currency} {Number(rfq.totalAwardAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                                    </p>
                                )}
                                {rfq.recommendationReason && (
                                    <p className="text-sm text-gray-700 mt-1 italic">"{rfq.recommendationReason}"</p>
                                )}
                                <p className="text-xs text-gray-500 mt-2">
                                    Recommended by <strong>{rfq.recommendedBy}</strong>
                                    {rfq.recommendedAt && ` on ${new Date(rfq.recommendedAt).toLocaleString()}`}
                                    {rfq.allowPartial && <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 text-[10px] font-medium">Partial Award</span>}
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Post-award summary — download / email the award letter */}
                {(rfq.status === 'AWARDED' || rfq.status === 'CLOSED') && (
                    <div className="bg-emerald-50 border-l-4 border-emerald-500 rounded-xl p-5 mb-6 shadow-sm">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                            <div className="flex items-start gap-3 flex-1">
                                <div className="text-3xl mt-1">🏆</div>
                                <div>
                                    <p className="text-xs text-emerald-700 uppercase tracking-wider font-semibold">Award Complete</p>
                                    <h3 className="text-lg font-bold text-gray-900 mt-1">
                                        {rfq.vendors.find(v => v.vendorId === rfq.awardedVendorId)?.vendorName || 'Vendor'} has been awarded.
                                    </h3>
                                    <p className="text-sm text-gray-700 mt-1">
                                        Total: <strong>{rfq.currency} {Number(rfq.totalAwardAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                                        {rfq.approvedBy && <span className="text-xs text-gray-500 ml-2">· Approved by {rfq.approvedBy}</span>}
                                    </p>
                                </div>
                            </div>
                            {canApproveAward && (
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={() => handleDownloadAwardLetter(false)}
                                        disabled={generatingAwardPDF}
                                        className="px-4 py-2 bg-white border border-emerald-300 text-emerald-700 rounded-md text-sm font-medium hover:bg-emerald-50"
                                    >
                                        <Icon id="file-pdf" className="mr-1" />Download Award Letter
                                    </button>
                                    <button
                                        onClick={() => handleDownloadAwardLetter(true)}
                                        disabled={generatingAwardPDF}
                                        className="px-4 py-2 bg-emerald-600 text-white rounded-md text-sm font-medium hover:bg-emerald-700"
                                    >
                                        <Icon id="envelope" className="mr-1" />Email Award Letter
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 space-y-6">
                        {/* Line Items */}
                        <div className="bg-white p-6 rounded-xl shadow-md">
                            <h2 className="text-lg font-semibold mb-4">Line Items</h2>
                            <table className="w-full text-left text-sm">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="p-2 text-xs uppercase text-gray-500">PR #</th>
                                        <th className="p-2 text-xs uppercase text-gray-500">Item</th>
                                        <th className="p-2 text-xs uppercase text-gray-500 text-center">Qty</th>
                                        <th className="p-2 text-xs uppercase text-gray-500">PR Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rfq.lineItems.map(li => (
                                        <tr key={li.rfqLineId} className="border-b">
                                            <td className="p-2 font-mono text-xs">{li.prNumber}</td>
                                            <td className="p-2">{li.itemName}</td>
                                            <td className="p-2 text-center">{li.quantity} {li.uom}</td>
                                            <td className="p-2 text-xs">{li.prStatus}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Vendor Response Cards — at-a-glance status per vendor */}
                        {rfq.vendors.length > 0 && (
                            <div className="bg-white p-6 rounded-xl shadow-md">
                                <div className="flex items-center justify-between mb-4">
                                    <div>
                                        <h2 className="text-lg font-semibold">Vendor Responses</h2>
                                        <p className="text-xs text-gray-500 mt-0.5">Track each invited vendor and log their responses as they come in.</p>
                                    </div>
                                    <span className="text-xs text-gray-500">
                                        {(() => {
                                            const responded = new Set(rfq.responses.map(r => r.vendorId)).size;
                                            return `${responded}/${rfq.vendors.length} responded`;
                                        })()}
                                    </span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {rfq.vendors.map(v => {
                                        const vendorResponses = rfq.responses.filter(r => r.vendorId === v.vendorId);
                                        return (
                                            <VendorResponseCard
                                                key={v.vendorId}
                                                vendor={v}
                                                responses={vendorResponses}
                                                lineCount={rfq.lineItems.length}
                                                deadline={rfq.submissionDeadline}
                                                canManage={canLogResponse && !isFinal}
                                                onLog={() => { setLogVendor(v); setLogDefaultPr(rfq.lineItems[0]?.prId); }}
                                                onEdit={() => { setLogVendor(v); setLogDefaultPr(rfq.lineItems[0]?.prId); }}
                                                onRemind={() => handleSendReminder(v)}
                                            />
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Detailed Vendor Comparison Matrix — for side-by-side line-level analysis */}
                        <div className="bg-white p-6 rounded-xl shadow-md">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-semibold">Detailed Comparison Matrix</h2>
                                {bestValueVendorId && !isFinal && (
                                    <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">
                                        Best Value: {rfq.vendors.find(v => v.vendorId === bestValueVendorId)?.vendorName}
                                    </span>
                                )}
                            </div>
                            {rfq.vendors.length === 0 ? (
                                <p className="text-gray-500">No vendors invited.</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                <th className="p-2 text-xs uppercase text-gray-500">Vendor</th>
                                                {rfq.lineItems.map(li => (
                                                    <th key={li.prId} className="p-2 text-xs uppercase text-gray-500 text-right">
                                                        {li.itemName}
                                                    </th>
                                                ))}
                                                <th className="p-2 text-xs uppercase text-gray-500 text-right">Total</th>
                                                <th className="p-2 text-xs uppercase text-gray-500 text-center">Coverage</th>
                                                <th className="p-2"></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sortedVendorsByCost.map((v) => {
                                                const total = vendorTotals[v.vendorId] || 0;
                                                const isBestValue = v.vendorId === bestValueVendorId && !isFinal;
                                                const winner = rfq.responses.some(
                                                    r => r.vendorId === v.vendorId && r.isWinner
                                                );
                                                const coverage = vendorResponseCoverage[v.vendorId];
                                                return (
                                                    <tr
                                                        key={v.vendorId}
                                                        className={`border-b ${
                                                            winner ? 'bg-green-50' :
                                                            isBestValue ? 'bg-blue-50' : ''
                                                        }`}
                                                    >
                                                        <td className="p-2">
                                                            <div className="font-medium flex items-center gap-1">
                                                                {v.vendorName}
                                                                {isBestValue && <span className="text-green-600 text-xs" title="Best Value">&#9733;</span>}
                                                            </div>
                                                            <div className="text-xs text-gray-500">
                                                                {v.responseStatus}
                                                                {v.emailSentAt ? ` | emailed ${new Date(v.emailSentAt).toLocaleDateString()}` : ''}
                                                            </div>
                                                        </td>
                                                        {rfq.lineItems.map(li => {
                                                            const r = matrix[v.vendorId] && matrix[v.vendorId][li.prId];
                                                            const isLowestForItem = lowestPerItem[li.prId] === v.vendorId;
                                                            return (
                                                                <td key={li.prId} className="p-2 text-right">
                                                                    {r ? (
                                                                        <span className={isLowestForItem && !isFinal ? 'text-green-700 font-semibold' : ''}>
                                                                            {r.unitCost.toFixed(2)}
                                                                        </span>
                                                                    ) : (
                                                                        <button
                                                                            onClick={() => { setLogVendor(v); setLogDefaultPr(li.prId); }}
                                                                            className="text-gray-300 hover:text-blue-500 text-xs"
                                                                            title={`Log response for ${v.vendorName} - ${li.itemName}`}
                                                                            disabled={isFinal || !canLogResponse}
                                                                        >
                                                                            {!isFinal && canLogResponse ? '+ Log' : '—'}
                                                                        </button>
                                                                    )}
                                                                </td>
                                                            );
                                                        })}
                                                        <td className="p-2 text-right font-semibold">
                                                            {total > 0 ? `${rfq.currency} ${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}
                                                        </td>
                                                        <td className="p-2 text-center">
                                                            {coverage && (
                                                                <span className={`text-xs px-2 py-0.5 rounded-full ${
                                                                    coverage.complete
                                                                        ? 'bg-green-100 text-green-700'
                                                                        : 'bg-amber-100 text-amber-700'
                                                                }`}>
                                                                    {coverage.responded}/{coverage.total}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="p-2 text-right">
                                                            {!isFinal && (canLogResponse || canRecommend) && (
                                                                <div className="flex gap-1 justify-end flex-wrap">
                                                                    {canLogResponse && (
                                                                        <button
                                                                            onClick={() => { setLogVendor(v); setLogDefaultPr(rfq.lineItems[0]?.prId); }}
                                                                            className="text-xs text-blue-600 hover:underline"
                                                                        >
                                                                            Log
                                                                        </button>
                                                                    )}
                                                                    {canRecommend && total > 0 && (
                                                                        <button
                                                                            onClick={() => setRecommendVendor(v)}
                                                                            className="text-xs text-emerald-600 hover:underline ml-1"
                                                                            title="Recommend this vendor for Procurement Head approval"
                                                                        >
                                                                            Recommend
                                                                        </button>
                                                                    )}
                                                                    <button
                                                                        onClick={() => handleDownloadVendorPDF(v)}
                                                                        className="text-xs text-gray-500 hover:underline ml-1"
                                                                        disabled={downloadingPDF}
                                                                    >
                                                                        PDF
                                                                    </button>
                                                                </div>
                                                            )}
                                                            {winner && <span className="text-xs text-green-700 font-semibold">Winner</span>}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        {/* Response Details */}
                        {rfq.responses.length > 0 && (
                            <div className="bg-white p-6 rounded-xl shadow-md">
                                <h2 className="text-lg font-semibold mb-4">Response Details</h2>
                                <div className="space-y-3">
                                    {rfq.responses.map(r => {
                                        const vendor = rfq.vendors.find(v => v.vendorId === r.vendorId);
                                        const line   = rfq.lineItems.find(li => li.prId === r.prId);
                                        return (
                                            <div key={r.id} className={`border rounded-md p-3 text-sm ${r.isWinner ? 'border-green-400 bg-green-50' : 'border-gray-200'}`}>
                                                <div className="flex justify-between">
                                                    <div className="font-medium">
                                                        {vendor?.vendorName} &rarr; {line?.itemName}
                                                    </div>
                                                    {r.isWinner && <span className="text-xs text-green-700 font-semibold">Winner</span>}
                                                </div>
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2 text-xs text-gray-600">
                                                    <div>Unit: <strong>{r.unitCost.toFixed(2)}</strong></div>
                                                    <div>Qty: <strong>{r.quantity}</strong></div>
                                                    <div>Freight: <strong>{r.freight.toFixed(2)}</strong></div>
                                                    <div>Total: <strong>{r.totalCost.toFixed(2)}</strong></div>
                                                    <div>Lead: <strong>{r.leadTimeDays}d</strong></div>
                                                    <div>Validity: <strong>{r.validityDays}d</strong></div>
                                                    <div>Delivery: {r.deliveryTerms || '—'}</div>
                                                    <div>Payment: {r.paymentTerms || '—'}</div>
                                                </div>
                                                {r.notes && <p className="mt-2 text-xs text-gray-500 italic">{r.notes}</p>}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right sidebar */}
                    <div className="space-y-6">
                        {/* Summary card */}
                        <div className="bg-white p-6 rounded-xl shadow-md">
                            <h3 className="font-semibold mb-3">Summary</h3>
                            <dl className="text-sm space-y-2">
                                <div className="flex justify-between">
                                    <dt className="text-gray-500">Currency</dt>
                                    <dd>{rfq.currency}</dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt className="text-gray-500">Submission Deadline</dt>
                                    <dd>{rfq.submissionDeadline || '—'}</dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt className="text-gray-500">Delivery Deadline</dt>
                                    <dd>{rfq.deliveryDeadline || '—'}</dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt className="text-gray-500">Vendors</dt>
                                    <dd>{rfq.vendors.length}</dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt className="text-gray-500">Responses</dt>
                                    <dd>{rfq.responses.length}</dd>
                                </div>
                                <div className="flex justify-between">
                                    <dt className="text-gray-500">Created By</dt>
                                    <dd className="text-xs">{rfq.createdBy || '—'}</dd>
                                </div>
                                {rfq.awardedAt && (
                                    <>
                                        <hr className="my-1" />
                                        <div className="flex justify-between">
                                            <dt className="text-gray-500">Awarded On</dt>
                                            <dd className="text-xs">{new Date(rfq.awardedAt).toLocaleDateString()}</dd>
                                        </div>
                                        {rfq.awardedBy && (
                                            <div className="flex justify-between">
                                                <dt className="text-gray-500">Awarded By</dt>
                                                <dd className="text-xs font-medium">{rfq.awardedBy}</dd>
                                            </div>
                                        )}
                                        <div className="flex justify-between">
                                            <dt className="text-gray-500">Award Amount</dt>
                                            <dd className="font-semibold text-green-700">
                                                {rfq.currency} {Number(rfq.totalAwardAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                            </dd>
                                        </div>
                                        {rfq.awardedBy && rfq.createdBy && rfq.awardedBy !== rfq.createdBy && (
                                            <div className="mt-2 px-2 py-1 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
                                                ✓ Controller-approved award
                                            </div>
                                        )}
                                    </>
                                )}
                            </dl>
                        </div>

                        {/* Actions card — outer wrapper opens only when the user
                            has at least one actionable permission. Each individual
                            button below carries its own specific gate so PO doesn't
                            see PH-only buttons (Approve/Reject/Cancel) even though
                            both roles see the card itself. */}
                        {canActOnRfq && (
                            <div className="bg-white p-6 rounded-xl shadow-md space-y-3">
                                <h3 className="font-semibold mb-2">Actions</h3>

                                {/* Procurement-head approval flow.
                                 *  Approve = `rfq.approve.award` (head-only).
                                 *  Reject  = `rfq.reject` (head-only).
                                 *  Officers without approve permission still see the
                                 *  Pending-Approval state via the amber banner above
                                 *  the Actions card — they just can't stamp it. */}
                                {rfq.status === 'PENDING_APPROVAL' && canApproveAward && (
                                    <>
                                        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 text-sm text-yellow-800 mb-2">
                                            This RFQ is awaiting your approval as Procurement Head.
                                        </div>
                                        <button
                                            onClick={handleControllerApprove}
                                            className="w-full py-2 px-4 bg-green-600 text-white rounded-md text-sm hover:bg-green-700"
                                        >
                                            Approve Award
                                        </button>
                                        {canRejectAward && (
                                            <button
                                                onClick={handleControllerReject}
                                                className="w-full py-2 px-4 border border-orange-300 text-orange-600 rounded-md text-sm hover:bg-orange-50"
                                            >
                                                Reject (Send Back)
                                            </button>
                                        )}
                                    </>
                                )}
                                {/* Finance-side read-only notice — only renders for
                                    finance users (legacy `controller` maps to
                                    finance_head and also satisfies the check). PH
                                    excluded explicitly so they don't see the
                                    "you're read-only" notice while approving. */}
                                {rfq.status === 'PENDING_APPROVAL' && canFinanceView && !canApproveAward && (
                                    <div className="bg-gray-50 border border-gray-200 rounded-md p-3 text-sm text-gray-700">
                                        Awaiting Procurement Head approval. Finance is read-only for RFQ awards.
                                    </div>
                                )}

                                {/* Send / resend emails with preview — gated by
                                    `rfq.send` (both PH and PO have it). */}
                                {canSend && !isFinal && (rfq.status === 'DRAFT' || rfq.status === 'SENT') && (
                                    <button
                                        onClick={() => setShowPreview(true)}
                                        className="w-full py-2 px-4 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
                                    >
                                        <Icon id="paper-plane" className="mr-2" />
                                        {rfq.status === 'DRAFT' ? 'Preview & Send to Vendors' : 'Preview & Resend Emails'}
                                    </button>
                                )}

                                {/* Preview / download vendor PDFs — available to
                                    anyone viewing the Actions card; pure read action. */}
                                {!isFinal && (
                                    <button
                                        onClick={() => setShowPreview(true)}
                                        className="w-full py-2 px-4 border border-gray-300 text-gray-700 rounded-md text-sm hover:bg-gray-50"
                                        title="Open PDF preview to view or download individual vendor PDFs"
                                    >
                                        <Icon id="file-pdf" className="mr-2 text-red-500" />
                                        Preview / Download PDFs
                                    </button>
                                )}

                                {/* Cancel RFQ — head-only (`rfq.cancel`). Officers
                                    creating an RFQ they later regret must escalate
                                    to the head to cancel; preserves the head's
                                    oversight over RFQ-level state changes. */}
                                {canCancelRfq && !isFinal && (
                                    <button
                                        onClick={handleCancel}
                                        className="w-full py-2 px-4 border border-red-300 text-red-600 rounded-md text-sm hover:bg-red-50"
                                    >
                                        Cancel RFQ
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Read-only notice for officers viewing an RFQ they
                            don't own. Mirrors the PR-detail read-only banner —
                            communicates intent rather than just hiding the
                            Actions card silently. An officer landing here from
                            a stale link or curiosity sees a clear explanation
                            of why they can't act. */}
                        {isOfficerReadOnly && (
                            <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl text-sm text-amber-800">
                                <div className="font-semibold mb-1">Read-only view</div>
                                <div>
                                    This RFQ isn't linked to any PR currently assigned to you.
                                    Ask the procurement head to reassign a linked requisition to
                                    you before working on it.
                                </div>
                            </div>
                        )}

                        {/* Notes card */}
                        {rfq.notes && (
                            <div className="bg-surface p-6 rounded-panel shadow-card border border-line">
                                <h3 className="font-semibold mb-2">Notes</h3>
                                <p className="text-sm text-ink-muted whitespace-pre-wrap">{rfq.notes}</p>
                            </div>
                        )}
                    </div>
                </div>
        </>
    );
};

export default RFQDetail;
