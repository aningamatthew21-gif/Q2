import { useState, useEffect } from 'react';
import api from '../api';
import socket from '../socket';
import { setCachedData } from '../utils/cache';

export const useRealtimeCustomers = (db, appId) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        // We no longer strictly need 'db' or 'appId', but we keep the signature 
        // to avoid breaking the 15+ components that consume this hook.
        
        let isMounted = true;

        const fetchData = async () => {
            try {
                if (isMounted) setLoading(true);
                const response = await api.get('/customers');
                if (isMounted && response.success) {
                    const result = response.data;
                    setData(result);
                    setError(null);
                    
                    // Update cache for other components
                    setCachedData('customers-default', result);
                    setCachedData('quoting-customers-default', result);
                    setCachedData('invoice-editor-customers-default', result);
                }
            } catch (err) {
                if (isMounted) {
                    console.error("Failed to load customers:", err);
                    setError(err.message || 'Failed to load customers');
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
            console.log('🔄 [WS] Real-time customer update received');
            fetchData();
        };

        socket.on('customers:updated', handleUpdate);

        // M5 — catch up on missed events after reconnect
        const handleReconnect = () => {
            console.log('🔄 [WS] Socket reconnected — refetching customers.');
            fetchData();
        };
        socket.io.on('reconnect', handleReconnect);

        return () => {
            isMounted = false;
            socket.off('customers:updated', handleUpdate);
            socket.io.off('reconnect', handleReconnect);
        };
    }, [db, appId]); // Keep dependencies identical to avoid refactoring components

    return { data, loading, error };
};
