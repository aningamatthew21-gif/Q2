import React from 'react';
import GenericReport from '../GenericReport';

const OverrideAuditReport = () => (
    <GenericReport
        title="Best-Price Override Audit"
        icon="magnifying-glass"
        endpoint="/reports/procurement/override-audit"
        filters={[
            { key: 'from', label: 'From', type: 'date' },
            { key: 'to',   label: 'To',   type: 'date' },
            { key: 'head', label: 'Approver', type: 'select', optionsFromColumn: 'head' }
        ]}
    />
);

export default OverrideAuditReport;
