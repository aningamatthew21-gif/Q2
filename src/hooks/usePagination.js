import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';

const ITEMS_PER_PAGE = 20;

/**
 * REST API Pagination Hook
 * Replaces Firebase Firestore pagination.
 * 
 * @param {string} endpoint - The API endpoint (e.g. '/invoices')
 * @param {Object} queryParams - Additional filters for the API
 */
export const usePagination = (endpoint, queryParams = {}) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [hasMore, setHasMore] = useState(true);
    const [error, setError] = useState(null);
    
    const pageRef = useRef(1);

    const loadMore = useCallback(async (reset = false) => {
        if (!endpoint || endpoint.startsWith('artifacts')) return; // Ignore legacy firebase paths if not updated yet

        try {
            setLoading(true);
            setError(null);

            const currentPage = reset ? 1 : pageRef.current + 1;
            
            const params = new URLSearchParams({
                page: currentPage,
                limit: ITEMS_PER_PAGE,
                ...queryParams
            });

            const response = await api.get(`${endpoint}?${params.toString()}`);
            
            if (response.success) {
                const newData = response.data || [];
                
                if (reset) {
                    setData(newData);
                    pageRef.current = 1;
                } else {
                    setData(prev => [...prev, ...newData]);
                    pageRef.current = currentPage;
                }

                setHasMore(newData.length === ITEMS_PER_PAGE);
            }
        } catch (err) {
            console.error("Pagination Error:", err);
            setError(err.message || 'Failed to fetch data');
        } finally {
            setLoading(false);
        }
    }, [endpoint, JSON.stringify(queryParams)]);

    const reset = useCallback(() => {
        setData([]);
        pageRef.current = 1;
        setHasMore(true);
        loadMore(true);
    }, [loadMore]);

    useEffect(() => {
        if (endpoint && !endpoint.startsWith('artifacts')) {
            loadMore(true);
        }
    }, [endpoint, JSON.stringify(queryParams)]);

    return { data, loading, hasMore, error, loadMore, reset };
};
