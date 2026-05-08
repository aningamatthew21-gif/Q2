import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  FileCheck, Boxes, Users, Truck, ClipboardList, Settings, Calculator,
  History, PenLine, BarChart3, AlertTriangle, ArrowUp, ArrowDown,
  ExternalLink, Clock, AlertCircle
} from 'lucide-react';
import {
  Breadcrumb, PageTitle, Card, Button, MetricTile, ChartCard, StatusBadge,
  EmptyState, CHART_COLORS
} from '../components/v2';
import { staggerContainer, listContainer, listRow } from '../components/v2/motion';
import ReportModal from '../components/ReportModal';
import { formatCurrency } from '../utils/formatting';
import { getInvoiceDate } from '../utils/helpers';
import { useRealtimeInvoices }  from '../hooks/useRealtimeInvoices';
import { useRealtimeInventory } from '../hooks/useRealtimeInventory';
import { useRealtimePRs }       from '../hooks/useRealtimePRs';
import { useRealtimeRFQs }      from '../hooks/useRealtimeRFQs';

/**
 * ControllerAnalyticsDashboard — Fluent 2 redesign.
 *
 * Hooks, data, and navigation handlers are unchanged from v1. JSX
 * rewritten to use v2 primitives end-to-end:
 *   - "Procurement Quick Stats" → row of clickable MetricTiles drilling
 *     into filtered PR / RFQ / Invoice lists
 *   - Action tile grid → interactive Cards with Lucide icons in tinted squares
 *   - Three actionable inbox cards (RFQ approvals, re-approvals, at-risk)
 *     → Card + StatusBadge tables with row-click navigation
 *   - Monthly invoice chart → ChartCard with Fluent palette
 *   - Inventory health / Recognized invoices → KPI cards with big numbers
 *
 * Rainbow "text-amber-600 / text-blue-600 / text-purple-500" palette is
 * collapsed to a single accent + neutrals + status badges per the
 * Fluent 2 direction.
 */
