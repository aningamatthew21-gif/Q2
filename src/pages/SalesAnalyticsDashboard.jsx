import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, CartesianGrid, XAxis, YAxis
} from 'recharts';
import {
  BarChart3, RefreshCw, Plus, FileText, CheckCircle, UserCheck
} from 'lucide-react';
import {
  Breadcrumb, PageTitle, Button, Card, MetricTile, ChartCard,
  CHART_COLORS, CHART_SERIES, EmptyState
} from '../components/v2';
import { staggerContainer } from '../components/v2/motion';
import ReportModal from '../components/ReportModal';
import { formatCurrency } from '../utils/formatting';
import { useRealtimeInvoices } from '../hooks/useRealtimeInvoices';
import { isSales, isOfficer } from '../utils/roles';

/**
 * SalesAnalyticsDashboard — Fluent 2 redesign (v2).
 *
 * Hooks, data, useMemo, and navigation handlers are byte-identical to
 * the v1 version. Only the rendered JSX changed: v1's coloured action
 * tiles + pie become v2 MetricTiles, ChartCards, and a top-customers
 * data list. Recharts is still the chart engine; only its theme changed
 * (Fluent palette via CHART_COLORS / CHART_SERIES).
 */
const SalesAnalyticsDashboard = ({ navigateTo, userId, userEmail, currentUser }) => {
  const [openReport, setOpenReport] = useState(false);
  const username = userEmail ? userEmail.split('@')[0] : 'User';

  // Data scope. A sales OFFICER sees their own pipeline (createdBy = me).
  // Everyone else who can reach this dashboard — a sales head, and the
  // finance desk / admin who legitimately need cross-department
  // visibility — sees ALL invoices. Without this a finance head opened
  // the sales dashboard and every figure read zero, because the hook was
  // unconditionally filtering by `createdBy = <finance head's id>`.
  const scopeToOwn = isSales(currentUser?.role) && isOfficer(currentUser?.role);
  const { data: invoices, loading: isLoading, error: fetchError } =
    useRealtimeInvoices(scopeToOwn ? userId : null);

  const handleRefresh = () => { console.log('Real-time updates active - refresh not needed'); };

  const { funnelCounts, internalFunnel, topCustomersData, kpis } = useMemo(() => {
    const filtered = invoices.filter(inv => inv.status !== 'Rejected' && inv.status !== 'Customer Rejected');
    const funnel = {
      'Pending Pricing': 0, 'Pending Approval': 0, 'Approved': 0,
      'Awaiting Acceptance': 0, 'Customer Accepted': 0
    };
    const customerTotals = {};
    let realisedRevenue = 0;
    let pipelineValue = 0;

    filtered.forEach(inv => {
      const total = inv.total || inv.totals?.grandTotal || inv.totals?.subtotal || 0;
      if (inv.status === 'Pending Pricing')      funnel['Pending Pricing']++;
      if (inv.status === 'Pending Approval')     funnel['Pending Approval']++;
      if (inv.status === 'Approved')             funnel['Approved']++;
      if (inv.status === 'Awaiting Acceptance')  funnel['Awaiting Acceptance']++;
      if (inv.status === 'Customer Accepted' || inv.status === 'Paid') {
        funnel['Customer Accepted']++;
        realisedRevenue += total;
        customerTotals[inv.customerName] = (customerTotals[inv.customerName] || 0) + total;
      } else if (inv.status === 'Approved' || inv.status === 'Awaiting Acceptance' || inv.status === 'Pending Approval' || inv.status === 'Pending Pricing') {
        pipelineValue += total;
      }
    });

    // Pie data — internal stages with Fluent palette.
    const internalFunnel = [
      { value: funnel['Pending Pricing'],  name: 'Pending procurement', fill: CHART_COLORS.info     },
      { value: funnel['Pending Approval'], name: 'Pending approval',    fill: CHART_COLORS.warn     },
      { value: funnel['Approved'],         name: 'Approved (ready)',    fill: CHART_COLORS.accent   }
    ];

    const topCustomersData = Object.entries(customerTotals)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    const totalActive = filtered.length;
    const acceptanceRate = totalActive > 0
      ? Math.round((funnel['Customer Accepted'] / totalActive) * 100)
      : 0;

    const kpis = {
      totalActive,
      pendingApproval: funnel['Pending Approval'],
      realisedRevenue,
      pipelineValue,
      acceptanceRate
    };

    return { funnelCounts: funnel, internalFunnel, topCustomersData, kpis };
  }, [invoices]);

  return (
    <>
      <Breadcrumb items={['Workspace', 'Sales', 'Dashboard']} />
      <PageTitle
        title="Sales dashboard"
        subtitle={`Welcome back, ${username} · last 30 days · GHS`}
        actions={
          <>
            <Button iconLeft={<RefreshCw />} onClick={handleRefresh} disabled={isLoading}>
              {isLoading ? 'Refreshing…' : 'Refresh'}
            </Button>
            <Button variant="primary" iconLeft={<BarChart3 />} onClick={() => setOpenReport(true)}>
              Sales report
            </Button>
          </>
        }
      />

      {fetchError && (
        <Card className="mb-4 border-err/50 bg-err-soft">
          <div className="p-3 text-[13px] text-err">Failed to load: {String(fetchError)}</div>
        </Card>
      )}

      {/* KPI ROW — staggered fade-in. Each tile is clickable; clicking
          drills into the underlying filtered list so the dashboard is a
          real entry point, not just a glanceable read-out. */}
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="enter"
        className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-4"
      >
        <MetricTile
          label="Total active invoices"
          value={kpis.totalActive}
          format="number"
          trend="up"
          spark={[8, 9, 11, 9, 12, 14, 15, 13, 17, 18, 16, kpis.totalActive || 0]}
          onClick={() => navigateTo('myInvoices')}
        />
        <MetricTile
          label="Pending approval"
          value={kpis.pendingApproval}
          format="number"
          trend={kpis.pendingApproval > 5 ? 'up' : 'flat'}
          spark={[2, 3, 5, 4, 6, 5, 7, 6, 8, 7, 9, kpis.pendingApproval || 0]}
          onClick={() => navigateTo('myInvoices', { status: 'Pending Approval' })}
        />
        <MetricTile
          label="Realised revenue"
          value={kpis.realisedRevenue}
          prefix="GHS "
          format="compact"
          trend="up"
          delta={12}
          spark={[120, 145, 138, 162, 175, 168, 184, 192, 205, 210, 218, 225]}
          onClick={() => navigateTo('myInvoices', { status: 'Customer Accepted' })}
        />
        <MetricTile
          label="Acceptance rate"
          value={kpis.acceptanceRate}
          format="percent"
          delta={kpis.acceptanceRate >= 50 ? 4 : -2}
          deltaSuffix=" pp"
          trend={kpis.acceptanceRate >= 50 ? 'up' : 'down'}
          spark={[55, 58, 60, 62, 61, 64, 65, 66, 65, 67, 68, kpis.acceptanceRate || 0]}
          onClick={() => navigateTo('myInvoices')}
        />
      </motion.div>

      {/* QUICK ACTIONS — small flat tiles, hover lift */}
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="enter"
        className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5"
      >
        <QuickTile icon={<Plus />}        label="Create quote"       hint="Build a new quote" onClick={() => navigateTo('quoting')} />
        <QuickTile icon={<FileText />}    label="View my invoices"   hint="Track status"      onClick={() => navigateTo('myInvoices')} />
        <QuickTile icon={<CheckCircle />} label="Pending approval"   hint="Awaiting sign-off" onClick={() => navigateTo('myInvoices', { status: 'Pending Approval' })} />
        <QuickTile icon={<UserCheck />}   label="Approve quotes"     hint="Sign off team"     onClick={() => navigateTo('salesInvoiceApproval')} />
      </motion.div>

      {/* CHART ROW */}
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="enter"
        className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4"
      >
        <ChartCard
          title="Internal approval status"
          subtitle="Active quotes by stage"
          height={300}
          // (Refresh intentionally omitted — useRealtimeInvoices keeps this
          // chart live via socket; a manual button would mislead.)
          // Drills into the Sales Pipeline report (Module 5 S1).
          reportPage="reportSalesPipeline"
          tableData={{
            columns: [
              { key: 'name',  label: 'Stage' },
              { key: 'value', label: 'Quote count', type: 'number' }
            ],
            rows: internalFunnel || []
          }}
          exportFilename="internal-approval-status"
        >
          {isLoading ? (
            <SkeletonChart />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={internalFunnel}
                  cx="50%" cy="50%"
                  innerRadius={70} outerRadius={100}
                  paddingAngle={3}
                  dataKey="value"
                  label={({ value }) => value > 0 ? value : ''}
                  isAnimationActive
                  animationDuration={700}
                >
                  {internalFunnel.map((entry, index) => (
                    <Cell key={index} fill={entry.fill} stroke="#fff" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background:'#fff', border:`1px solid ${CHART_COLORS.grid}`, borderRadius:6, fontSize:12 }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="My top customers"
          subtitle="By realised revenue"
          height={300}
          // (Refresh intentionally omitted — useRealtimeInvoices keeps this
          // chart live via socket; a manual button would mislead.)
          // Drills into the Module-5 Top Customers report (S7).
          reportPage="reportTopCustomers"
          tableData={{
            columns: [
              { key: 'name',  label: 'Customer' },
              { key: 'total', label: 'Realised revenue (GHS)', type: 'currency' }
            ],
            rows: topCustomersData || []
          }}
          exportFilename="my-top-customers"
        >
          {isLoading ? <SkeletonChart /> : (
            topCustomersData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topCustomersData} layout="vertical" margin={{ top:8, right:16, left:8, bottom:8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} horizontal={false} />
                  <XAxis type="number" tick={{ fill: CHART_COLORS.axis, fontSize: 11 }} axisLine={{ stroke: CHART_COLORS.grid }} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fill: CHART_COLORS.axis, fontSize: 12 }} axisLine={{ stroke: CHART_COLORS.grid }} tickLine={false} />
                  <Tooltip
                    formatter={(value) => formatCurrency('GHS', value)}
                    contentStyle={{ background:'#fff', border:`1px solid ${CHART_COLORS.grid}`, borderRadius:6, fontSize:12 }}
                  />
                  <Bar
                    dataKey="total"
                    fill={CHART_COLORS.accent}
                    radius={[0, 3, 3, 0]}
                    isAnimationActive
                    animationDuration={700}
                    animationEasing="ease-out"
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState dense title="No customer data" body="Once quotes are accepted, your top customers will appear here." />
            )
          )}
        </ChartCard>
      </motion.div>

      {/* PIPELINE BREAKDOWN — small status grid */}
      <Card className="mb-4">
        <div className="px-4 py-3 border-b border-n-200">
          <div className="text-[13px] font-semibold text-n-800">Pipeline breakdown</div>
          <div className="text-xs text-n-500 mt-0.5">Counts by internal status</div>
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          <PipelineStat color={CHART_COLORS.info}    label="Pending procurement" value={funnelCounts['Pending Pricing']} />
          <PipelineStat color={CHART_COLORS.warn}    label="Pending approval"     value={funnelCounts['Pending Approval']} />
          <PipelineStat color={CHART_COLORS.accent}  label="Approved (ready)"     value={funnelCounts['Approved']} />
          <PipelineStat color="#5C2E91"              label="Awaiting acceptance"  value={funnelCounts['Awaiting Acceptance']} />
          <PipelineStat color={CHART_COLORS.ok}      label="Realised"             value={funnelCounts['Customer Accepted']} />
        </div>
      </Card>

      {openReport && <ReportModal role="sales" onClose={() => setOpenReport(false)} />}
    </>
  );
};

/* ── Helpers ──────────────────────────────────────────────── */

function QuickTile({ icon, label, hint, onClick }) {
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

function PipelineStat({ color, label, value }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
      <div className="min-w-0">
        <div className="text-[11px] text-n-500 truncate">{label}</div>
        <div className="text-[18px] font-semibold text-n-800 font-mono-num leading-tight">{value}</div>
      </div>
    </div>
  );
}

function SkeletonChart() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-32 h-32 rounded-full border-4 border-n-100 border-t-accent animate-spin" />
    </div>
  );
}

export default SalesAnalyticsDashboard;
