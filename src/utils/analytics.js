/**
 * Analytics Utility Functions
 * Centralizes logic for calculating growth, variance, and projections.
 */

export const calculateGrowth = (current, previous) => {
    if (!previous) return 0;
    return ((current - previous) / previous) * 100;
};

export const calculateVariance = (actual, target) => {
    if (!target) return 0;
    return actual - target;
};

export const calculateVariancePercent = (actual, target) => {
    if (!target) return 0;
    return ((actual - target) / target) * 100;
};

export const groupInvoicesByMonth = (invoices) => {
    const monthlyData = {};

    invoices.forEach(inv => {
        if (inv.status !== 'Approved' && inv.status !== 'Paid') return;

        const date = new Date(inv.date);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        if (!monthlyData[key]) {
            monthlyData[key] = {
                month: key,
                revenue: 0,
                count: 0
            };
        }

        monthlyData[key].revenue += (inv.total || 0);
        monthlyData[key].count += 1;
    });

    return Object.values(monthlyData).sort((a, b) => a.month.localeCompare(b.month));
};

export const generateProjections = (monthlyData, annualTarget) => {
    if (!monthlyData.length) return [];

    const lastMonth = monthlyData[monthlyData.length - 1];
    const avgRevenue = monthlyData.reduce((sum, m) => sum + m.revenue, 0) / monthlyData.length;

    // Simple linear projection for next 3 months
    const projections = [];
    let currentMonth = new Date(lastMonth.month + '-01');

    for (let i = 1; i <= 3; i++) {
        currentMonth.setMonth(currentMonth.getMonth() + 1);
        const key = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
        projections.push({
            month: key,
            revenue: avgRevenue,
            isProjection: true
        });
    }

    return projections;
};
