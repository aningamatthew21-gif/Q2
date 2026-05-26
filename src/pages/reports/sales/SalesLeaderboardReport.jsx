import React from 'react';
import GenericReport from '../GenericReport';

const SalesLeaderboardReport = () => (
    <GenericReport
        title="Sales Leaderboard"
        icon="trophy"
        endpoint="/reports/sales/leaderboard"
        filters={[
            { key: 'period', label: 'Period', type: 'select', options: [
                { value: 'ytd', label: 'YTD' },
                { value: 'qtd', label: 'QTD' },
                { value: 'mtd', label: 'MTD' }
            ], defaultValue: 'ytd' }
        ]}
    />
);

export default SalesLeaderboardReport;
