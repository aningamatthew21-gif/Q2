import React from 'react';
import GenericReport from '../GenericReport';

/**
 * P1 · PR Backlog Aging — open requisitions by age + owner.
 * Procurement Head's daily action list.
 */
const PrBacklogAgingReport = () => (
    <GenericReport
        title="PR Backlog Aging"
        icon="box-archive"
        endpoint="/reports/procurement/pr-backlog"
        filters={[
            { key: 'asOfDate', label: 'As of date', type: 'date' },
            { key: 'owner',    label: 'Owner',     type: 'select', optionsFromColumn: 'owner' },
            { key: 'priority', label: 'Priority',  type: 'select', options: ['low', 'normal', 'high', 'urgent'] },
            { key: 'status',   label: 'Status',    type: 'select', options: ['OPEN', 'IN_RFQ', 'AWARDED'] }
        ]}
    />
);

export default PrBacklogAgingReport;
