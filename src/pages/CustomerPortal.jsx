import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Search, FileText, Eye, Mail, Phone, MapPin, User,
  TrendingUp, FileQuestion, Pencil, ExternalLink, Calendar, AlertCircle,
  Wallet
} from 'lucide-react';
import api from '../api';
import { formatCurrency } from '../utils/formatting';
import PreviewModal from '../components/PreviewModal';
import CustomerModal from '../components/modals/CustomerModal';
import LogPaymentModal from '../components/modals/LogPaymentModal';
import { useRealtimeInvoices } from '../hooks/useRealtimeInvoices';
import { useApp } from '../context/AppContext';
import { can } from '../utils/permissions';

// Mirrors backend PAYMENT_ELIGIBLE_STATUSES — used to gate the per-row
// Log Payment button so users can't even try on an invoice the server
// would reject.
const PAYMENT_ELIGIBLE_STATUSES = new Set([
  'Awaiting Acceptance', 'Customer Accepted', 'Partially Paid', 'Paid'
]);
import {
  Breadcrumb, PageTitle, Card, Button, MetricTile,
  StatusBadge, Tabs, FilterChips, EmptyState, SortableHeader, useSortable
} from '../components/v2';
import { staggerContainer, listContainer, listRow } from '../components/v2/motion';

/**
 * CustomerPortal — Fluent 2 redesign.
 *
 * Used both as a controller drilling into a customer record AND as a
 * pre-auth public view (rendered chromeless via AppContext.isChromeless).
 * Hooks, data flow, and PreviewModal wiring stay identical to v1; only
 * the visual layer flips to the v2 design system.
 *
 * Layout:
 *   - Sticky header card (customer name, contact chips, Edit button)
 *   - 4 metric tiles: total invoices, total value, open, pending
 *   - Tab strip + search + filter chips
 *   - Sortable invoice table with row-click → PdfViewer preview
 *   - Empty state + loading skeleton
 *
 * Note: kept on its own min-h-screen wrapper because it's used outside the
 * AppShell (chromeless). Background uses tokens so dark mode flips cleanly.
 */

