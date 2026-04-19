import React, { useState, useEffect } from 'react';
import api from '../api';
import socket from '../socket';
import Icon from '../components/common/Icon';
import Notification from '../components/common/Notification';
import ConfirmationModal from '../components/modals/ConfirmationModal';
import { logActivity } from '../utils/logger';
import { useApp } from '../context/AppContext';

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
    const { userEmail } = useApp();
    const username = userEmail ? userEmail.split('@')[0] : 'System';

    const role = currentUser?.role;
    const canEdit = role === 'procurement' || role === 'controller' || role === 'admin';
    const backPage = role === 'procurement' ? 'procurementDashboard' : 'controllerDashboard';

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

    const handleAssignToMe = async () => {
        try {
            await api.put(`/purchase-requisitions/${prId}`, { assignedTo: userEmail });
            await logActivity(username, 'Assigned PR', `Self-assigned ${pr.prNumber}`);
            setNotification({ type: 'success', message: 'Assigned to you.' });
        } catch (err) {
            setNotification({ type: 'error', message: 'Failed to assign.' });
        }
    };

    const handleCancel = async () => {
        const reason = window.prompt(
            `Reason for cancelling PR ${pr.prNumber}?\n(Leave blank for default)`,
            'No longer required'
        );
        if (reason === null) return; // user clicked Cancel in the browser prompt
        try {
            await api.post(`/purchase-requisitions/${prId}/cancel`, { reason: reason.trim() || 'No longer required' });
            await logActivity(username, 'Cancelled PR', pr.prNumber);
            setNotification({ type: 'success', message: 'PR cancelled.' });
        } catch (err) {
            setNotification({ type: 'error', message: 'Failed to cancel PR.' });
        }
    };

    const handleMarkFulfilled = async () => {
        if (!window.confirm(`Mark PR ${pr.prNumber} as Fulfilled? This confirms the item has been received.`)) return;
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
            <div className="min-h-screen bg-gray-100 flex items-center justify-center">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-4 border-blue-600"></div>
            </div>
        );
    }

    if (error || !pr) {
        return (
            <div className="min-h-screen bg-gray-100 p-8">
                <p className="text-red-600">Error: {error || 'PR not found.'}</p>
                <button onClick={() => navigateTo(backPage)} className="mt-4 text-blue-600">← Back</button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100">
            <div className="max-w-5xl mx-auto p-4 md:p-8">
                {notification && <Notification message={notification.message} type={notification.type} onDismiss={() => setNotification(null)} />}

                <header className="bg-white p-4 rounded-xl shadow-md mb-6 flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold">{pr.prNumber || 'Purchase Requisition'}</h1>
                        <p className="text-sm text-gray-500">Created {pr.createdAt ? new Date(pr.createdAt).toLocaleString() : '—'}</p>
                    </div>
                    <button onClick={() => navigateTo('purchaseRequisitions')} className="text-sm">
                        <Icon id="arrow-left" className="mr-1" /> Back to list
                    </button>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-md">
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
                        <div className="bg-white p-6 rounded-xl shadow-md">
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

                        {canEdit && pr.status !== 'CANCELLED' && pr.status !== 'FULFILLED' && (
                            <div className="bg-white p-6 rounded-xl shadow-md space-y-3">
                                <h3 className="font-semibold mb-2">Actions</h3>
                                {!pr.assignedTo && (
                                    <button onClick={handleAssignToMe} className="w-full py-2 px-4 bg-blue-600 text-white rounded-md text-sm">
                                        Assign to me
                                    </button>
                                )}
                                {pr.status === 'OPEN' && (
                                    <button onClick={() => navigateTo('rfqBuilder', { preselectedPrIds: [prId] })} className="w-full py-2 px-4 bg-purple-600 text-white rounded-md text-sm hover:bg-purple-700">
                                        Create RFQ for this PR
                                    </button>
                                )}
                                {pr.status === 'AWARDED' && (
                                    <button
                                        onClick={handleMarkFulfilled}
                                        className="w-full py-2 px-4 bg-emerald-600 text-white rounded-md text-sm hover:bg-emerald-700"
                                    >
                                        ✓ Mark as Fulfilled
                                    </button>
                                )}
                                <button onClick={() => handleCancel()} className="w-full py-2 px-4 border border-red-300 text-red-600 rounded-md text-sm">
                                    Cancel Requisition
                                </button>
                            </div>
                        )}

                        {pr.events && pr.events.length > 0 && (
                            <div className="bg-white p-6 rounded-xl shadow-md">
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
            </div>
        </div>
    );
};

export default PurchaseRequisitionDetail;
