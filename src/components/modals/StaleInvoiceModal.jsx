import React from 'react';
import Icon from '../common/Icon';
import GlassModal from '../common/GlassModal';
import Button from '../common/Button';

const StaleInvoiceModal = ({ invoices, onClose, onAction }) => {
    if (!invoices || invoices.length === 0) return null;

    const footer = (
        <Button variant="secondary" onClick={onClose}>Remind Me Later</Button>
    );

    return (
        <GlassModal
            open
            onClose={onClose}
            title="Action Required: Pending Invoices"
            description="The following invoices have been with the customer for over 7 days. Please update their status."
            size="lg"
            footer={footer}
        >
            <div className="flex items-start gap-4">
                <div className="flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-pill bg-warning-soft">
                    <Icon id="exclamation-triangle" className="h-5 w-5 text-warning" />
                </div>
                <div className="flex-1 overflow-x-auto">
                    <table className="min-w-full divide-y divide-line">
                        <thead className="bg-surface-sunken">
                            <tr>
                                <th scope="col" className="py-3 pl-4 pr-3 text-left text-sm font-semibold text-ink">Invoice</th>
                                <th scope="col" className="px-3 py-3 text-left text-sm font-semibold text-ink">Customer</th>
                                <th scope="col" className="px-3 py-3 text-left text-sm font-semibold text-ink">Sent Date</th>
                                <th scope="col" className="relative py-3 pl-3 pr-4">
                                    <span className="sr-only">Actions</span>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line bg-surface">
                            {invoices.map((invoice) => (
                                <tr key={invoice.id}>
                                    <td className="whitespace-nowrap py-3 pl-4 pr-3 text-sm font-medium text-ink">
                                        {invoice.approvedInvoiceId || invoice.id}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-3 text-sm text-ink-muted">{invoice.customerName}</td>
                                    <td className="whitespace-nowrap px-3 py-3 text-sm text-ink-muted">
                                        {invoice.sentAt ? new Date(invoice.sentAt.toDate ? invoice.sentAt.toDate() : invoice.sentAt).toLocaleDateString() : 'Unknown'}
                                    </td>
                                    <td className="relative whitespace-nowrap py-3 pl-3 pr-4 text-right text-sm font-medium space-x-2">
                                        <button
                                            onClick={() => onAction(invoice, 'Customer Accepted')}
                                            className="text-success hover:underline"
                                        >
                                            Accepted
                                        </button>
                                        <button
                                            onClick={() => onAction(invoice, 'Customer Rejected')}
                                            className="text-danger hover:underline"
                                        >
                                            Rejected
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </GlassModal>
    );
};

export default StaleInvoiceModal;
