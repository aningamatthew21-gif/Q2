import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  ClipboardList, Inbox, Send, Truck, PenLine, AlertTriangle,
  CheckCircle, Package, UserCheck, ExternalLink
} from 'lucide-react';
import {
  Breadcrumb, PageTitle, Card, MetricTile, StatusBadge, EmptyState, Button
} from '../components/v2';
import { staggerContainer, listContainer, listRow } from '../components/v2/motion';
import { useRealtimePRs }     from '../hooks/useRealtimePRs';
import { useRealtimeVendors } from '../hooks/useRealtimeVendors';
import { useRealtimeRFQs }    from '../hooks/useRealtimeRFQs';

/**
 * ProcurementDashboard — Fluent 2 redesign.
 *
 * Hooks, data, and navigation handlers are unchanged from v1. JSX
 * rewritten to use v2 primitives end-to-end:
 *   - Stat row → MetricTile (clickable; drills into the filtered PR/RFQ
 *     list for that segment)
 *   - "Awaiting your approval" inbox → Card + DataTable-style rows with
 *     StatusBadge + a primary "Review" action per row
 *   - Action tiles → interactive Card with Lucide icons in tinted square
 *   - Recent requisitions → Card + table styled like v2 DataTable rows
 */
const ProcurementDashboard = ({ navigateTo, userEmail }) => {
  const username                  = userEmail ? userEmail.split('@')[0] : 'User';
  const { data: prs, loading }    = useRealtimePRs();
  const { data: vendors }         = useRealtimeVendors();
  const { data: rfqs }            = useRealtimeRFQs();

  const stats = useMemo(() => {
    const open       = prs.filter(p => p.status === 'OPEN').length;
    const inRfq      = prs.filter(p => p.status === 'IN_RFQ').length;
    const awarded    = prs.filter(p => p.status === 'AWARDED').length;
    const fulfilled  = prs.filter(p => p.status === 'FULFILLED').length;
    const urgent     = prs.filter(p => p.priority === 'urgent' && p.status !== 'CANCELLED' && p.status !== 'FULFILLED').length;
    const activeVendors   = vendors.filter(v => v.status === 'active').length;
    const pendingApproval = rfqs.filter(r => r.status === 'PENDING_APPROVAL').length;
    return { open, inRfq, awarded, fulfilled, urgent, activeVendors, pendingApproval };
  }, [prs, vendors, rfqs]);

  const pendingApprovalRFQs = useMemo(
    () => rfqs.filter(r => r.status === 'PENDING_APPROVAL').slice(0, 5),
    [rfqs]
  );

  const recentPRs = useMemo(
    () => [...prs].filter(p => p.status === 'OPEN' || p.status === 'IN_RFQ').slice(0, 8),
    [prs]
  );

  const fmtMoney = (cur, n) =>
    `${cur || 'GHS'} ${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  return (
    <>
      <Breadcrumb items={['Workspace', 'Procurement', 'Dashboard']} />
      <PageTitle
        title="Procurement dashboard"
        subtitle={`Welcome back, ${username}`}
      />

      {/* KPI ROW — clickable */}
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="enter"
        className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-5"
      >
        <MetricTile
          label="Open requests"
          value={loading ? 0 : stats.open}
          format="number"
          trend="flat"
          onClick={() => navigateTo('purchaseRequisitions', { status: 'OPEN' })}
        />
        <MetricTile
          label="In RFQ"
          value={loading ? 0 : stats.inRfq}
          format="number"
          trend="flat"
          onClick={() => navigateTo('purchaseRequisitions', { status: 'IN_RFQ' })}
        />
        <MetricTile
          label="Pending my approval"
          value={stats.pendingApproval}
          format="number"
          trend={stats.pendingApproval > 0 ? 'up' : 'flat'}
          onClick={() => navigateTo('rfqList')}
        />
        <MetricTile
          label="Awarded"
          value={loading ? 0 : stats.awarded}
          format="number"
          onClick={() => navigateTo('purchaseRequisitions', { status: 'AWARDED' })}
        />
        <MetricTile
          label="Fulfilled"
          value={loading ? 0 : stats.fulfilled}
          format="number"
          onClick={() => navigateTo('purchaseRequisitions', { status: 'FULFILLED' })}
        />
        <MetricTile
          label="Urgent"
          value={loading ? 0 : stats.urgent}
          format="number"
          trend={stats.urgent > 0 ? 'down' : 'flat'}
          onClick={() => navigateTo('purchaseRequisitions')}
        />
        <MetricTile
          label="Active vendors"
          value={stats.activeVendors}
          format="number"
          onClick={() => navigateTo('vendors')}
        />
      </motion.div>

      {/* AWAITING APPROVAL — actionable inbox */}
      {pendingApprovalRFQs.length > 0 && (
        <Card className="mb-5">
          <div className="px-5 py-3 border-b border-n-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-warn text-white grid place-items-center text-[12px] font-bold">
                {stats.pendingApproval}
              </span>
              <div>
                <div className="text-[13px] font-semibold text-n-800">RFQs awaiting your approval</div>
                <div className="text-xs text-n-500 mt-0.5">Procurement-head sign-off needed before cost pushback</div>
              </div>
            </div>
            <Button
              variant="default"
              iconRight={<ExternalLink />}
              onClick={() => navigateTo('rfqList')}
            >View all</Button>
          </div>
          <motion.div variants={listContainer} initial="initial" animate="enter">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-n-50 border-b border-n-200">
                  <th className="px-4 py-2 text-left font-semibold uppercase tracking-wider text-[11px] text-n-600">RFQ</th>
                  <th className="px-4 py-2 text-left font-semibold uppercase tracking-wider text-[11px] text-n-600">Title</th>
                  <th className="px-4 py-2 text-left font-semibold uppercase tracking-wider text-[11px] text-n-600">Vendor</th>
                  <th className="px-4 py-2 text-right font-semibold uppercase tracking-wider text-[11px] text-n-600">Amount</th>
                  <th className="px-4 py-2 text-left font-semibold uppercase tracking-wider text-[11px] text-n-600">Created</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {pendingApprovalRFQs.map(rfq => (
                  <motion.tr
                    key={rfq.id}
                    variants={listRow}
                    className="border-b border-n-100 hover:bg-n-50 transition-colors cursor-pointer"
                    onClick={() => navigateTo('rfqDetail', rfq.id)}
                  >
                    <td className="px-4 py-2 font-mono-num text-[12.5px]">{rfq.rfqNumber}</td>
                    <td className="px-4 py-2 truncate max-w-[260px]">{rfq.title || '—'}</td>
                    <td className="px-4 py-2 text-n-600">{rfq.awardedVendorName || rfq.recommendedVendorName || '—'}</td>
                    <td className="px-4 py-2 text-right font-mono-num text-[12.5px] text-n-800 font-semibold">
                      {fmtMoney(rfq.currency, rfq.totalAwardAmount)}
                    </td>
                    <td className="px-4 py-2 text-xs text-n-500">
                      {rfq.createdAt ? new Date(rfq.createdAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" variant="primary">Review</Button>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        </Card>
      )}

      {/* QUICK ACTIONS */}
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="enter"
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-5"
      >
        <ActionTile icon={<ClipboardList />} label="All requests"     hint="Browse requisitions" onClick={() => navigateTo('purchaseRequisitions')} />
        <ActionTile icon={<Inbox />}         label="Open inbox"       hint={`${stats.open} need sourcing`} onClick={() => navigateTo('purchaseRequisitions', { status: 'OPEN' })} />
        <ActionTile icon={<Truck />}         label="Vendor directory" hint="Manage suppliers" onClick={() => navigateTo('vendors')} />
        <ActionTile icon={<Send />}          label="RFQs"             hint="Send & track" onClick={() => navigateTo('rfqList')} />
        <ActionTile icon={<PenLine />}       label="My signatures"    hint="Approval signatures" onClick={() => navigateTo('mySignatures')} />
      </motion.div>

      {/* RECENT REQUISITIONS */}
      <Card className="mb-2">
        <div className="px-5 py-3 border-b border-n-200 flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold text-n-800">Active requisitions</div>
            <div className="text-xs text-n-500 mt-0.5">Most recent open / in-RFQ items</div>
          </div>
          <Button variant="subtle" iconRight={<ExternalLink />} onClick={() => navigateTo('purchaseRequisitions')}>View all</Button>
        </div>
        {loading ? (
          <div className="p-8 text-center">
            <div className="inline-block w-8 h-8 rounded-full border-2 border-n-100 border-t-accent animate-spin" />
          </div>
        ) : recentPRs.length === 0 ? (
          <EmptyState
            dense
            icon={<Inbox className="w-6 h-6" />}
            title="No active requisitions"
            body="New requests will appear here in real time."
          />
        ) : (
          <motion.div variants={listContainer} initial="initial" animate="enter">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-n-50 border-b border-n-200">
                  <th className="px-4 py-2 text-left font-semibold uppercase tracking-wider text-[11px] text-n-600 w-32">PR</th>
                  <th className="px-4 py-2 text-left font-semibold uppercase tracking-wider text-[11px] text-n-600">Item</th>
                  <th className="px-4 py-2 text-left font-semibold uppercase tracking-wider text-[11px] text-n-600">Customer</th>
                  <th className="px-4 py-2 text-right font-semibold uppercase tracking-wider text-[11px] text-n-600 w-20">Qty</th>
                  <th className="px-4 py-2 text-left font-semibold uppercase tracking-wider text-[11px] text-n-600">Reason</th>
                  <th className="px-4 py-2 text-left font-semibold uppercase tracking-wider text-[11px] text-n-600 w-32">Status</th>
                  <th className="px-4 py-2 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {recentPRs.map(pr => (
                  <motion.tr
                    key={pr.id}
                    variants={listRow}
                    className="border-b border-n-100 hover:bg-n-50 cursor-pointer transition-colors"
                    onClick={() => navigateTo('purchaseRequisitionDetail', pr.id)}
                  >
                    <td className="px-4 py-2 font-mono-num text-[12.5px]">{pr.prNumber || pr.id.slice(0, 8)}</td>
                    <td className="px-4 py-2 font-medium text-n-800">{pr.itemName}</td>
                    <td className="px-4 py-2 text-n-600">{pr.customerName || '—'}</td>
                    <td className="px-4 py-2 text-right font-mono-num">{pr.quantity}</td>
                    <td className="px-4 py-2 text-xs text-n-600">{pr.reason}</td>
                    <td className="px-4 py-2"><StatusBadge value={pr.status} /></td>
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" variant="subtle">Open</Button>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        )}
      </Card>
    </>
  );
};

function ActionTile({ icon, label, hint, onClick }) {
  return (
    <Card interactive onClick={onClick} className="p-3 hover:border-accent">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-md bg-accent-soft text-accent grid place-items-center flex-shrink-0">
          {React.cloneElement(icon, { className: 'w-4 h-4' })}
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-n-800 truncate">{label}</div>
          <div className="text-xs text-n-500 truncate">{hint}</div>
        </div>
      </div>
    </Card>
  );
}

export default ProcurementDashboard;
