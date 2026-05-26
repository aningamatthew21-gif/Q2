import React from 'react';
import GenericReport from '../GenericReport';

const WinLossReport = () => (
    <GenericReport
        title="Win / Loss Analysis"
        icon="scale-balanced"
        endpoint="/reports/sales/win-loss"
        filters={[
            { key: 'from',        label: 'From',        type: 'date' },
            { key: 'to',          label: 'To',          type: 'date' },
            { key: 'industry',    label: 'Industry',    type: 'select', optionsFromColumn: 'industry' },
            { key: 'salesperson', label: 'Salesperson', type: 'select', optionsFromColumn: 'salesperson' }
        ]}
    />
);

export default WinLossReport;