const CustomerPortal = ({ navigateTo, customerId }) => {
  const [customer, setCustomer] = useState(null);
  const [activeTab, setActiveTab] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [previewPayload, setPreviewPayload] = useState(null);
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [logPaymentInvoice, setLogPaymentInvoice] = useState(null);
  const [loadError, setLoadError] = useState(null);  // EH: surface portal fetch failures to the user
  const { data: invoices, loading: invoicesLoading } = useRealtimeInvoices(null, customerId);
  const { appUser } = useApp();
  const canLogPayment = can(appUser, 'payment.log');

  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await api.get(`/customers/${customerId}`);
        if (!cancelled && response.success) {
          setCustomer(response.data);
          setLoadError(null);
        }
      } catch (error) {
        // EH (ISO 25010 User Error Protection): the portal is the
        // customer's primary touchpoint — silent failure here means a
        // blank page with no recourse. Surface the specific reason so
        // the customer can act (refresh, contact support with the
        // requestId, etc.).
        if (cancelled) return;
        console.error('Error fetching customer:', error);
        const env = error?.response?.data?.error;
        setLoadError({
          message:   env?.message || error?.message || 'We couldn\'t load your account details.',
          requestId: env?.requestId || null,
          status:    error?.response?.status || 0
        });
      }
    })();
    return () => { cancelled = true; };
  }, [customerId]);

  const stats = useMemo(() => {
    const total = invoices.length;
    const totalValue = invoices.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0);
    const approvedCount = invoices.filter(inv =>
      inv.status === 'Awaiting Acceptance' || inv.status === 'Customer Accepted' || inv.status === 'Paid'
    ).length;
    const pendingCount = invoices.filter(inv => inv.status === 'Pending Approval').length;
    return { total, totalValue, approvedCount, pendingCount };
  }, [invoices]);

  const tabs = useMemo(() => [
    { id: 'All',      label: 'All',      count: invoices.length },
    { id: 'Approved', label: 'Approved', count: invoices.filter(inv => inv.status === 'Awaiting Acceptance' || inv.status === 'Customer Accepted' || inv.status === 'Paid').length },
    { id: 'Pending',  label: 'Pending',  count: invoices.filter(inv => inv.status === 'Pending Approval').length },
    { id: 'Rejected', label: 'Rejected', count: invoices.filter(inv => inv.status === 'Rejected' || inv.status === 'Customer Rejected').length }
  ], [invoices]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      const matchesTab = activeTab === 'All' ||
        (activeTab === 'Approved' && (inv.status === 'Awaiting Acceptance' || inv.status === 'Customer Accepted' || inv.status === 'Paid')) ||
        (activeTab === 'Pending'  && inv.status === 'Pending Approval') ||
        (activeTab === 'Rejected' && (inv.status === 'Rejected' || inv.status === 'Customer Rejected'));
      const matchesSearch = !searchTerm ||
        inv.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (inv.date && inv.date.includes(searchTerm));
      return matchesTab && matchesSearch;
    });
  }, [invoices, activeTab, searchTerm]);

  const sortableRows = useMemo(() => filteredInvoices.map(inv => ({
    ...inv,
    _amount: Number(inv.total) || 0,
    _date:   Date.parse(inv.date) || 0
  })), [filteredInvoices]);
  const { sortKey, sortDir, toggle: toggleSort, sortedRows } = useSortable(sortableRows, '_date', 'desc');

  const handleSaveCustomer = async (updatedData) => {
    try {
      await api.put(`/customers/${customerId}`, updatedData);
      setCustomer({ ...customer, ...updatedData });
      setIsEditingCustomer(false);
    } catch (error) {
      console.error('Error updating customer:', error);
    }
  };

  const handleViewInvoice = (inv) => {
    setPreviewPayload({
      ...inv,
      invoiceId: inv.id,
      customer:  customer,
      items:     inv.items || inv.lineItems || [],
      subtotal:  inv.total,
      taxes:     inv.taxBreakdown || inv.taxes || inv.taxConfiguration || [],
      totals:    inv.totals || { grandTotal: inv.total }
    });
  };

  if (!customer) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-n-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-n-200 border-t-accent animate-spin" />
          <div className="text-[13px] text-n-500">Loading customer…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-n-50 text-n-700 font-sans">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">

        {/* EH: portal-fetch failure banner (WCAG role=alert, dismissible). */}
        {loadError && (
          <div
            role="alert"
            className="mb-4 p-3 rounded border border-red-200 bg-red-50 text-sm text-red-800 flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-medium">We couldn't load your account details.</div>
              <div className="text-xs mt-0.5 text-red-700">{loadError.message}</div>
              {loadError.requestId && (
                <div className="text-[11px] mt-1 font-mono text-red-600 opacity-75">
                  Reference: <span className="select-all">{loadError.requestId}</span>
                </div>
              )}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="text-xs underline text-red-700 hover:text-red-900 flex-shrink-0"
            >
              Reload
            </button>
          </div>
        )}

        {/* BACK link (only when used inside the app) */}
        {navigateTo && (
          <Breadcrumb
            items={[
              { label: 'Workspace',  onClick: () => navigateTo('controllerDashboard') },
              { label: 'Customers',  onClick: () => navigateTo('customers') },
              customer.name
            ]}
          />
        )}

        {/* CUSTOMER HEADER CARD */}
        <Card className="mb-5">
          <div className="px-5 py-4 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-semibold text-n-800 leading-tight tracking-tight">
                {customer.name}
              </h1>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-n-500">
                <ContactChip icon={<User />}    text={customer.contactPerson || 'No contact person'} />
                <ContactChip icon={<Mail />}    text={customer.contactEmail   || customer.email || 'No email'} />
                <ContactChip icon={<Phone />}   text={customer.phone || customer.contactPhone || 'No phone'} />
                <ContactChip icon={<MapPin />}  text={customer.location || customer.address || 'No location'} />
              </div>
            </div>
            <div className="flex-shrink-0 flex gap-2">
              {/* Module 2 — quick jump to the per-customer statement page.
                  Gated by VALID_PAGES — anyone without customer.statement.read
                  will get the Forbidden screen on navigation, but the button
                  is harmless to show universally (cheap UX win for finance). */}
              <Button
                variant="ghost"
                iconLeft={<FileText />}
                onClick={() => navigateTo('customerStatement', { customerId })}
              >
                View Statement
              </Button>
              <Button variant="primary" iconLeft={<Pencil />} onClick={() => setIsEditingCustomer(true)}>
                Edit customer
              </Button>
            </div>
          </div>
        </Card>

        {/* METRIC ROW */}
        <motion.div
          variants={staggerContainer}
          initial="initial"
          animate="enter"
          className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5"
        >
          <MetricTile label="Total invoices"  value={stats.total}        format="number" />
          <MetricTile label="Total value"     value={stats.totalValue}   prefix="GHS " format="compact" trend="up" delta={null} />
          <MetricTile label="Open invoices"   value={stats.approvedCount} format="number" trend="flat" />
          <MetricTile label="Pending approval"value={stats.pendingCount} format="number" trend={stats.pendingCount > 0 ? 'up' : 'flat'} />
        </motion.div>

        {/* INVOICES SECTION */}
        <Card className="mb-5 overflow-hidden">
          <div className="px-5 py-3 border-b border-n-200 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <Tabs tabs={tabs} value={activeTab} onChange={setActiveTab} className="-mx-5 px-5" />
            <div className="relative w-full md:w-72">
              <Search className="w-3.5 h-3.5 text-n-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search invoice id or date…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full h-8 pl-8 pr-3 text-[13px] bg-n-50 border border-n-200 rounded-md text-n-700 placeholder:text-n-400 focus:outline-none focus:bg-white focus:border-accent focus:shadow-focus transition-colors"
              />
            </div>
          </div>

          {searchTerm && (
            <div className="px-5 pt-3">
              <FilterChips
                chips={[{ id: 'search', label: `Search: "${searchTerm}"`, onRemove: () => setSearchTerm('') }]}
              />
            </div>
          )}

          {invoicesLoading ? (
            <div className="p-12 text-center">
              <div className="inline-block w-8 h-8 rounded-full border-2 border-n-100 border-t-accent animate-spin" />
              <div className="text-[13px] text-n-500 mt-2">Loading invoices…</div>
            </div>
          ) : sortedRows.length === 0 ? (
            <EmptyState
              icon={<FileQuestion className="w-6 h-6" />}
              title="No invoices match these filters"
              body={searchTerm ? 'Try clearing the search or switching tabs.' : 'No invoices for this customer yet.'}
            />
          ) : (
            <motion.div variants={listContainer} initial="initial" animate="enter">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-n-50 border-b border-n-200">
                    <th className="px-4 py-2 text-left  w-[200px]"><SortableHeader label="Invoice"  sortKey="id"           current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                    <th className="px-4 py-2 text-left  w-[140px]"><SortableHeader label="Date"     sortKey="_date"        current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                    <th className="px-4 py-2 text-right w-[160px]"><SortableHeader label="Amount"   sortKey="_amount"      current={sortKey} dir={sortDir} onToggle={toggleSort} align="right" /></th>
                    <th className="px-4 py-2 text-left  w-[180px]"><SortableHeader label="Status"   sortKey="status"       current={sortKey} dir={sortDir} onToggle={toggleSort} /></th>
                    <th className="px-4 py-2 text-right w-[110px]"><span className="text-[11px] font-semibold uppercase tracking-wider text-n-600">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map(inv => (
                    <motion.tr
                      key={inv.id}
                      variants={listRow}
                      onClick={() => handleViewInvoice(inv)}
                      className="border-b border-n-100 hover:bg-n-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-2 font-mono-num text-[12.5px] text-n-800">{inv.approvedInvoiceId || inv.id}</td>
                      <td className="px-4 py-2 text-n-600">
                        <span className="inline-flex items-center gap-1.5">
                          <Calendar className="w-3 h-3 text-n-400" />
                          {inv.date}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono-num text-[12.5px] font-semibold text-n-800">{formatCurrency(inv.currency || 'GHS', inv.total)}</td>
                      <td className="px-4 py-2"><StatusBadge value={inv.status} /></td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex gap-1 justify-end">
                          {/* Module 2 — per-row Log Payment. Gated by both
                              permission AND eligible invoice status. The
                              ledger and Reverse action live inside the
                              InvoiceEditor (reached via the View button),
                              keeping the row toolbar from getting noisy. */}
                          {canLogPayment && PAYMENT_ELIGIBLE_STATUSES.has(inv.status) && Number(inv.balanceDue ?? (inv.total - (inv.amountPaid || 0))) > 0.01 && (
                            <Button
                              size="sm"
                              variant="primary"
                              iconLeft={<Wallet />}
                              onClick={(e) => {
                                e.stopPropagation();
                                setLogPaymentInvoice({
                                  id: inv.id,
                                  invoiceNumber: inv.approvedInvoiceId || inv.id,
                                  total: inv.total,
                                  amountPaid: inv.amountPaid,
                                  balanceDue: inv.balanceDue ?? (inv.total - (inv.amountPaid || 0)),
                                  currency: inv.currency || 'GHS',
                                  subtotal: inv.subtotal,
                                  customerId: inv.customerId || customerId,
                                  customerName: inv.customerName || customer?.name
                                });
                              }}
                            >
                              Log Payment
                            </Button>
                          )}
                          <Button size="sm" variant="subtle" iconLeft={<Eye />} onClick={(e) => { e.stopPropagation(); handleViewInvoice(inv); }}>
                            View
                          </Button>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </motion.div>
          )}
        </Card>

        {/* Footer hint */}
        <div className="text-[12px] text-n-500 text-center pb-2">
          Showing {sortedRows.length} of {invoices.length} invoices for {customer.name}
        </div>
      </div>

      {/* MODALS */}
      {previewPayload && (
        <PreviewModal
          open={!!previewPayload}
          onClose={() => setPreviewPayload(null)}
          payload={previewPayload}
          mode="invoice"
          isDistribution={true}
        />
      )}

      {isEditingCustomer && (
        <CustomerModal
          customer={customer}
          onSave={handleSaveCustomer}
          onClose={() => setIsEditingCustomer(false)}
        />
      )}

      {/* Module 2 — payment-logging modal triggered per-row */}
      <LogPaymentModal
        open={!!logPaymentInvoice}
        onClose={() => setLogPaymentInvoice(null)}
        invoice={logPaymentInvoice}
        onLogged={() => setLogPaymentInvoice(null)}
      />
    </div>
  );
};

function ContactChip({ icon, text }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-n-500">
      {React.cloneElement(icon, { className: 'w-3.5 h-3.5 text-n-400' })}
      <span className="text-n-700">{text}</span>
    </span>
  );
}

export default CustomerPortal;
