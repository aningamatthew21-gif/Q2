import React from 'react';
import GenericReport from '../GenericReport';

const RevenueVsTargetReport = () => (
    <GenericReport
        title="Revenue vs Target"
        icon="chart-column"
        endpoint="/reports/sales/revenue-vs-target"
        filters={[
            { key: 'year',        label: 'Year',        type: 'number', defaultValue: String(new Date().getFullYear()) },
            { key: 'salesperson', label: 'Salesperson', type: 'select', optionsFromColumn: 'salesperson' }
        ]}
    />
);

export default RevenueVsTargetReport;
