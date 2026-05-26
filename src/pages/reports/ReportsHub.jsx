import React from 'react';
import PageHeader from '../../components/common/PageHeader';
import Card, { CardHead, CardBody } from '../../components/v2/Card';
import Icon from '../../components/common/Icon';
import { useApp } from '../../context/AppContext';
import { can } from '../../utils/permissions';

/**
 * ReportsHub — Module 5 landing page.
 *
 * Three columns (Finance / Sales / Procurement), each showing the 8
 * reports for that department. Columns hide entirely if the user
 * lacks the matching `reports.run.*` action. Sales heads & finance
 * heads see multiple columns; officers see one; admins see all.
 *
 * Each report card is a single-click navigate() into the corresponding
 * report page. Phase 5.0 ships all 24 link targets as "Coming soon"
 * placeholders via ReportPage; subsequent phases swap them out one by
 * one with the real report.
 */

// ── Report catalogue ─────────────────────────────────────────────────────
//
// Keep this catalogue as the single source of truth for what reports
// exist and which page key + icon + permission they map to. Phase 5.0
// uses it both for the hub grid and (later) for the LeftNav.

const REPORTS = {
    finance: {
        permission: 'reports.run.finance',
        title:      'Finance',
        accent:     'bg-blue-50 text-blue-700 border-blue-200',
        items: [
            { key: 'reportArAging',               icon: 'file-invoice-dollar',    label: 'AR Aging',                desc: 'Outstanding receivables aged from due date' },
            { key: 'reportDsoTrend',              icon: 'chart-line',             label: 'DSO Trend',                desc: 'Days Sales Outstanding over time' },
            { key: 'reportCashCollections',       icon: 'sack-dollar',            label: 'Cash Collections',         desc: 'Inflows by method + day, vs invoiced' },
            { key: 'reportSalesRegister',         icon: 'book',                   label: 'Sales Register',           desc: 'Audit-grade revenue recognition register' },
            { key: 'reportVatCompliance',         icon: 'percent',                label: 'VAT Compliance',           desc: 'Ghana GRA filing aid — VAT / NHIL / GETFund / COVID' },
            { key: 'reportWhtCollected',          icon: 'receipt',                label: 'Withholding Tax',          desc: 'WHT collected by type — filing aid' },
            { key: 'reportCustomerProfitability', icon: 'crown',                  label: 'Customer Profitability',   desc: 'Pareto — who drives revenue + margin' },
            { key: 'reportBadDebtProvision',      icon: 'triangle-exclamation',   label: 'Bad-Debt Provision',       desc: 'Age-based provision schedule' }
        ]
    },
    sales: {
        permission: 'reports.run.sales',
        title:      'Sales',
        accent:     'bg-emerald-50 text-emerald-700 border-emerald-200',
        items: [
            { key: 'reportSalesPipeline',         icon: 'bullseye',               label: 'Sales Pipeline',           desc: 'Value by lifecycle stage' },
            { key: 'reportQuoteConversion',       icon: 'arrows-rotate',          label: 'Quote Conversion Funnel',  desc: 'Drop-off at each stage with reasons' },
            { key: 'reportRevenueVsTarget',       icon: 'chart-column',           label: 'Revenue vs Target',        desc: 'Monthly + YTD attainment by rep' },
            { key: 'reportSalesLeaderboard',      icon: 'trophy',                 label: 'Sales Leaderboard',        desc: 'Rep ranking by revenue + win rate' },
            { key: 'reportQuoteAging',            icon: 'hourglass-half',         label: 'Quote Aging',              desc: 'Unaccepted quotes — nudge list' },
            { key: 'reportWinLoss',               icon: 'scale-balanced',         label: 'Win / Loss Analysis',      desc: 'Reasons + competitor breakdown' },
            { key: 'reportTopCustomers',          icon: 'user-group',             label: 'Top Customers',            desc: 'Pareto + industry / size slices' },
            { key: 'reportTopProducts',           icon: 'box',                    label: 'Top Products (ABC)',       desc: 'SKU revenue ranking — ABC classification' }
        ]
    },
    procurement: {
        permission: 'reports.run.procurement',
        title:      'Procurement',
        accent:     'bg-amber-50 text-amber-700 border-amber-200',
        items: [
            { key: 'reportPrBacklog',             icon: 'box-archive',            label: 'PR Backlog Aging',         desc: 'Open POs by age + owner' },
            { key: 'reportRfqCycleTime',          icon: 'stopwatch',              label: 'RFQ Cycle Time',           desc: 'PR → award stage breakdown' },
            { key: 'reportRfqsAttention',         icon: 'triangle-exclamation',   label: 'RFQs Needing Attention',   desc: 'Past-deadline / low-response / escalated' },
            { key: 'reportSpendByVendor',         icon: 'sack-dollar',            label: 'Spend by Vendor',          desc: 'Pareto — concentration risk' },
            { key: 'reportSpendByCategory',       icon: 'tag',                    label: 'Spend by Category',        desc: 'ABC analysis on item category' },
            { key: 'reportOverrideAudit',         icon: 'magnifying-glass',       label: 'Best-Price Override',      desc: 'Awards that overrode the system pick' },
            { key: 'reportLeadTimeAccuracy',      icon: 'clock',                  label: 'Lead-Time Accuracy',       desc: 'Committed vs actual delivery time' },
            { key: 'reportPrCancellation',        icon: 'ban',                    label: 'PR Cancellation',          desc: 'Cancellation reasons + trend' }
        ]
    }
};

