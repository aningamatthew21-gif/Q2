import { useState, useEffect } from 'react';
import api from '../api';
import socket from '../socket';
import { setCachedData } from '../utils/cache';

export const useRealtimePRs = (filters = {}) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 50, totalPages: 1 });

    const filterKey = JSON.stringify(filters);

    useEffect(() => {
        let isMounted = true;

        const fetchData = async () => {
            try {
                if (isMounted) setLoading(true);
                const params = new URLSearchParams();
                if (filters.status)     params.append('status', filters.status);
                if (filters.assignedTo) params.append('assignedTo', filters.assignedTo);
                if (filters.invoiceId)  params.append('invoiceId', filters.invoiceId);
                if (filters.page)       params.append('page', filters.page);
                if (filters.pageSize)   params.append('pageSize', filters.pageSize);

                const path = `/purchase-requisitions${params.toString() ? `?${params}` : ''}`;
                const response = await api.get(path);
                if (isMounted && response.success) {
                    setData(response.data || []);
                    if (response.pagination) setPagination(response.pagination);
                    setError(null);
                    setCachedData('prs-default', response.data || []);
                }
            } catch (err) {
                if (isMounted) {
                    console.error('Failed to load purchase requisitions:', err);
                    setError(err.message || 'Failed to load purchase requisitions');
                }
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchData();

        if (!socket.connected) socket.connect();

        const handleUpdate = () => {
            console.log('🔄 [WS] Real-time PR update received');
            fetchData();
        };

        socket.on('pr:updated', handleUpdate);

        // M5 — catch up on missed events after reconnect
        const handleReconnect = () => {
            console.log('🔄 [WS] Socket reconnected — refetching PRs.');
            fetchData();
        };
        socket.io.on('reconnect', handleReconnect);

        return () => {
            isMounted = false;
            socket.off('pr:updated', handleUpdate);
            socket.io.off('reconnect', handleReconnect);
        };
    }, [filterKey]);

    return { data, loading, error, pagination };
};
