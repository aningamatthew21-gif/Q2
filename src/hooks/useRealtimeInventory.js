import { useState, useEffect } from 'react';
import api from '../api';
import socket from '../socket';
import { setCachedData } from '../utils/cache';

// Real-time data fetching hooks for management components
export const useRealtimeInventory = (db, appId) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let isMounted = true;

        const fetchData = async () => {
            try {
                if (isMounted) setLoading(true);
                const response = await api.get('/inventory');
                if (isMounted && response.success) {
                    const result = response.data;
                    setData(result);
                    setError(null);

                    // Update cache for other components
                    setCachedData('inventory-management-default', result);
                    setCachedData('quoting-inventory-default', result);
                    setCachedData('invoice-editor-inventory-default', result);
                }
            } catch (err) {
                if (isMounted) {
                    console.error("Failed to load inventory:", err);
                    setError(err.message || 'Failed to load inventory');
                }
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchData();

        if (!socket.connected) socket.connect();

        const handleUpdate = () => {
            console.log('🔄 [WS] Real-time inventory update received');
            fetchData();
        };

        socket.on('inventory:updated', handleUpdate);

        // M5 — catch up on missed events after reconnect
        const handleReconnect = () => {
            console.log('🔄 [WS] Socket reconnected — refetching inventory.');
            fetchData();
        };
        socket.io.on('reconnect', handleReconnect);

        return () => {
            isMounted = false;
            socket.off('inventory:updated', handleUpdate);
            socket.io.off('reconnect', handleReconnect);
        };
    }, [db, appId]);

    return { data, loading, error };
};
