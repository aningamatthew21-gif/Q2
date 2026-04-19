import { useState, useEffect } from 'react';
import api from '../api';
import socket from '../socket';

/**
 * useRealtimeInvoices
 * @param {string} userId - Optional. If provided, filters invoices by createdBy.
 * @param {string} customerId - Optional. If provided, filters by customerId.
 */
export const useRealtimeInvoices = (userId = null, customerId = null) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let isMounted = true;

        const fetchData = async () => {
            try {
                if (isMounted) setLoading(true);

                const params = {};
                if (userId) params.createdBy = userId;
                if (customerId) params.customerId = customerId;

                const response = await api.get('/invoices', { params });

                if (isMounted && response.success) {
                    setData(response.data || []);
                    setError(null);
                }
            } catch (err) {
                if (isMounted) {
                    console.error("Failed to load invoices:", err);
                    setError(err.message || 'Failed to load invoices');
                }
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        // Initial fetch
        fetchData();

        // Ensure socket is connected
        if (!socket.connected) socket.connect();

        // Listen for real-time WebSocket updates triggered by Oracle DB writes
        const handleUpdate = () => {
            console.log('🔄 [WS] Real-time invoice update received');
            fetchData();
        };

        socket.on('invoices:updated', handleUpdate);

        // M5 — on reconnect after a disconnect, re-fetch so we pick up any events
        // that happened while we were offline.
        const handleReconnect = () => {
            console.log('🔄 [WS] Socket reconnected — refetching invoices to catch up.');
            fetchData();
        };
        socket.io.on('reconnect', handleReconnect);

        return () => {
            isMounted = false;
            socket.off('invoices:updated', handleUpdate);
            socket.io.off('reconnect', handleReconnect);
        };
    }, [userId, customerId]);

    return { data, loading, error };
};
