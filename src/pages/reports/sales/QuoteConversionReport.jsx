import React from 'react';
import GenericReport from '../GenericReport';

const QuoteConversionReport = () => (
    <GenericReport
        title="Quote Conversion Funnel"
        icon="arrows-rotate"
        endpoint="/reports/sales/conversion-funnel"
        filters={[
            { key: 'from',        label: 'From',        type: 'date' },
            { key: 'to',          label: 'To',          type: 'date' },
            { key: 'salesperson', label: 'Salesperson', type: 'select', optionsFromColumn: 'salesperson' }
        ]}
    />
);

export default QuoteConversionReport;
