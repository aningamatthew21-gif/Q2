import React from 'react';
import GenericReport from '../GenericReport';

const LeadTimeAccuracyReport = () => (
    <GenericReport
        title="Lead-Time Accuracy"
        icon="clock"
        endpoint="/reports/procurement/lead-time-accuracy"
        filters={[
            { key: 'from',     label: 'From',   type: 'date' },
            { key: 'to',       label: 'To',     type: 'date' },
            { key: 'vendorId', label: 'Vendor', type: 'select', optionsFromColumn: 'vendorId' }
        ]}
    />
);

export default LeadTimeAccuracyReport;
