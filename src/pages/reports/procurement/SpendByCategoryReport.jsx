import React from 'react';
import GenericReport from '../GenericReport';

const SpendByCategoryReport = () => (
    <GenericReport
        title="Spend by Category (ABC)"
        icon="tag"
        endpoint="/reports/procurement/spend-by-category"
        filters={[
            { key: 'from', label: 'From', type: 'date' },
            { key: 'to',   label: 'To',   type: 'date' }
        ]}
        chartTypes={{ 0: 'horizontal-bar' }}
    />
);

export default SpendByCategoryReport;
