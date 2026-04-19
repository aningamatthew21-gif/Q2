import React, { useState, useEffect } from 'react';
import StaleInvoiceModal from './modals/StaleInvoiceModal';
import { useApp } from '../context/AppContext';
import { logActivity } from '../utils/logger';
import api from '../api';

const GlobalStaleCheck = () => {
    const { userId } = useApp();
    const [staleInvoices, setStaleInvoices] = useState([]);
    const [showStaleModal, setShowStaleModal] = useState(false);

    useEffect(() => {
        // 1. Only run if user is logged in
        if (!userId) return;

        // 2. Check session storage so we don't annoy them on every refresh
        const hasChecked = sessionStorage.getItem('hasCheckedStaleInvoices');
        if (hasChecked) return;

        const checkStaleInvoices = async () => {
            try {
                const sevenDaysAgo = new Date();
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

                // Fetch invoices awaiting acceptance created by this user
                const response = await api.get('/invoices', {
                    params: {
                        status: 'Awaiting Acceptance',
                        createdBy: userId
                    }
                });

                if (!response.success) return;

                // Filter client-side by date
                const stale = (response.data || []).filter(inv => {
                    const sentAt = inv.sentAt ? new Date(inv.sentAt) : 
                                   inv.createdAt ? new Date(inv.createdAt) : null;
                    return sentAt && sentAt < sevenDaysAgo;
                });

                if (stale.length > 0) {
                    setStaleInvoices(stale);
                    setShowStaleModal(true);
                }

                // Mark as checked for this session
                sessionStorage.setItem('hasCheckedStaleInvoices', 'true');

            } catch (error) {
                console.error("Error checking stale invoices:", error);
            }
        };

        checkStaleInvoices();
    }, [userId]);

    const handleStaleAction = async (invoice, action) => {
        try {
            const updateData = {
                status: action,
                customerActionAt: new Date().toISOString()
            };

            if (action === 'Customer Rejected') {
                updateData.rejectionReason = 'Marked as rejected via Stale Alert';

                // Restore inventory stock for each item
                const itemsToRestore = invoice.items || invoice.lineItems || [];
                for (const item of itemsToRestore) {
                    if (item.id && item.type !== 'sourced') {
                        try {
                            const invRes = await api.get(`/inventory/${item.id}`);
                            if (invRes.success && invRes.data) {
                                const restoredStock = (invRes.data.stock || 0) + (Number(item.quantity) || 0);
                                await api.put(`/inventory/${item.id}`, { stock: restoredStock });
                            }
                        } catch (invErr) {
                            console.warn(`Stock restore failed for ${item.id}`, invErr);
                        }
                    }
                }
            }

            await api.put(`/invoices/${invoice.id}`, updateData);

            await logActivity(userId, action, `Stale invoice ${invoice.invoiceNumber} marked as ${action}`, {
                category: 'invoice',
                invoiceId: invoice.id
            });

            // Remove the handled invoice from the local popup list
            setStaleInvoices(prev => prev.filter(inv => inv.id !== invoice.id));

            // Close modal if list is empty
            if (staleInvoices.length <= 1) {
                setShowStaleModal(false);
            }
        } catch (err) {
            console.error("Error updating stale invoice:", err);
            alert("Could not update invoice. Please try again.");
        }
    };

    if (!showStaleModal) return null;

    return (
        <StaleInvoiceModal
            invoices={staleInvoices}
            onClose={() => setShowStaleModal(false)}
            onAction={handleStaleAction}
        />
    );
};

export default GlobalStaleCheck;
