import { useState, useEffect } from 'react';
import api from '../api';
import socket from '../socket';
import { setCachedData } from '../utils/cache';

export const useRealtimeRFQs = (filters = {}) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const filterKey = JSON.stringify(filters);

    useEffect(() => {
        let isMounted = true;

        const fetchData = async () => {
            try {
                if (isMounted) setLoading(true);
                const params = new URLSearchParams();
                if (filters.status) params.append('status', filters.status);

                const path = `/rfqs${params.toString() ? `?${params}` : ''}`;
                const response = await api.get(path);
                if (isMounted && response.success) {
                    setData(response.data || []);
                    setError(null);
                    setCachedData('rfqs-default', response.data || []);
                }
            } catch (err) {
                if (isMounted) {
                    console.error('Failed to load RFQs:', err);
                    setError(err.message || 'Failed to load RFQs');
                }
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchData();

        if (!socket.connected) socket.connect();

        const handleUpdate = () => {
            console.log('🔄 [WS] Real-time RFQ update received');
            fetchData();
        };

        socket.on('rfq:updated', handleUpdate);

        // M5 — catch up on missed events after reconnect
        const handleReconnect = () => {
            console.log('🔄 [WS] Socket reconnected — refetching RFQs.');
            fetchData();
        };
        socket.io.on('reconnect', handleReconnect);

        return () => {
            isMounted = false;
            socket.off('rfq:updated', handleUpdate);
            socket.io.off('reconnect', handleReconnect);
        };
    }, [filterKey]);

    return { data, loading, error };
};
