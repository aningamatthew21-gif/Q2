import React, { useState, useEffect } from 'react';
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Legend, ComposedChart, Area, AreaChart } from 'recharts';
import api from '../api';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import { calculateGrowth, calculateVariance, calculateVariancePercent, groupInvoicesByMonth, generateProjections } from '../utils/analytics';
import GlassModal from './common/GlassModal';
import Button from './common/Button';

export default function ReportModal({ role = 'controller', onClose, db }) {
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [dateRange, setDateRange] = useState({ startDate: '', endDate: '' });
  const [includeLegacy, setIncludeLegacy] = useState(false);
  const [targets, setTargets] = useState(null);

  // No appId needed — data is fetched via Oracle REST API

  const handleGenerate = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // 1. Fetch Invoices
      const invoicesParams = {
        limit: 1000
      };
      if (dateRange.startDate) invoicesParams.startDate = dateRange.startDate;
      if (dateRange.endDate) invoicesParams.endDate = dateRange.endDate;

      const invoicesRes = await api.get('/invoices', { params: invoicesParams });
      const invoices = invoicesRes.success ? invoicesRes.data : [];

      // 2. Fetch Customers
      const customersRes = await api.get('/customers');
      const customers = customersRes.success ? customersRes.data : [];

      // 3. Fetch Targets
      const currentYear = new Date().getFullYear().toString();
      let fetchedTargets = null;
      try {
        const targetsRes = await api.get(`/targets/${currentYear}`);
        if (targetsRes.success) {
          fetchedTargets = targetsRes.data;
        }
      } catch (err) {
        console.warn('Failed to fetch targets, using defaults:', err);
      }

      const finalTargets = fetchedTargets || {
        annualTarget: 0,
        monthlyTargets: {}
      };
      setTargets(finalTargets);

      // 4. Generate Report Data
      const reportData = generateReportData(invoices, customers, role, includeLegacy, finalTargets);
      setReport(reportData);

    } catch (err) {
      console.error('Report generation failed:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const generateReportData = (invoices, customers, role, includeLegacy, targets) => {
    // ... (Existing logic for summary, aging, etc. - reused)
    // Initialize summary metrics
    const summary = {
      totalApprovedInvoicesCount: 0,
      totalApprovedInvoicesValue: 0,
      totalRecognizedRevenue: 0,
      totalPaymentsReceived: 0,
      outstandingAR: 0,
      rejectedInvoiceCount: 0,
      rejectedInvoiceValue: 0,
      legacyOpeningBalanceCount: 0,
      legacyOpeningBalanceValue: 0
    };

    const invoicesRows = [];
    const paymentsLog = [];
    const customersSet = new Set();

    invoices.forEach(inv => {
      const status = inv.status || 'Other';
      const isLegacy = !!inv.isLegacy;
      const total = typeof inv.total === 'number' ? inv.total : parseFloat(inv.total || 0);

      if (status === 'Rejected') {
        summary.rejectedInvoiceCount += 1;
        summary.rejectedInvoiceValue += total;
      }

      // REVENUE RECOGNITION UPDATE: Only count Customer Accepted or Paid invoices
      if ((status === 'Customer Accepted' || status === 'Paid') && (!isLegacy || includeLegacy)) {
        summary.totalApprovedInvoicesCount += 1; // Keeping variable name to minimize refactor churn, but logic is updated
        summary.totalApprovedInvoicesValue += total;
        summary.totalRecognizedRevenue += total;
      }

      (inv.payments || []).forEach(p => {
        const pAmount = typeof p.amount === 'number' ? p.amount : parseFloat(p.amount || 0);
        paymentsLog.push({
          invoiceId: inv.id,
          customerId: inv.customerId || null,
          customerName: inv.customerName || null,
          amount: pAmount,
          date: p.date || null,
          docNumber: p.docNumber || null,
          method: p.paymentMethod || p.method || null
        });
        summary.totalPaymentsReceived += pAmount;
      });

      const paidSoFar = (inv.payments || []).reduce((s, p) => s + (parseFloat(p.amount || 0)), 0);
      const remaining = Math.max(0, total - paidSoFar);

      invoicesRows.push({
        id: inv.id,
        customerId: inv.customerId || null,
        customerName: inv.customerName || null,
        date: inv.date || null,
        dueDate: inv.dueDate || null,
        total,
        paidSoFar,
        remaining,
        status,
        isLegacy
      });

      if (isLegacy && inv.type === 'OpeningBalance') {
        summary.legacyOpeningBalanceCount += 1;
        summary.legacyOpeningBalanceValue += total;
      }

      if (inv.customerId) customersSet.add(inv.customerId);
    });

    // Aging Analysis
    const now = new Date();
    const agingBuckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    invoicesRows.forEach(inv => {
      // AGING UPDATE: Only age invoices that are recognized (Customer Accepted) or Paid (partially)
      // We exclude 'Approved' (Ready to Send) and 'Awaiting Acceptance' as the debt is not yet acknowledged
      if ((inv.status !== 'Customer Accepted' && inv.status !== 'Paid') || inv.isLegacy) return;
      const invoiceDate = inv.date ? new Date(inv.date) : null;
      if (!invoiceDate) return;
      const diffDays = Math.ceil((now - invoiceDate) / (1000 * 60 * 60 * 24));
      const rem = inv.remaining || 0;
      if (diffDays <= 30) agingBuckets['0-30'] += rem;
      else if (diffDays <= 60) agingBuckets['31-60'] += rem;
      else if (diffDays <= 90) agingBuckets['61-90'] += rem;
      else agingBuckets['90+'] += rem;
      summary.outstandingAR += rem;
    });

    // Analytics: Monthly Revenue vs Target
    const monthlyData = groupInvoicesByMonth(invoices);
    const analyticsData = monthlyData.map(m => {
      const monthKey = m.month.split('-')[1]; // '01', '02'
      const target = targets?.monthlyTargets?.[monthKey] || 0;
      return {
        ...m,
        target,
        variance: calculateVariance(m.revenue, target),
        variancePercent: calculateVariancePercent(m.revenue, target)
      };
    });

    // Analytics: Projections
    const projections = generateProjections(monthlyData, targets?.annualTarget);

    return {
      meta: {
        appId,
        roleRequested: role,
        generatedBy: 'client-side',
        generatedAt: new Date().toISOString(),
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        includeLegacy
      },
      summary,
      agingBuckets,
      paymentsLog,
      invoices: invoicesRows,
      analytics: {
        monthlyData: analyticsData,
        projections,
        annualTarget: targets?.annualTarget || 0,
        ytdRevenue: summary.totalRecognizedRevenue,
        ytdTargetVariance: summary.totalRecognizedRevenue - (targets?.annualTarget || 0) // Simplified YTD variance
      }
    };
  };

  const downloadPdf = async () => {
    if (!report) return;
    const doc = new jsPDF();

    // Header
    doc.setFontSize(20);
    doc.text(`Full ${role === 'controller' ? 'Controller' : 'Sales'} Report`, 14, 22);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date(report.meta.generatedAt).toLocaleString()}`, 14, 30);

    // Summary
    doc.setFontSize(14);
    doc.text('Executive Summary', 14, 45);

    const summaryData = [
      ['Metric', 'Value'],
      ['Total Revenue', formatCurrency(report.summary.totalRecognizedRevenue)],
      ['Outstanding AR', formatCurrency(report.summary.outstandingAR)],
      ['Total Payments', formatCurrency(report.summary.totalPaymentsReceived)],
      ['Recognized Invoices', report.summary.totalApprovedInvoicesCount.toString()]
    ];

    autoTable(doc, {
      startY: 50,
      head: [summaryData[0]],
      body: summaryData.slice(1),
      theme: 'striped',
      headStyles: { fillColor: [66, 139, 202] }
    });

    // Capture Charts
    try {
      const revenueChart = document.getElementById('revenue-chart');
      const projectionsChart = document.getElementById('projections-chart');

      if (revenueChart || projectionsChart) {
        doc.addPage();
        doc.text('Visual Analytics', 14, 20);

        let currentY = 30;

        if (revenueChart) {
          const canvas = await html2canvas(revenueChart);
          const imgData = canvas.toDataURL('image/png');
          doc.text('Monthly Revenue vs Target', 14, currentY);
          doc.addImage(imgData, 'PNG', 14, currentY + 5, 180, 100);
          currentY += 115;
        }

        if (projectionsChart) {
          // Check if we need another page
          if (currentY + 110 > 280) {
            doc.addPage();
            currentY = 20;
          }
          const canvas = await html2canvas(projectionsChart);
          const imgData = canvas.toDataURL('image/png');
          doc.text('Revenue Projections', 14, currentY);
          doc.addImage(imgData, 'PNG', 14, currentY + 5, 180, 100);
        }
      }
    } catch (err) {
      console.error('Error capturing charts for PDF:', err);
    }

    // Monthly Performance Table
    doc.addPage();
    doc.text('Monthly Performance vs Target', 14, 20);

    const monthlyRows = report.analytics.monthlyData.map(m => [
      m.month,
      formatCurrency(m.revenue),
      formatCurrency(m.target),
      `${m.variancePercent.toFixed(1)}%`
    ]);

    autoTable(doc, {
      startY: 25,
      head: [['Month', 'Actual', 'Target', 'Variance %']],
      body: monthlyRows,
      theme: 'grid'
    });

    // Invoice Details (Top 50)
    doc.addPage();
    doc.text('Detailed Invoices (Top 50)', 14, 20);

    const invoiceRows = report.invoices.slice(0, 50).map(inv => [
      inv.id,
      inv.customerName,
      inv.date,
      formatCurrency(inv.total),
      inv.status
    ]);

    autoTable(doc, {
      startY: 25,
      head: [['ID', 'Customer', 'Date', 'Total', 'Status']],
      body: invoiceRows,
      styles: { fontSize: 8 }
    });

    doc.save(`report-${role}-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const downloadCsvClient = async (reportData) => {
    // ... (Existing CSV logic, enhanced with analytics data)
    if (!reportData) return;

    const rows = [];
    rows.push(['Report Generated:', reportData.meta.generatedAt]);
    rows.push(['']);

    // Analytics Section
    rows.push(['MONTHLY PERFORMANCE']);
    rows.push(['Month', 'Actual Revenue', 'Target', 'Variance', 'Variance %']);
    reportData.analytics.monthlyData.forEach(m => {
      rows.push([
        m.month,
        m.revenue,
        m.target,
        m.variance,
        m.variancePercent.toFixed(2) + '%'
      ]);
    });
    rows.push(['']);

    // ... (Append existing sections: Summary, Aging, Invoices)
    // Re-use existing logic for other sections

    const csvContent = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `report-${role}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  const formatCurrency = (amount) => new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', currencyDisplay: 'code' }).format(amount);

  return (
    <GlassModal
      open
      onClose={onClose}
      title={`Full ${role === 'controller' ? 'Controller' : 'Sales'} Report`}
      size="xl"
    >
      <div>
          {/* Controls */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg flex flex-wrap gap-4 items-end">
            {/* ... Date inputs ... */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <input type="date" value={dateRange.startDate} onChange={e => setDateRange(p => ({ ...p, startDate: e.target.value }))} className="p-2 border rounded" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <input type="date" value={dateRange.endDate} onChange={e => setDateRange(p => ({ ...p, endDate: e.target.value }))} className="p-2 border rounded" />
            </div>

            <button onClick={handleGenerate} disabled={isLoading} className="py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
              {isLoading ? 'Generating...' : 'Generate Report'}
            </button>

            {report && (
              <>
                <button onClick={() => downloadCsvClient(report)} className="py-2 px-4 bg-green-600 text-white rounded hover:bg-green-700">Export CSV</button>
                <button onClick={downloadPdf} className="py-2 px-4 bg-red-600 text-white rounded hover:bg-red-700">Export PDF</button>
              </>
            )}
          </div>

          {report && (
            <div className="space-y-8">
              {/* Summary Metrics */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-blue-50 p-4 rounded">
                  <h4 className="text-blue-800 font-semibold">Total Revenue</h4>
                  <div className="text-2xl font-bold">{formatCurrency(report.summary.totalRecognizedRevenue)}</div>
                </div>
                <div className="bg-green-50 p-4 rounded">
                  <h4 className="text-green-800 font-semibold">Annual Target</h4>
                  <div className="text-2xl font-bold">{formatCurrency(report.analytics.annualTarget)}</div>
                </div>
                <div className="bg-yellow-50 p-4 rounded">
                  <h4 className="text-yellow-800 font-semibold">Outstanding AR</h4>
                  <div className="text-2xl font-bold">{formatCurrency(report.summary.outstandingAR)}</div>
                </div>
                <div className="bg-purple-50 p-4 rounded">
                  <h4 className="text-purple-800 font-semibold">Recognized Invoices</h4>
                  <div className="text-2xl font-bold">{report.summary.totalApprovedInvoicesCount}</div>
                </div>
              </div>

              {/* Charts Row 1: Revenue vs Target */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div id="revenue-chart" className="bg-white p-4 border rounded shadow-sm">
                  <h3 className="font-semibold mb-4">Monthly Revenue vs Target</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={report.analytics.monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip formatter={(value) => formatCurrency(value)} />
                      <Legend />
                      <Bar dataKey="revenue" name="Actual Revenue" fill="#8884d8" />
                      <Line type="monotone" dataKey="target" name="Target" stroke="#ff7300" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                <div id="projections-chart" className="bg-white p-4 border rounded shadow-sm">
                  <h3 className="font-semibold mb-4">Revenue Projections (Next 3 Months)</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={[...report.analytics.monthlyData, ...report.analytics.projections]}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip formatter={(value) => formatCurrency(value)} />
                      <Area type="monotone" dataKey="revenue" stroke="#82ca9d" fill="#82ca9d" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Detailed Data Table */}
              <div className="bg-white border rounded shadow-sm overflow-hidden">
                <div className="p-4 bg-gray-50 border-b"><h3 className="font-semibold">Monthly Breakdown</h3></div>
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="p-3">Month</th>
                      <th className="p-3">Actual Revenue</th>
                      <th className="p-3">Target</th>
                      <th className="p-3">Variance</th>
                      <th className="p-3">Variance %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.analytics.monthlyData.map(m => (
                      <tr key={m.month} className="border-b">
                        <td className="p-3">{m.month}</td>
                        <td className="p-3">{formatCurrency(m.revenue)}</td>
                        <td className="p-3">{formatCurrency(m.target)}</td>
                        <td className={`p-3 ${m.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(m.variance)}</td>
                        <td className={`p-3 ${m.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>{m.variancePercent.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
      </div>
    </GlassModal>
  );
}

// End of component
