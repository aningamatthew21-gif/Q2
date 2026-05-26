import React from 'react';
import GenericReport from '../GenericReport';

const SpendByVendorReport = () => (
    <GenericReport
        title="Spend by Vendor (Pareto)"
        icon="sack-dollar"
        endpoint="/reports/procurement/spend-by-vendor"
        filters={[
            { key: 'from',  label: 'From', type: 'date' },
            { key: 'to',    label: 'To',   type: 'date' },
            { key: 'topN',  label: 'Show top N (max 100)', type: 'number', defaultValue: '30' }
        ]}
        chartTypes={{ 0: 'line' }}
    />
);

export default SpendByVendorReport;
