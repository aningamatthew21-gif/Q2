import React from 'react';
import GenericReport from '../GenericReport';

const TopProductsReport = () => (
    <GenericReport
        title="Top Products (ABC)"
        icon="box"
        endpoint="/reports/sales/top-products"
        filters={[
            { key: 'year',     label: 'Year',     type: 'number', defaultValue: String(new Date().getFullYear()) },
            { key: 'category', label: 'Category', type: 'select', optionsFromColumn: 'category' },
            { key: 'topN',     label: 'Show top N (max 200)', type: 'number', defaultValue: '50' }
        ]}
        chartTypes={{ 0: 'horizontal-bar' }}
    />
);

export default TopProductsReport;
