import React from 'react';
import GenericReport from '../GenericReport';

const OpenRfqsAttentionReport = () => (
    <GenericReport
        title="RFQs Needing Attention"
        icon="triangle-exclamation"
        endpoint="/reports/procurement/rfqs-attention"
        filters={[
            { key: 'asOfDate', label: 'As of date', type: 'date' }
        ]}
    />
);

export default OpenRfqsAttentionReport;
