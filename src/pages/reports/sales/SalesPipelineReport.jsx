import React from 'react';
import GenericReport from '../GenericReport';

const SalesPipelineReport = () => (
    <GenericReport
        title="Sales Pipeline"
        icon="bullseye"
        endpoint="/reports/sales/pipeline"
        filters={[
            { key: 'salesperson', label: 'Salesperson', type: 'select', optionsFromColumn: 'owner' }
        ]}
    />
);

export default SalesPipelineReport;
