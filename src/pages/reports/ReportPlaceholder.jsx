import React, { useEffect, useState } from 'react';
import api from '../../api';
import ReportPage from './ReportPage';

/**
 * ReportPlaceholder — used by every Module 5 report page until the
 * real implementation lands in its phase.
 *
 * Hits the report's backend endpoint (which currently returns an empty
 * envelope) and renders an empty state via the standard ReportPage
 * chrome. Lets every link from ReportsHub "work" in Phase 5.0 — user
 * can navigate around the full menu before any report is built out.
 *
 *   <ReportPlaceholder
 *     title="AR Aging"
 *     endpoint="/reports/finance/ar-aging"
 *     icon="file-invoice-dollar"
 *   />
 */
const ReportPlaceholder = ({ title, endpoint, icon, subtitle = 'Coming soon — placeholder' }) => {
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        api.get(endpoint)
            .then(res => {
                if (cancelled) return;
                if (!res?.success) setError(res?.error || 'Unknown error');
            })
            .catch(err => {
                if (cancelled) return;
                setError(err?.response?.data?.error || err?.message || 'Failed to load');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [endpoint]);

    return (
        <ReportPage
            title={title}
            subtitle={subtitle}
            icon={icon}
            loading={loading}
            error={error}
            empty
            emptyHint="This report is scheduled for a later build phase. The backend endpoint responds 200 with a placeholder so we can verify the route + permissions are wired."
        />
    );
};

export default ReportPlaceholder;
