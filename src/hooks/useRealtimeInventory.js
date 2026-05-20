import { useState, useEffect, useRef } from 'react';
import api from '../api';
import socket from '../socket';
import { setCachedData } from '../utils/cache';

// Real-time data fetching hooks for management components
export const useRealtimeInventory = (db, appId) => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const refetchTimer = useRef(null);

    useEffect(() => {
        let isMounted = true;

        // `initial` controls the loading flag. The very first load shows the
        // page spinner; realtime refetches must NOT flip `loading` back to
        // true — doing so blanked the whole table to a spinner every time a
        // socket event arrived. During a bulk import that happened hundreds
        // of times in a row, which is the "screen goes blank" report.
        const fetchData = async (initial = false) => {
            try {
                if (initial && isMounted) setLoading(true);
                const response = await api.get('/inventory');
                if (isMounted && response.success) {
                    const result = response.data;
                    setData(result);
                    setError(null);

                    // Update cache for other components.
                    // Previously we wrote three keys; a grep showed no
                    // consumer ever read them, so the duplicate writes
                    // were pure overhead. One canonical key is enough,
                    // and if a future component needs a different shape
                    // it can subscribe to this hook directly.
                    setCachedData('inventory', result);
                }
            } catch (err) {
                if (isMounted) {
                    console.error("Failed to load inventory:", err);
                    setError(err.message || 'Failed to load inventory');
                }
            } finally {
                if (initial && isMounted) setLoading(false);
            }
        };

        fetchData(true);

        if (!socket.connected) socket.connect();

        // Coalesce bursts of `inventory:updated` events. A bulk import (or a
        // run of quick edits) can fire many events back-to-back; without
        // debouncing, each one triggered a full SELECT * refetch + full
        // table re-render. We wait 400ms after the LAST event, then refetch
        // exactly once.
        const handleUpdate = () => {
            if (refetchTimer.current) clearTimeout(refetchTimer.current);
            refetchTimer.current = setTimeout(() => {
                console.log('🔄 [WS] Real-time inventory update — refetching (coalesced)');
                fetchData(false);
            }, 400);
        };

        socket.on('inventory:updated', handleUpdate);

        // M5 — catch up on missed events after reconnect
        const handleReconnect = () => {
            console.log('🔄 [WS] Socket reconnected — refetching inventory.');
            fetchData(false);
        };
        socket.io.on('reconnect', handleReconnect);

        return () => {
            isMounted = false;
            if (refetchTimer.current) clearTimeout(refetchTimer.current);
            socket.off('inventory:updated', handleUpdate);
            socket.io.off('reconnect', handleReconnect);
        };
    }, [db, appId]);

    return { data, loading, error };
};