const ControllerAnalyticsDashboard = ({ navigateTo, userEmail, currentUser }) => {
  const [openReport, setOpenReport] = useState(false);
  const username = userEmail ? userEmail.split('@')[0] : 'User';

  const { data: invoices,  loading: invoicesLoading }  = useRealtimeInvoices();
  const { data: inventory, loading: inventoryLoading } = useRealtimeInventory();
  const { data: prs }  = useRealtimePRs();
  const { data: rfqs } = useRealtimeRFQs();

  const procStats = useMemo(() => ({
    openPRs:         prs.filter(p => p.status === 'OPEN').length,
    activeRFQs:      rfqs.filter(r => ['DRAFT','SENT','RECEIVING','COMPARING'].includes(r.status)).length,
    pendingApproval: rfqs.filter(r => r.status === 'PENDING_APPROVAL').length,
    awarded:         rfqs.filter(r => r.status === 'AWARDED').length,
    needsReapproval: invoices.filter(inv => inv.requiresReapproval).length,
    atRisk:          rfqs.filter(r => r.isPastDeadline && !r.isEscalated).length,
    escalated:       rfqs.filter(r => r.isEscalated).length
  }), [prs, rfqs, invoices]);

  const riskQueue       = useMemo(() => rfqs.filter(r => r.isEscalated || r.isPastDeadline), [rfqs]);
  const reapprovalQueue = useMemo(() => invoices.filter(inv => inv.requiresReapproval),       [invoices]);

  const { invoiceData, inventoryHealthData, recognised } = useMemo(() => {
    const monthlyData = {};
    invoices.filter(inv => inv.status === 'Customer Accepted' || inv.status === 'Paid').forEach(inv => {
      const date  = getInvoiceDate(inv);
      const key   = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyData[key]) monthlyData[key] = { name: key, count: 0, total: 0 };
      monthlyData[key].count += 1;
      monthlyData[key].total += inv.total || inv.totals?.grandTotal || inv.totals?.subtotal || 0;
    });
    const invoiceData = Object.values(monthlyData).sort((a, b) => a.name.localeCompare(b.name));
    const itemsBelowReorder = inventory.filter(item => item.stock <= item.restockLimit).length;
    const inventoryHealthData = inventory.length > 0
      ? Math.round(((inventory.length - itemsBelowReorder) / inventory.length) * 100)
      : 100;
    const recognised = invoices.filter(inv => inv.status === 'Customer Accepted' || inv.status === 'Paid').length;
    return { invoiceData, inventoryHealthData, recognised };
  }, [invoices, inventory]);

  const isAdminOrController = currentUser && (currentUser.role === 'controller' || currentUser.role === 'admin');
  const fmtMoney = (cur, n) =>
    `${cur || 'GHS'} ${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  return (
    <>
      <Breadcrumb items={['Workspace', 'Finance', 'Controller dashboard']} />
      <PageTitle
        title="Controller dashboard"
        subtitle={`Welcome back, ${username}`}
        actions={
          <>
            <Button iconLeft={<Settings />} onClick={() => navigateTo('taxSettings')}>System settings</Button>
            <Button variant="primary" iconLeft={<BarChart3 />} onClick={() => setOpenReport(true)}>Generate report</Button>
          </>
        }
      />

      {/* PROCUREMENT QUICK STATS — clickable */}
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="enter"
        className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5"
      >
        <MetricTile
          label="Open PRs"
          value={procStats.openPRs}
          format="number"
          onClick={() => navigateTo('purchaseRequisitions', { status: 'OPEN' })}
        />
        <MetricTile
          label="Active RFQs"
          value={procStats.activeRFQs}
          format="number"
          onClick={() => navigateTo('rfqList')}
        />
        <MetricTile
          label="Pending approval"
          value={procStats.pendingApproval}
          format="number"
          trend={procStats.pendingApproval > 0 ? 'up' : 'flat'}
          onClick={() => navigateTo('rfqList')}
        />
        <MetricTile
          label="Awarded RFQs"
          value={procStats.awarded}
          format="number"
          onClick={() => navigateTo('rfqList')}
        />
        <MetricTile
          label="Needs re-approval"
          value={procStats.needsReapproval}
          format="number"
          trend={procStats.needsReapproval > 0 ? 'down' : 'flat'}
          onClick={() => navigateTo('invoices', { filter: 'requiresReapproval' })}
        />
        <MetricTile
          label="RFQs at risk"
          value={procStats.escalated + procStats.atRisk}
          format="number"
          trend={procStats.escalated > 0 ? 'down' : 'flat'}
          onClick={() => navigateTo('rfqList', { filter: 'ESCALATED' })}
        />
      </motion.div>

      {/* ACTION TILE GRID */}
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="enter"
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-5"
      >
        {isAdminOrController && (
          <ActionTile icon={<FileCheck />} label="Approve invoices" hint="Pending sign-off" onClick={() => navigateTo('salesInvoiceApproval')} />
        )}
        <ActionTile icon={<Boxes />}        label="Inventory"            hint="View & edit stock"          onClick={() => navigateTo('inventory')} />
        <ActionTile icon={<Users />}        label="Customers"            hint="Customer data & portals"     onClick={() => navigateTo('customers')} />
        <ActionTile icon={<Truck />}        label="Vendors"              hint="Procurement suppliers"       onClick={() => navigateTo('vendors')} />
        <ActionTile icon={<ClipboardList />} label="Procurement"         hint="Requisitions & RFQs"         onClick={() => navigateTo('procurementDashboard')} />
        <ActionTile icon={<Settings />}     label="Procurement settings" hint="Thresholds & approvals"      onClick={() => navigateTo('procurementSettings')} />
        <ActionTile icon={<Calculator />}   label="Pricing"              hint="Costs & margins"             onClick={() => navigateTo('pricingManagement')} />
        <ActionTile icon={<History />}      label="Activity log"         hint="System audit trail"          onClick={() => navigateTo('auditTrail')} />
        <ActionTile icon={<PenLine />}      label="My signatures"        hint="Approval signatures"         onClick={() => navigateTo('mySignatures')} />
      </motion.div>

      {/* PENDING RFQ APPROVALS — read-only oversight for finance */}
      {procStats.pendingApproval > 0 && (
        <Card className="mb-5">
          <div className="px-5 py-3 border-b border-n-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-n-200 text-n-700 grid place-items-center text-[12px] font-bold">
                {procStats.pendingApproval}
              </span>
              <div>
                <div className="text-[13px] font-semibold text-n-800">RFQs pending procurement-head approval</div>
                <div className="text-xs text-n-500 mt-0.5">Read-only — these awards are decided by procurement, not finance.</div>
              </div>
            </div>
            <Button variant="subtle" iconRight={<ExternalLink />} onClick={() => navigateTo('rfqList')}>View all</Button>
          </div>
          <motion.div variants={listContainer} initial="initial" animate="enter">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-n-50 border-b border-n-200">
                  <th className="px-4 py-2 text-left  font-semibold uppercase tracking-wider text-[11px] text-n-600">RFQ</th>
                  <th className="px-4 py-2 text-left  font-semibold uppercase tracking-wider text-[11px] text-n-600">Title</th>
                  <th className="px-4 py-2 text-left  font-semibold uppercase tracking-wider text-[11px] text-n-600">Vendor</th>
                  <th className="px-4 py-2 text-right font-semibold uppercase tracking-wider text-[11px] text-n-600">Amount</th>
                  <th className="px-4 py-2 text-left  font-semibold uppercase tracking-wider text-[11px] text-n-600">Created</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rfqs.filter(r => r.status === 'PENDING_APPROVAL').slice(0, 5).map(rfq => (
                  <motion.tr
                    key={rfq.id}
                    variants={listRow}
                    className="border-b border-n-100 hover:bg-n-50 cursor-pointer transition-colors"
                    onClick={() => navigateTo('rfqDetail', rfq.id)}
                  >
                    <td className="px-4 py-2 font-mono-num text-[12.5px]">{rfq.rfqNumber}</td>
                    <td className="px-4 py-2 truncate max-w-[260px]">{rfq.title || '—'}</td>
                    <td className="px-4 py-2 text-n-600">{rfq.awardedVendorName || rfq.recommendedVendorName || '—'}</td>
                    <td className="px-4 py-2 text-right font-mono-num text-[12.5px] font-semibold">{fmtMoney(rfq.currency, rfq.totalAwardAmount)}</td>
                    <td className="px-4 py-2 text-xs text-n-500">{rfq.createdAt ? new Date(rfq.createdAt).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-2 text-right"><Button size="sm" variant="subtle">View</Button></td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        </Card>
      )}

      {/* INVOICE RE-APPROVAL QUEUE — Phase 4 */}
      {reapprovalQueue.length > 0 && (
        <Card className="mb-5 border-warn/40">
          <div className="px-5 py-3 border-b border-n-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-warn text-white grid place-items-center text-[12px] font-bold">
                {reapprovalQueue.length}
              </span>
              <div>
                <div className="text-[13px] font-semibold text-n-800 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-warn" /> Invoices needing re-approval
                </div>
                <div className="text-xs text-n-500 mt-0.5">Sourcing materially changed the total — controller sign-off required.</div>
              </div>
            </div>
            <Button variant="subtle" iconRight={<ExternalLink />} onClick={() => navigateTo('invoices')}>View all</Button>
          </div>
          <motion.div variants={listContainer} initial="initial" animate="enter">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-n-50 border-b border-n-200">
                  <th className="px-4 py-2 text-left  font-semibold uppercase tracking-wider text-[11px] text-n-600">Invoice</th>
                  <th className="px-4 py-2 text-left  font-semibold uppercase tracking-wider text-[11px] text-n-600">Customer</th>
                  <th className="px-4 py-2 text-right font-semibold uppercase tracking-wider text-[11px] text-n-600">Original</th>
                  <th className="px-4 py-2 text-right font-semibold uppercase tracking-wider text-[11px] text-n-600">Final</th>
                  <th className="px-4 py-2 text-center font-semibold uppercase tracking-wider text-[11px] text-n-600">Variance</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {reapprovalQueue.slice(0, 5).map(inv => {
                  const orig = Number(inv.originalEstimate || 0);
                  const fin  = Number(inv.total || 0);
                  const variance = Number(inv.reapprovalVariance || 0);
                  const up = fin > orig;
                  return (
                    <motion.tr
                      key={inv.id}
                      variants={listRow}
                      className="border-b border-n-100 hover:bg-n-50 cursor-pointer transition-colors"
                      onClick={() => navigateTo('invoiceEditor', { invoiceId: inv.id })}
                    >
                      <td className="px-4 py-2 font-mono-num text-[12.5px]">{inv.approvedInvoiceId || inv.id}</td>
                      <td className="px-4 py-2">{inv.customerName}</td>
                      <td className="px-4 py-2 text-right font-mono-num text-[12.5px]">{formatCurrency(inv.currency || 'GHS', orig)}</td>
                      <td className="px-4 py-2 text-right font-mono-num text-[12.5px] font-semibold">{formatCurrency(inv.currency || 'GHS', fin)}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`inline-flex items-center gap-1 text-[12px] font-semibold ${up ? 'text-err' : 'text-ok'}`}>
                          {up ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                          {variance.toFixed(2)}%
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right"><Button size="sm" variant="primary">Review</Button></td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </motion.div>
        </Card>
      )}

      {/* RFQ AT-RISK QUEUE — Phase 5 */}
      {riskQueue.length > 0 && (
        <Card className="mb-5 border-err/40">
          <div className="px-5 py-3 border-b border-n-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-err text-white grid place-items-center text-[12px] font-bold">
                {riskQueue.length}
              </span>
              <div>
                <div className="text-[13px] font-semibold text-n-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-err" /> RFQs at risk
                </div>
                <div className="text-xs text-n-500 mt-0.5">Escalated or past submission deadline.</div>
              </div>
            </div>
            <Button variant="subtle" iconRight={<ExternalLink />} onClick={() => navigateTo('rfqList')}>View all</Button>
          </div>
          <motion.div variants={listContainer} initial="initial" animate="enter">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-n-50 border-b border-n-200">
                  <th className="px-4 py-2 text-left  font-semibold uppercase tracking-wider text-[11px] text-n-600">RFQ</th>
                  <th className="px-4 py-2 text-left  font-semibold uppercase tracking-wider text-[11px] text-n-600">Title</th>
                  <th className="px-4 py-2 text-left  font-semibold uppercase tracking-wider text-[11px] text-n-600">Status</th>
                  <th className="px-4 py-2 text-left  font-semibold uppercase tracking-wider text-[11px] text-n-600">Deadline</th>
                  <th className="px-4 py-2 text-center font-semibold uppercase tracking-wider text-[11px] text-n-600">Age</th>
                  <th className="px-4 py-2 text-center font-semibold uppercase tracking-wider text-[11px] text-n-600">Risk</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {riskQueue.slice(0, 5).map(r => (
                  <motion.tr
                    key={r.id}
                    variants={listRow}
                    className="border-b border-n-100 hover:bg-n-50 cursor-pointer transition-colors"
                    onClick={() => navigateTo('rfqDetail', r.id)}
                  >
                    <td className="px-4 py-2 font-mono-num text-[12.5px]">{r.rfqNumber}</td>
                    <td className="px-4 py-2 truncate max-w-[220px]">{r.title || '—'}</td>
                    <td className="px-4 py-2"><StatusBadge value={r.status} /></td>
                    <td className="px-4 py-2 text-xs text-n-500">{r.submissionDeadline || '—'}</td>
                    <td className="px-4 py-2 text-center text-xs text-n-500">{r.daysOpen != null ? `${r.daysOpen}d` : '—'}</td>
                    <td className="px-4 py-2 text-center">
                      {r.isEscalated ? (
                        <span className="inline-flex items-center gap-1 text-[10.5px] font-bold px-2 py-0.5 bg-err text-white rounded-pill">
                          <AlertCircle className="w-3 h-3" /> ESCALATED
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 bg-warn-soft text-warn rounded-pill">
                          <Clock className="w-3 h-3" /> PAST DEADLINE
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right"><Button size="sm" variant="subtle">Review</Button></td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        </Card>
      )}

      {/* CHARTS + KPIs */}
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="enter"
        className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-2"
      >
        <ChartCard title="Monthly invoice statistics" subtitle="Recognized revenue (Customer Accepted + Paid)" height={300}>
          {invoicesLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-10 h-10 rounded-full border-2 border-n-100 border-t-accent animate-spin" />
            </div>
          ) : invoiceData.length === 0 ? (
            <EmptyState dense title="No revenue yet" body="Recognized revenue will appear here once invoices are paid or accepted." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={invoiceData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
                <XAxis dataKey="name" tick={{ fill: CHART_COLORS.axis, fontSize: 11 }} axisLine={{ stroke: CHART_COLORS.grid }} tickLine={false} />
                <YAxis tick={{ fill: CHART_COLORS.axis, fontSize: 11 }} axisLine={{ stroke: CHART_COLORS.grid }} tickLine={false} />
                <Tooltip
                  formatter={(v) => formatCurrency('GHS', v)}
                  contentStyle={{ background:'#fff', border:`1px solid ${CHART_COLORS.grid}`, borderRadius:6, fontSize:12 }}
                />
                <Bar
                  dataKey="total"
                  fill={CHART_COLORS.accent}
                  radius={[3, 3, 0, 0]}
                  isAnimationActive
                  animationDuration={700}
                  animationEasing="ease-out"
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <Card className="overflow-hidden">
          <div className="grid grid-cols-2 divide-x divide-n-200 h-full">
            <KpiBig
              label="Inventory health"
              value={`${inventoryHealthData}%`}
              hint="of items above reorder level"
              tone={inventoryHealthData >= 80 ? 'ok' : inventoryHealthData >= 60 ? 'warn' : 'err'}
              loading={inventoryLoading}
            />
            <KpiBig
              label="Recognised invoices"
              value={recognised}
              hint="revenue-generating invoices"
              tone="accent"
              loading={invoicesLoading}
            />
          </div>
        </Card>
      </motion.div>

      {openReport && <ReportModal role="controller" onClose={() => setOpenReport(false)} />}
    </>
  );
};

/* ── Helpers ──────────────────────────────────────────────── */

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

function KpiBig({ label, value, hint, tone = 'accent', loading }) {
  const toneCls =
    tone === 'ok'   ? 'text-ok'
  : tone === 'warn' ? 'text-warn'
  : tone === 'err'  ? 'text-err'
  :                   'text-accent';
  return (
    <div className="flex flex-col items-center justify-center text-center px-4 py-8">
      <div className="text-[12px] text-n-500 mb-1">{label}</div>
      {loading ? (
        <div className="w-20 h-9 v2-shimmer rounded-md" />
      ) : (
        <div className={`text-5xl font-bold font-mono-num ${toneCls} leading-none`}>{value}</div>
      )}
      <div className="text-[12px] text-n-500 mt-2">{hint}</div>
    </div>
  );
}

export default ControllerAnalyticsDashboard;
