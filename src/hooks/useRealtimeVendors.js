import { useState, useEffect } from 'react';
import api from '../api';
import socket from '../socket';
import { setCachedData } from '../utils/cache';

export const useRealtimeVendors = (db, appId) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let isMounted = true;

        const fetchData = async () => {
            try {
                if (isMounted) setLoading(true);
                const response = await api.get('/vendors');
                if (isMounted && response.success) {
                    const result = response.data;
                    setData(result);
                    setError(null);
                    setCachedData('vendors-default', result);
                }
            } catch (err) {
                if (isMounted) {
                    console.error('Failed to load vendors:', err);
                    setError(err.message || 'Failed to load vendors');
                }
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchData();

        if (!socket.connected) socket.connect();

        const handleUpdate = () => {
            console.log('🔄 [WS] Real-time vendor update received');
            fetchData();
        };

        socket.on('vendors:updated', handleUpdate);

        // M5 — catch up on missed events after reconnect
        const handleReconnect = () => {
            console.log('🔄 [WS] Socket reconnected — refetching vendors.');
            fetchData();
        };
        socket.io.on('reconnect', handleReconnect);

        return () => {
            isMounted = false;
            socket.off('vendors:updated', handleUpdate);
            socket.io.off('reconnect', handleReconnect);
        };
    }, [db, appId]);

    return { data, loading, error };
};
