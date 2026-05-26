import React from 'react';
import GenericReport from '../GenericReport';

const RfqCycleTimeReport = () => (
    <GenericReport
        title="RFQ Cycle Time"
        icon="stopwatch"
        endpoint="/reports/procurement/rfq-cycle-time"
        filters={[
            { key: 'from',  label: 'From', type: 'date' },
            { key: 'to',    label: 'To',   type: 'date' },
            { key: 'owner', label: 'Owner', type: 'select', optionsFromColumn: 'owner' }
        ]}
        chartTypes={{ 0: 'horizontal-bar' }}
    />
);

export default RfqCycleTimeReport;
