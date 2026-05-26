import React from 'react';
import GenericReport from '../GenericReport';

const PrCancellationReport = () => (
    <GenericReport
        title="PR Cancellation Analysis"
        icon="ban"
        endpoint="/reports/procurement/pr-cancellations"
        filters={[
            { key: 'from',  label: 'From',  type: 'date' },
            { key: 'to',    label: 'To',    type: 'date' },
            { key: 'owner', label: 'Owner', type: 'select', optionsFromColumn: 'cancelledBy' }
        ]}
    />
);

export default PrCancellationReport;
