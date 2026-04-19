import { useState, useEffect } from 'react';
import api from '../api';

/**
 * Optimized data fetching hook using the Oracle REST API.
 * Replaces the old Firebase Firestore-based hook.
 * 
 * @param {string} endpoint - The API endpoint path (e.g. '/inventory', '/customers')
 * @param {Object} params - Optional query params to send with the GET request
 * @param {any[]} deps - Additional dependency array items to trigger re-fetch
 */
export const useOptimizedData = (endpoint, params = {}, deps = []) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!endpoint) return;

        const fetchData = async () => {
            try {
                setLoading(true);
                setError(null);

                const response = await api.get(endpoint, { params });

                if (response.success) {
                    // Handle both array and object responses
                    const result = response.data;
                    setData(Array.isArray(result) ? result : [result]);
                } else {
                    setError(response.error || 'Failed to fetch data');
                }
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [endpoint, ...deps]);

    return { data, loading, error };
};
