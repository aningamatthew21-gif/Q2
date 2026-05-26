import React from 'react';
import GenericReport from '../GenericReport';

const QuoteAgingReport = () => (
    <GenericReport
        title="Quote Aging"
        icon="hourglass-half"
        endpoint="/reports/sales/quote-aging"
        filters={[
            { key: 'asOfDate',    label: 'As of date',  type: 'date' },
            { key: 'salesperson', label: 'Salesperson', type: 'select', optionsFromColumn: 'owner' },
            { key: 'minDays',     label: 'Min age (d)', type: 'number', placeholder: '0' }
        ]}
    />
);

export default QuoteAgingReport;
