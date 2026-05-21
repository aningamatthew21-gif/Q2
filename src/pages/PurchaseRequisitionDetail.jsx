import React, { useState, useEffect } from 'react';
import api from '../api';
import socket from '../socket';
import Icon from '../components/common/Icon';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
import Notification from '../components/common/Notification';
import ConfirmationModal from '../components/modals/ConfirmationModal';
import AssignPRModal from '../components/modals/AssignPRModal';
import { logActivity } from '../utils/logger';
import { useApp } from '../context/AppContext';
import { usePrompt } from '../components/v2/PromptDialog';
import { can } from '../utils/permissions';

const PriorityBadge = ({ value }) => (
    <span className={`px-2 py-1 rounded-full text-xs ${
        value === 'urgent' ? 'bg-red-100 text-red-700'      :
        value === 'high'   ? 'bg-orange-100 text-orange-700' :
        'bg-gray-100 text-gray-700'
    }`}>{value}</span>
);

const StatusBadge = ({ value }) => (
    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
        value === 'OPEN'      ? 'bg-amber-100 text-amber-800'   :
        value === 'IN_RFQ'    ? 'bg-blue-100 text-blue-800'     :
        value === 'AWARDED'   ? 'bg-green-100 text-green-800'   :
        value === 'FULFILLED' ? 'bg-emerald-100 text-emerald-800':
        value === 'CANCELLED' ? 'bg-gray-100 text-gray-600'     :
        'bg-gray-100 text-gray-800'
    }`}>{value}</span>
);

const PurchaseRequisitionDetail = ({ navigateTo, pageContext, currentUser }) => {
    const prId = pageContext;
    const [pr, setPr] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [notification, setNotification] = useState(null);
    const [editingPriority, setEditingPriority] = useState(null);
    const [assignModalOpen, setAssignModalOpen] = useState(false);
    const { userEmail } = useApp();
    const { askText, askConfirm } = usePrompt();
    const username = userEmail ? userEmail.split('@')[0] : 'System';

    // Permission-driven action gates. The legacy literal role-string
    // check (`role === 'procurement' || 'controller' || 'admin'`) excluded
    // both `procurement_head` and `procurement_officer`, leaving heads
    // unable to assign and officers unable to work their own PRs.
    //
    //   canAssign   — head/admin only (reassign or initial assignment)
    //   isMine      — this PR is currently assigned to the viewer
    //   canEdit     — head can edit any PR; officer can edit only their own
    //   canCancel   — `pr.cancel` (head + officer) AND canEdit
    //   canFulfill  — `pr.fulfill` (head + officer) AND canEdit
    //
    // Officers viewing a PR not assigned to them get a read-only view:
    // they can see status, priority, history, linked invoice — but no
    // action buttons render until the head assigns it to them.
    const role        = currentUser?.role;
    const canAssign   = can(currentUser, 'pr.assign');
    const isMine      = pr?.assignedTo && pr.assignedTo === userEmail;
    const canEdit     = canAssign || isMine;
    const canCancel   = canEdit && can(currentUser, 'pr.cancel');
    const canFulfill  = canEdit && can(currentUser, 'pr.fulfill');

    // Back-link target — procurement users go to their dashboard;
    // anyone else (finance head with cross-dept visibility) goes to theirs.
    const backPage = (role === 'procurement_head' || role === 'procurement_officer' || role === 'procurement')
        ? 'procurementDashboard'
        : 'controllerDashboard';

    const fetchPR = async () => {
        try {
            setLoading(true);
            const response = await api.get(`/purchase-requisitions/${prId}`);
            if (response.success) {
                setPr(response.data);
                setEditingPriority(response.data.priority);
                setError(null);
            } else {
                setError(response.error || 'Not found');
            }
        } catch (err) {
            setError(err.message || 'Failed to load PR');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!prId) return;
        fetchPR();
        if (!socket.connected) socket.connect();
        const handler = () => fetchPR();
        socket.on('pr:updated', handler);
        return () => socket.off('pr:updated', handler);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prId]);

    const updatePriority = async (newPriority) => {
        try {
            await api.put(`/purchase-requisitions/${prId}`, { priority: newPriority });
            await logActivity(username, 'Updated PR Priority', `${pr.prNumber}: ${newPriority}`);
            setNotification({ type: 'success', message: 'Priority updated.' });
        } catch (err) {
            setNotification({ type: 'error', message: 'Failed to update priority.' });
        }
    };

    // Called by AssignPRModal after a successful assignment. We refresh
    // the PR from the server (instead of optimistically setting from the
    // assignee email alone) so the activity history and any server-side
    // side effects — like the PR_REASSIGNED event row — surface in the
    // History panel immediately.
    const handleAssignmentSaved = async (newAssigneeEmail) => {
        await logActivity(username,
            currentUser?.email === newAssigneeEmail ? 'Self-assigned PR' : 'Assigned PR',
            `${pr?.prNumber || prId} → ${newAssigneeEmail || 'unassigned'}`
        );
        setNotification({
            type: 'success',
            message: newAssigneeEmail
                ? (currentUser?.email === newAssigneeEmail ? 'Assigned to you.' : `Assigned to ${newAssigneeEmail}.`)
                : 'Assignment cleared.'
        });
        fetchPR();
    };

    const handleCancel = async () => {
        const reason = await askText({
            title:        `Cancel ${pr.prNumber}?`,
            description:  'The reason will be saved on the PR record and visible in the activity history. Leaving it blank uses the default "No longer required".',
            label:        'Reason for cancellation',
            defaultValue: 'No longer required',
            placeholder:  'No longer required',
            multiline:    true,
            maxLength:    300,
            confirmLabel: 'Cancel PR',
            confirmTone:  'danger',
            cancelLabel:  'Keep PR'
        });
        if (reason === null) return;
        try {
            await api.post(`/purchase-requisitions/${prId}/cancel`, { reason: (reason || '').trim() || 'No longer required' });
            await logActivity(username, 'Cancelled PR', pr.prNumber);
            setNotification({ type: 'success', message: 'PR cancelled.' });
        } catch (err) {
            setNotification({ type: 'error', message: 'Failed to cancel PR.' });
        }
    };

    const handleMarkFulfilled = async () => {
        const ok = await askConfirm({
            title:        `Mark ${pr.prNumber} as fulfilled?`,
            description:  'Confirms the item has been received from the vendor. This action cannot be undone.',
            confirmLabel: 'Mark fulfilled',
            confirmTone:  'primary'
        });
        if (!ok) return;
        try {
            await api.put(`/purchase-requisitions/${prId}`, { status: 'FULFILLED' });
            await logActivity(username, 'Marked PR Fulfilled', pr.prNumber);
            setNotification({ type: 'success', message: 'PR marked as Fulfilled.' });
        } catch (err) {
            setNotification({ type: 'error', message: 'Failed to update PR status.' });
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-24">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-4 border-primary"></div>
            </div>
        );
    }

    if (error || !pr) {
        return (
            <div className="py-8">
                <p className="text-danger">Error: {error || 'PR not found.'}</p>
                <Button variant="ghost" size="sm" onClick={() => navigateTo(backPage)} className="mt-4">← Back</Button>
            </div>
        );
    }

    return (
        <>
            {notification && <Notification message={notification.message} type={notification.type} onDismiss={() => setNotification(null)} />}

            <PageHeader
                title={pr.prNumber || 'Purchase Requisition'}
                subtitle={`Created ${pr.createdAt ? new Date(pr.createdAt).toLocaleString() : '—'}`}
                actions={
                    <Button variant="ghost" size="sm" onClick={() => navigateTo('purchaseRequisitions')} leftIcon={<Icon id="arrow-left" />}>
                        Back to list
                    </Button>
                }
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 bg-surface p-6 rounded-panel shadow-card border border-line">
                        <h2 className="text-xl font-semibold mb-4">Item Details</h2>
                        <dl className="grid grid-cols-2 gap-y-3">
                            <dt className="text-sm font-medium text-gray-500">Item</dt>
                            <dd className="text-sm font-semibold">{pr.itemName}</dd>

                            <dt className="text-sm font-medium text-gray-500">Description</dt>
                            <dd className="text-sm">{pr.itemDescription || '—'}</dd>

                            <dt className="text-sm font-medium text-gray-500">Quantity</dt>
                            <dd className="text-sm">{pr.quantity} {pr.uom}</dd>

                            <dt className="text-sm font-medium text-gray-500">Reason</dt>
                            <dd className="text-sm">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                    pr.reason === 'CUSTOM_SOURCED'   ? 'bg-purple-100 text-purple-700' :
                                    pr.reason === 'OUT_OF_STOCK'     ? 'bg-red-100 text-red-700'       :
                                    pr.reason === 'INSUFFICIENT'     ? 'bg-yellow-100 text-yellow-700' :
                                    pr.reason === 'NOT_IN_INVENTORY' ? 'bg-gray-100 text-gray-700'     :
                                    'bg-gray-100 text-gray-600'
                                }`}>
                                    {pr.reason === 'CUSTOM_SOURCED' ? 'Custom Sourced' :
                                     pr.reason === 'OUT_OF_STOCK' ? 'Out of Stock' :
                                     pr.reason === 'INSUFFICIENT' ? 'Backorder' :
                                     pr.reason === 'NOT_IN_INVENTORY' ? 'Not in Inventory' :
                                     pr.reason}
                                </span>
                            </dd>

                            <dt className="text-sm font-medium text-gray-500">Customer</dt>
                            <dd className="text-sm">{pr.customerName || '—'}</dd>

                            <dt className="text-sm font-medium text-gray-500">Needed By</dt>
                            <dd className="text-sm">{pr.neededBy || '—'}</dd>

                            <dt className="text-sm font-medium text-gray-500">Requested By</dt>
                            <dd className="text-sm">{pr.requestedBy || '—'}</dd>

                            <dt className="text-sm font-medium text-gray-500">Assigned To</dt>
                            <dd className="text-sm">{pr.assignedTo || 'Unassigned'}</dd>
                        </dl>

                        {pr.invoice && (
                            <>
                                <h3 className="text-lg font-semibold mt-6 mb-2">Linked Quote / Invoice</h3>
                                <div className="bg-gray-50 p-4 rounded-md">
                                    <div className="flex justify-between text-sm">
                                        <span className="font-mono text-gray-500">{pr.invoice.id}</span>
                                        <span className="font-medium">{pr.invoice.status}</span>
                                    </div>
                                    <div className="mt-2 text-sm">
                                        <span className="text-gray-600">Customer:</span> {pr.invoice.customerName}
                                    </div>
                                    <div className="mt-1 text-sm">
                                        <span className="text-gray-600">Sourcing:</span> {pr.invoice.sourcingStatus} ({pr.invoice.prCount} PR{pr.invoice.prCount !== 1 ? 's' : ''})
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="space-y-6">
                        <div className="bg-surface p-6 rounded-panel shadow-card border border-line">
                            <h3 className="font-semibold mb-3">Status</h3>
                            <StatusBadge value={pr.status} />
                            <h3 className="font-semibold mt-6 mb-2">Priority</h3>
                            {canEdit ? (
                                <select
                                    value={editingPriority}
                                    onChange={(e) => { setEditingPriority(e.target.value); updatePriority(e.target.value); }}
                                    className="w-full p-2 border rounded-md text-sm"
                                >
                                    <option value="low">Low</option>
                                    <option value="normal">Normal</option>
                                    <option value="high">High</option>
                                    <option value="urgent">Urgent</option>
                                </select>
                            ) : (
                                <PriorityBadge value={pr.priority} />
                            )}
                        </div>

                        {/* Actions panel — visible to the assignee (officer working
                            their own PR) AND to the head (who can act on any PR).
                            Officers viewing an unassigned-to-them PR see no panel:
                            the read-only fields above still tell them everything
                            they need to know, but the work buttons stay hidden. */}
                        {(canEdit || canAssign) && pr.status !== 'CANCELLED' && pr.status !== 'FULFILLED' && (
                            <div className="bg-surface p-6 rounded-panel shadow-card border border-line space-y-3">
                                <h3 className="font-semibold mb-2">Actions</h3>

                                {/* Assign / Reassign — head-only. Replaces the
                                    earlier one-click "Assign to me" with a
                                    proper picker modal so the head can route
                                    work to any officer in the department. */}
                                {canAssign && (
                                    <button
                                        onClick={() => setAssignModalOpen(true)}
                                        className="w-full py-2 px-4 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
                                    >
                                        {pr.assignedTo ? 'Reassign' : 'Assign'}
                                    </button>
                                )}

                                {/* Work actions — only the assignee (or head)
                                    can move the PR through its lifecycle. */}
                                {canEdit && pr.status === 'OPEN' && (
                                    <button onClick={() => navigateTo('rfqBuilder', { preselectedPrIds: [prId] })} className="w-full py-2 px-4 bg-purple-600 text-white rounded-md text-sm hover:bg-purple-700">
                                        Create RFQ for this PR
                                    </button>
                                )}
                                {canFulfill && pr.status === 'AWARDED' && (
                                    <button
                                        onClick={handleMarkFulfilled}
                                        className="w-full py-2 px-4 bg-emerald-600 text-white rounded-md text-sm hover:bg-emerald-700"
                                    >
                                        ✓ Mark as Fulfilled
                                    </button>
                                )}
                                {canCancel && (
                                    <button onClick={() => handleCancel()} className="w-full py-2 px-4 border border-red-300 text-red-600 rounded-md text-sm">
                                        Cancel Requisition
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Read-only notice for officers viewing a PR not
                            assigned to them — communicates intent rather than
                            silently hiding the panel. */}
                        {!canEdit && !canAssign && pr.status !== 'CANCELLED' && pr.status !== 'FULFILLED' && (
                            <div className="bg-amber-50 border border-amber-200 p-4 rounded-panel text-sm text-amber-800">
                                <div className="font-semibold mb-1">Read-only view</div>
                                <div>
                                    This PR isn't assigned to you. Ask the procurement head to assign
                                    it to you before working on it.
                                </div>
                            </div>
                        )}

                        {pr.events && pr.events.length > 0 && (
                            <div className="bg-surface p-6 rounded-panel shadow-card border border-line">
                                <h3 className="font-semibold mb-3">History</h3>
                                <ul className="text-xs space-y-2 max-h-64 overflow-y-auto">
                                    {pr.events.map(ev => (
                                        <li key={ev.id} className="border-l-2 border-gray-200 pl-3">
                                            <div className="font-medium text-gray-800">{ev.type}</div>
                                            <div className="text-gray-500">{ev.actor}</div>
                                            <div className="text-gray-400">{ev.time ? new Date(ev.time).toLocaleString() : ''}</div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
            </div>

            {/* Assign / Reassign picker — controlled from the Actions panel.
                Only mounts when the head has opened it, so the user list
                fetch only runs on demand. */}
            <AssignPRModal
                open={assignModalOpen}
                onClose={() => setAssignModalOpen(false)}
                prId={prId}
                prNumber={pr?.prNumber}
                currentAssignedTo={pr?.assignedTo}
                currentUserEmail={userEmail}
                onAssigned={handleAssignmentSaved}
            />
        </>
    );
};

export default PurchaseRequisitionDetail;
