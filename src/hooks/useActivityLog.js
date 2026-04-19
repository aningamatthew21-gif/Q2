import { useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { logActivity } from '../utils/logger';

/**
 * Custom hook for simplified activity logging.
 * Automatically injects userId from the AppContext.
 * 
 * @returns {Object} Object containing the log function
 */
export const useActivityLog = () => {
    const { userId, userEmail } = useApp();

    const log = useCallback(async (action, details, additionalData = {}) => {
        // Use username (from email) as the primary User ID for display purposes
        // Fallback to userId (UID) if email is not available
        const username = userEmail ? userEmail.split('@')[0] : (userId || 'System');

        await logActivity(username, action, details, {
            ...additionalData,
            originalUserId: userId // Keep the original UID for technical reference
        });
    }, [userId, userEmail]);

    return { log };
};