const ReportsHub = ({ currentUser }) => {
    const { navigate } = useApp();

    // Filter to only the columns the user can see (per reports.run.*).
    // Finance head sees all 3 columns; officers see 1. Admin sees all.
    const visibleDepts = Object.entries(REPORTS).filter(([, dept]) =>
        can(currentUser, dept.permission)
    );

    return (
        <>
            <PageHeader
                title={
                    <span className="flex items-center gap-2">
                        <Icon id="chart-bar" className="text-primary" />
                        Reports
                    </span>
                }
                subtitle="Live, exportable reports across Finance, Sales, and Procurement"
            />

            {visibleDepts.length === 0 ? (
                <Card>
                    <CardBody>
                        <div className="text-center py-16 text-gray-500">
                            <Icon id="lock" className="w-10 h-10 mx-auto mb-2 text-gray-400" />
                            <div className="font-medium">You don't have permission to view any reports.</div>
                            <div className="text-sm mt-1">Ask your administrator to grant a <code>reports.run.*</code> role.</div>
                        </div>
                    </CardBody>
                </Card>
            ) : (
                <div className={`grid gap-4 ${
                    visibleDepts.length === 1 ? 'grid-cols-1' :
                    visibleDepts.length === 2 ? 'grid-cols-1 md:grid-cols-2' :
                    'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
                }`}>
                    {visibleDepts.map(([deptKey, dept]) => (
                        <Card key={deptKey}>
                            <CardHead
                                title={dept.title}
                                subtitle={`${dept.items.length} reports`}
                            />
                            <CardBody pad={false}>
                                <ul className="divide-y divide-gray-100">
                                    {dept.items.map(item => (
                                        <li
                                            key={item.key}
                                            onClick={() => navigate(item.key)}
                                            className="px-4 py-3 hover:bg-gray-50 cursor-pointer flex items-start gap-3 transition-colors"
                                        >
                                            <div className={`w-9 h-9 rounded-md grid place-items-center flex-shrink-0 border ${dept.accent}`}>
                                                <Icon id={item.icon} className="w-4 h-4" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-medium text-gray-800">{item.label}</div>
                                                <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">{item.desc}</div>
                                            </div>
                                            <Icon id="chevron-right" className="w-4 h-4 text-gray-400 flex-shrink-0 mt-1" />
                                        </li>
                                    ))}
                                </ul>
                            </CardBody>
                        </Card>
                    ))}
                </div>
            )}

            <div className="mt-6 text-xs text-gray-500">
                Reports refresh from live data. Scheduled email delivery is on the
                Phase 2 roadmap.
            </div>
        </>
    );
};

export default ReportsHub;
export { REPORTS };
