import React from 'react';
import GenericReport from '../GenericReport';

const TopCustomersReport = () => (
    <GenericReport
        title="Top Customers"
        icon="user-group"
        endpoint="/reports/sales/top-customers"
        filters={[
            { key: 'year', label: 'Year', type: 'number', defaultValue: String(new Date().getFullYear()) },
            { key: 'topN', label: 'Show top N (max 100)', type: 'number', defaultValue: '30' }
        ]}
        chartTypes={{ 0: 'horizontal-bar' }}
    />
);

export default TopCustomersReport;
