import React, { createContext, useContext, useState, useEffect } from 'react';
import GlobalStaleCheck from '../components/GlobalStaleCheck';
import { logActivity } from '../utils/logger';
import api from '../api';
// v2 (Fluent 2 Office) shell. Replaces AppLayout. The legacy AppLayout
// is still imported below as a fallback; once every page is verified on
// AppShell we'll delete the v1 layout module entirely.
import AppShell from '../components/v2/AppShell';
import Forbidden from '../components/v2/Forbidden';
// eslint-disable-next-line no-unused-vars
import AppLayout from '../components/layout/AppLayout';
// Page-level permission gate (shared with backend via shared/permissions.js)
import { canOpenPage as _canOpenPageNew, PAGE_PERMISSIONS } from '../utils/permissions';
// Role-aware navigation helpers — understand BOTH legacy flat roles and
// the new tiered roles, so a `finance_head` lands where a `controller`
// would have, etc.
import { landingPageFor } from '../utils/roles';
import { NotificationProvider } from './NotificationContext';

// Import all page components
// Cinematic 3D login (replaces the flat LoginScreen). Lazy import is
// done INSIDE the component file itself so the three.js bundle ships
// only when the page actually mounts.
import LoginCinematic from '../pages/LoginCinematic';
import ControllerAnalyticsDashboard from '../pages/ControllerAnalyticsDashboard';
import SalesAnalyticsDashboard from '../pages/SalesAnalyticsDashboard';
import QuotingModule from '../pages/QuotingModule';
import MyInvoices from '../pages/MyInvoices';
import SalesInvoiceApproval from '../pages/SalesInvoiceApproval';
import SalesInvoiceReview from '../pages/SalesInvoiceReview';
import AllInvoices from '../pages/AllInvoices';
import InvoiceEditor from '../pages/InvoiceEditor';
import InventoryManagement from '../pages/InventoryManagement';
import SalesPriceList from '../pages/SalesPriceList';
import CollectionsWorkbench from '../pages/CollectionsWorkbench';
import CustomerStatement from '../pages/CustomerStatement';
import GoodsReceipts from '../pages/GoodsReceipts';
import VendorScorecard from '../pages/VendorScorecard';
import CustomerManagement from '../pages/CustomerManagement';
import CustomerPortal from '../pages/CustomerPortal';
import TaxSettings from '../pages/TaxSettings';
import MySignatures from '../pages/MySignatures';
import AuditTrail from '../pages/AuditTrail';
import PricingManagementLocal from '../components/PricingManagementLocal';
import VendorManagement from '../pages/VendorManagement';
import ProcurementDashboard from '../pages/ProcurementDashboard';
import PurchaseRequisitionList from '../pages/PurchaseRequisitionList';
import PurchaseRequisitionDetail from '../pages/PurchaseRequisitionDetail';
import RFQList from '../pages/RFQList';
import RFQBuilder from '../pages/RFQBuilder';
import RFQDetail from '../pages/RFQDetail';
import ProcurementSettings from '../pages/ProcurementSettings';
import UserManagement from '../pages/UserManagement';
// EH — admin Error Monitor (real-time observability of QA_ERROR_LOG)
import ErrorMonitor from '../pages/ErrorMonitor';
import NumberingSettings from '../pages/NumberingSettings';
// EH — page-level boundary so a render crash in one view doesn't whitescreen the rest of the app
import ErrorBoundary from '../components/v2/ErrorBoundary';
// Module 5 — Reports layer (hub + placeholder for all 24 reports)
import ReportsHub from '../pages/reports/ReportsHub';
import ReportPlaceholder from '../pages/reports/ReportPlaceholder';
// Module 5 — Phase 5.1 Finance reports (built out one-by-one)
import ArAgingReport from '../pages/reports/finance/ArAgingReport';
import VatComplianceReport from '../pages/reports/finance/VatComplianceReport';
import SalesRegisterReport from '../pages/reports/finance/SalesRegisterReport';
import WhtCollectedReport from '../pages/reports/finance/WhtCollectedReport';
import DsoTrendReport from '../pages/reports/finance/DsoTrendReport';
import CashCollectionsReport from '../pages/reports/finance/CashCollectionsReport';
import CustomerProfitabilityReport from '../pages/reports/finance/CustomerProfitabilityReport';
import BadDebtProvisionReport from '../pages/reports/finance/BadDebtProvisionReport';
// Module 5.2 — Procurement reports (8)
import PrBacklogAgingReport     from '../pages/reports/procurement/PrBacklogAgingReport';
import RfqCycleTimeReport       from '../pages/reports/procurement/RfqCycleTimeReport';
import OpenRfqsAttentionReport  from '../pages/reports/procurement/OpenRfqsAttentionReport';
import SpendByVendorReport      from '../pages/reports/procurement/SpendByVendorReport';
import SpendByCategoryReport    from '../pages/reports/procurement/SpendByCategoryReport';
import OverrideAuditReport      from '../pages/reports/procurement/OverrideAuditReport';
import LeadTimeAccuracyReport   from '../pages/reports/procurement/LeadTimeAccuracyReport';
import PrCancellationReport     from '../pages/reports/procurement/PrCancellationReport';
// Module 5.3 — Sales reports (8)
import SalesPipelineReport      from '../pages/reports/sales/SalesPipelineReport';
import QuoteConversionReport    from '../pages/reports/sales/QuoteConversionReport';
import RevenueVsTargetReport    from '../pages/reports/sales/RevenueVsTargetReport';
import SalesLeaderboardReport   from '../pages/reports/sales/SalesLeaderboardReport';
import QuoteAgingReport         from '../pages/reports/sales/QuoteAgingReport';
import WinLossReport            from '../pages/reports/sales/WinLossReport';
import TopCustomersReport       from '../pages/reports/sales/TopCustomersReport';
import TopProductsReport        from '../pages/reports/sales/TopProductsReport';

const AppContext = createContext();

// Map a user role to its default landing page after login/session-restore.
//
// Delegates to `landingPageFor` (src/utils/roles.js) which understands
// both the legacy flat roles AND the tiered roles. The previous version
// hard-coded a switch over `controller`/`procurement`/`sales` only, so
// every tiered role (finance_head, sales_officer, …) fell through the
// `default:` branch and landed on the SALES dashboard — that's why a
// finance head opened on the wrong dashboard with zero data.
const roleToLandingPage = (role) => landingPageFor(role);

// Pages that each role may access. Unauthenticated pages (login) are always allowed.
// Pages not listed for a role redirect to that role's landing page.
const PAGE_ROLES = {
    // Everyone authenticated
    auditTrail:               ['sales', 'controller', 'admin', 'procurement'],
    customerPortal:           ['sales', 'controller', 'admin', 'procurement'],

    // Sales only
    salesDashboard:           ['sales', 'controller', 'admin'],
    quoting:                  ['sales', 'controller', 'admin'],
    myInvoices:               ['sales', 'controller', 'admin'],
    salesInvoiceReview:       ['sales', 'controller', 'admin'],
    // Personal-signature page — any authenticated user can manage their OWN
    // signatures (the component filters by createdBy=userId so there's no cross-user leak).
    mySignatures:             ['sales', 'controller', 'admin', 'procurement'],

    // Controller / Admin
    controllerDashboard:      ['controller', 'admin'],
    // Quote approval is a DUAL-PATH decision — a sales boss approves their team's
    // quotes, and finance (controller) is the fallback approver when sales is out.
    // Component-level gating inside SalesInvoiceApproval restricts sales users to a
    // read-only/approve-only flow; controller/admin retain full edit (tax, qty, pricing).
    salesInvoiceApproval:     ['sales', 'controller', 'admin'],
    invoices:                 ['controller', 'admin'],
    invoiceEditor:            ['controller', 'admin'],
    inventory:                ['controller', 'admin'],
    customers:                ['controller', 'admin'],
    taxSettings:              ['controller', 'admin'],
    pricingManagement:        ['controller', 'admin'],
    vendors:                  ['controller', 'admin', 'procurement'],
    procurementSettings:      ['controller', 'admin'],

    // Procurement + Controller/Admin
    procurementDashboard:     ['procurement', 'controller', 'admin'],
    purchaseRequisitions:     ['procurement', 'controller', 'admin'],
    purchaseRequisitionDetail:['procurement', 'controller', 'admin'],
    rfqList:                  ['procurement', 'controller', 'admin'],
    rfqBuilder:               ['procurement', 'controller', 'admin'],
    rfqDetail:                ['procurement', 'controller', 'admin'],
};

// Page gate.
//
// The NEW permission catalogue (`shared/permissions.js` via PAGE_PERMISSIONS)
// is the authoritative source — when a page is in it, that map alone decides.
// The legacy `PAGE_ROLES` is only consulted for pages that haven't been
// migrated yet (none should remain — kept defensively).
//
// Earlier this function AND-ed the two, which sounds conservative but
// actually broke every tiered role: the legacy list contains
// `['sales', 'controller', 'admin']` for `myInvoices`, so a logged-in
// `sales_head` would fail the legacy check (their role string isn't in
// the list) even though the new system grants `invoice.read.own` via
// inheritance. Result: tiered roles were locked out of every page that
// had a legacy entry.
const canAccessPage = (role, page) => {
    if (page in PAGE_PERMISSIONS) return _canOpenPageNew(role, page);
    const legacy = PAGE_ROLES[page];
    if (legacy) return legacy.includes(role);
    return true;   // page not restricted in either map
};

export const useApp = () => {
    const context = useContext(AppContext);
    if (!context) {
        throw new Error('useApp must be used within an AppProvider');
    }
    return context;
};

// All valid page keys for the app — used to validate URL params
const VALID_PAGES = new Set([
    'login', 'controllerDashboard', 'salesDashboard', 'quoting', 'myInvoices',
    'salesInvoiceApproval', 'salesInvoiceReview', 'invoices', 'invoiceEditor',
    'inventory', 'customers', 'customerPortal', 'taxSettings', 'auditTrail',
    'pricingManagement', 'vendors', 'procurementDashboard', 'purchaseRequisitions',
    'purchaseRequisitionDetail', 'rfqList', 'rfqBuilder', 'rfqDetail', 'procurementSettings',
    'mySignatures', 'userManagement',
    // Module 1 — Sales Price List (top-level)
    'salesPriceList',
    // Module 2 — Collections workbench + per-customer statement
    'collectionsWorkbench', 'customerStatement',
    // Module 3 — Goods receipts list + vendor scorecards
    'goodsReceipts', 'vendorScorecard',
    // Module 5 — Reports layer (hub + 24 reports)
    'reportsHub',
    'reportArAging', 'reportDsoTrend', 'reportCashCollections', 'reportSalesRegister',
    'reportVatCompliance', 'reportWhtCollected', 'reportCustomerProfitability', 'reportBadDebtProvision',
    'reportSalesPipeline', 'reportQuoteConversion', 'reportRevenueVsTarget', 'reportSalesLeaderboard',
    'reportQuoteAging', 'reportWinLoss', 'reportTopCustomers', 'reportTopProducts',
    'reportPrBacklog', 'reportRfqCycleTime', 'reportRfqsAttention', 'reportSpendByVendor',
    'reportSpendByCategory', 'reportOverrideAudit', 'reportLeadTimeAccuracy', 'reportPrCancellation',
    // EH — admin Error Monitor (gated by system.errors.read; admin-only by default)
    'errorMonitor',
    // Document numbering settings (admin + finance_head; gated by
    // system.number_sequences.edit). Configures the standardized
    // {PREFIX}-{DOC}-{PERIOD}-{NNNNN} format for INV/PR/RFQ/GR/MEMO.
    'numberingSettings'
]);

// Read the page from the current URL ?page= param (if valid)
const getPageFromURL = () => {
    const params = new URLSearchParams(window.location.search);
    const urlPage = params.get('page');
    return urlPage && VALID_PAGES.has(urlPage) ? urlPage : null;
};

export const AppProvider = ({ children }) => {
    // Company branding
    const companyName = 'MIDSA';

    // Initialize page from URL if present, otherwise default to login
    const [page, setPage] = useState(() => getPageFromURL() || 'login');
    const [pageContext, setPageContext] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const [userId, setUserId] = useState(null);
    const [userEmail, setUserEmail] = useState(null);
    const [appUser, setAppUser] = useState(null);

    // Browser back/forward navigation
    useEffect(() => {
        const handlePopState = (event) => {
            if (event.state && event.state.page) {
                setPage(event.state.page);
                setPageContext(event.state.context || null);
            } else {
                // Fallback: read from URL param if no state (e.g. initial entry)
                const urlPage = getPageFromURL();
                setPage(urlPage || 'login');
                setPageContext(null);
            }
        };

        window.addEventListener('popstate', handlePopState);

        // Replace the initial history entry with the current page state
        // so the first back-press has correct state
        const initialPage = getPageFromURL() || 'login';
        window.history.replaceState({ page: initialPage, context: null }, '', window.location.href);

        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    useEffect(() => {
        const initializeAuth = async () => {
            const token = localStorage.getItem('auth_token');
            if (token) {
                try {
                    const response = await api.get('/auth/me');
                    if (response.success && response.user) {
                        const user = response.user;
                        setUserId(user.uid || user.email);
                        setUserEmail(user.email);
                        setAppUser({ email: user.email, role: user.role, name: user.name });

                        logActivity(user.email, 'LOGIN_RESTORE', 'Session restored seamlessly');

                        // If URL has a valid deep-linked page, stay on it.
                        // Otherwise (login or no page), go to role landing.
                        const urlPage = getPageFromURL();
                        if (!urlPage || urlPage === 'login') {
                            const landing = roleToLandingPage(user.role);
                            setPage(landing);
                            // Update URL to reflect actual landing page
                            const url = new URL(window.location);
                            url.searchParams.set('page', landing);
                            window.history.replaceState({ page: landing, context: null }, '', url);
                        }
                    }
                } catch (error) {
                    console.error('Session expired or invalid:', error);
                    // SP1-H1+H2+H3 — clear ALL session keys on init failure
                    localStorage.removeItem('auth_token');
                    localStorage.removeItem('refresh_token');
                    localStorage.removeItem('app_user');
                    // If session is invalid, redirect to login and clean URL
                    setPage('login');
                    const url = new URL(window.location);
                    url.searchParams.delete('page');
                    window.history.replaceState({ page: 'login' }, '', url);
                }
            }
            setIsLoading(false);
        };

        initializeAuth();
    }, []);

    const navigate = (newPage, context = null) => {
        console.log(`Navigating to: ${newPage}`, context);

        const previousPage = page;
        setPage(newPage);
        setPageContext(context);

        const url = new URL(window.location);

        if (newPage === 'login') {
            // Logout: clear URL params and use replaceState to prevent
            // back-button returning to an authenticated page
            url.searchParams.delete('page');
            window.history.replaceState({ page: 'login' }, '', url);

            if (userEmail || userId) {
                const username = userEmail ? userEmail.split('@')[0] : (userId || 'System');
                logActivity(username, 'USER_LOGOUT', `User logged out`, {
                    category: 'auth',
                    severity: 'info',
                    originalUserId: userId
                });
            }
            // SP1-H1+H2+H3 — revoke the refresh token server-side before
            // clearing local storage. Fire-and-forget; we don't block the
            // logout UX on the round-trip.
            const refreshToken = localStorage.getItem('refresh_token');
            if (refreshToken) {
                fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refreshToken })
                }).catch(() => { /* best-effort */ });
            }
            localStorage.removeItem('auth_token');
            localStorage.removeItem('refresh_token');
            localStorage.removeItem('app_user');
        } else {
            // Normal navigation: push a new history entry
            url.searchParams.set('page', newPage);
            window.history.pushState({ page: newPage, context }, '', url);

            if (userEmail || userId) {
                const username = userEmail ? userEmail.split('@')[0] : (userId || 'System');
                logActivity(username, 'PAGE_VIEW', `Navigated to ${newPage}`, {
                    category: 'navigation',
                    page: newPage,
                    previousPage,
                    context: context ? JSON.stringify(context) : null,
                    originalUserId: userId
                });
            }
        }
    };

    const handleLogin = async (email) => {
        console.log('🔐 [DEBUG] handleLogin tracking email:', email);
        try {
            // Send OTP to email via REST API
            await api.post('/auth/send-otp', { email });
            console.log('✅ [DEBUG] OTP sent successfully to:', email);
            setUserEmail(email); 
        } catch (error) {
            console.error('❌ [ERROR] OTP request failed:', error);
            // Re-throw so LoginCinematic can surface the error via its own
            // in-scene error state (replaces the legacy browser alert).
            throw new Error(error?.response?.data?.error || 'Failed to send OTP. Please check your email and network connection.');
        }
    };

    const handleOTPLogin = async (otpCode) => {
        console.log('🔐 [DEBUG] handleOTPLogin verification');
        try {
            if (!userEmail) return;

            const response = await api.post('/auth/verify-otp', { email: userEmail, otp: otpCode });

            if (response.success) {
                // SP1-H1+H2+H3 — store BOTH access + refresh tokens.
                // The backend still returns `token` for backward-compat;
                // new clients should read `accessToken` explicitly.
                localStorage.setItem('auth_token', response.accessToken || response.token);
                if (response.refreshToken) {
                    localStorage.setItem('refresh_token', response.refreshToken);
                }
                
                const user = response.user;
                setAppUser({ email: user.email, role: user.role, name: user.name });
                setUserId(user.uid || user.email);

                logActivity(user.email, 'LOGIN_SUCCESS', 'User logged in via OTP successfully', {
                    category: 'auth'
                });

                navigate(roleToLandingPage(user.role));
            }
        } catch (error) {
            console.error('❌ [ERROR] OTP verification failed:', error);
            // Re-throw so LoginCinematic flips its red "failure" scene state.
            throw new Error(error?.response?.data?.error || 'Invalid OTP code. Please try again.');
        }
    };

    const value = {
        companyName,
        page,
        pageContext,
        isLoading,
        userId,
        userEmail,
        appUser,
        setAppUser,
        setUserEmail,
        navigate
    };

    const renderPage = () => {
        if (isLoading) {
            return (
                <div className="flex items-center justify-center min-h-screen bg-gray-100">
                    <div className="text-center">
                        <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mb-4"></div>
                        <p className="text-gray-600 text-lg">Loading...</p>
                    </div>
                </div>
            );
        }

        const commonProps = {
            navigateTo: navigate,
            userId,
            currentUser: appUser,
            userEmail
        };

        // Permission-based access control. The deny path used to silently
        // redirect to the user's home dashboard — that hid bugs (a user
        // clicking a nav item their role can't see just bounced) and was
        // a poor UX. Now we render the v2 Forbidden screen which states
        // the role + missing permission and lets the user choose to go
        // back. Bookmarked URLs that point to a now-restricted page also
        // get this visible, recoverable error rather than a quiet bounce.
        if (page !== 'login' && appUser && !canAccessPage(appUser.role, page)) {
            return <Forbidden page={page} requiredPermission={PAGE_PERMISSIONS[page]} />;
        }

        switch (page) {
            case 'login':
                return <LoginCinematic onLogin={handleLogin} onOTPLogin={handleOTPLogin} companyName={companyName} />;
            case 'controllerDashboard':
                return <ControllerAnalyticsDashboard {...commonProps} />;
            case 'salesDashboard':
                return <SalesAnalyticsDashboard {...commonProps} />;
            case 'quoting':
                return <QuotingModule {...commonProps} />;
            case 'myInvoices':
                return <MyInvoices {...commonProps} pageContext={pageContext} />;
            case 'salesInvoiceApproval':
                return <SalesInvoiceApproval {...commonProps} />;
            case 'salesInvoiceReview':
                return <SalesInvoiceReview {...commonProps} pageContext={pageContext} />;
            case 'invoices':
                return <AllInvoices {...commonProps} pageContext={pageContext} />;
            case 'invoiceEditor':
                return <InvoiceEditor {...commonProps} pageContext={pageContext} />;
            case 'inventory':
                return <InventoryManagement {...commonProps} />;
            case 'salesPriceList':
                return <SalesPriceList {...commonProps} />;
            case 'collectionsWorkbench':
                return <CollectionsWorkbench {...commonProps} />;
            case 'customerStatement':
                return <CustomerStatement {...commonProps} pageContext={pageContext} />;
            case 'goodsReceipts':
                return <GoodsReceipts {...commonProps} />;
            case 'vendorScorecard':
                return <VendorScorecard {...commonProps} />;
            // ── Module 5 — Reports layer ──────────────────────────────
            // Hub + 24 report pages. Phase 5.0 ships every report as a
            // <ReportPlaceholder> backed by its real endpoint (which
            // returns an empty envelope). Later phases swap each case
            // for the real report component.
            case 'reportsHub':
                return <ReportsHub {...commonProps} />;
            // Finance (Phase 5.1) — AR Aging is the first real implementation
            case 'reportArAging':
                return <ArAgingReport {...commonProps} />;
            case 'reportDsoTrend':
                return <DsoTrendReport {...commonProps} />;
            case 'reportCashCollections':
                return <CashCollectionsReport {...commonProps} />;
            case 'reportSalesRegister':
                return <SalesRegisterReport {...commonProps} />;
            case 'reportVatCompliance':
                return <VatComplianceReport {...commonProps} />;
            case 'reportWhtCollected':
                return <WhtCollectedReport {...commonProps} />;
            case 'reportCustomerProfitability':
                return <CustomerProfitabilityReport {...commonProps} />;
            case 'reportBadDebtProvision':
                return <BadDebtProvisionReport {...commonProps} />;
            // Sales (Phase 5.3)
            case 'reportSalesPipeline':
                return <SalesPipelineReport {...commonProps} />;
            case 'reportQuoteConversion':
                return <QuoteConversionReport {...commonProps} />;
            case 'reportRevenueVsTarget':
                return <RevenueVsTargetReport {...commonProps} />;
            case 'reportSalesLeaderboard':
                return <SalesLeaderboardReport {...commonProps} />;
            case 'reportQuoteAging':
                return <QuoteAgingReport {...commonProps} />;
            case 'reportWinLoss':
                return <WinLossReport {...commonProps} />;
            case 'reportTopCustomers':
                return <TopCustomersReport {...commonProps} />;
            case 'reportTopProducts':
                return <TopProductsReport {...commonProps} />;
            // Procurement (Phase 5.2)
            case 'reportPrBacklog':
                return <PrBacklogAgingReport {...commonProps} />;
            case 'reportRfqCycleTime':
                return <RfqCycleTimeReport {...commonProps} />;
            case 'reportRfqsAttention':
                return <OpenRfqsAttentionReport {...commonProps} />;
            case 'reportSpendByVendor':
                return <SpendByVendorReport {...commonProps} />;
            case 'reportSpendByCategory':
                return <SpendByCategoryReport {...commonProps} />;
            case 'reportOverrideAudit':
                return <OverrideAuditReport {...commonProps} />;
            case 'reportLeadTimeAccuracy':
                return <LeadTimeAccuracyReport {...commonProps} />;
            case 'reportPrCancellation':
                return <PrCancellationReport {...commonProps} />;
            case 'customers':
                return <CustomerManagement {...commonProps} />;
            case 'customerPortal':
                return <CustomerPortal {...commonProps} customerId={pageContext} />;
            case 'taxSettings':
                return <TaxSettings {...commonProps} />;
            case 'mySignatures':
                return <MySignatures {...commonProps} />;
            case 'auditTrail':
                return <AuditTrail {...commonProps} />;
            case 'pricingManagement':
                return <PricingManagementLocal {...commonProps} />;
            case 'vendors':
                return <VendorManagement {...commonProps} />;
            case 'procurementDashboard':
                return <ProcurementDashboard {...commonProps} />;
            case 'purchaseRequisitions':
                return <PurchaseRequisitionList {...commonProps} pageContext={pageContext} />;
            case 'purchaseRequisitionDetail':
                return <PurchaseRequisitionDetail {...commonProps} pageContext={pageContext} />;
            case 'rfqList':
                return <RFQList {...commonProps} />;
            case 'rfqBuilder':
                return <RFQBuilder {...commonProps} pageContext={pageContext} />;
            case 'rfqDetail':
                return <RFQDetail {...commonProps} pageContext={pageContext} />;
            case 'procurementSettings':
                return <ProcurementSettings {...commonProps} />;
            case 'userManagement':
                return <UserManagement {...commonProps} />;
            case 'errorMonitor':
                return <ErrorMonitor {...commonProps} />;
            case 'numberingSettings':
                return <NumberingSettings {...commonProps} />;
            default:
                if (appUser) {
                    const landing = roleToLandingPage(appUser.role);
                    if (landing === 'procurementDashboard') return <ProcurementDashboard {...commonProps} />;
                    if (landing === 'salesDashboard')        return <SalesAnalyticsDashboard {...commonProps} />;
                    return <ControllerAnalyticsDashboard {...commonProps} />;
                }
                return <LoginCinematic onLogin={handleLogin} onOTPLogin={handleOTPLogin} companyName={companyName} />;
        }
    };

    // Pages that render OUTSIDE the app chrome (sidebar + layout).
    // Login is pre-auth; customerPortal is a public deep-link view.
    const isChromeless = page === 'login' || page === 'customerPortal' || isLoading || !appUser;

    return (
        <AppContext.Provider value={value}>
            {/* NotificationProvider sits inside AppContext so `useApp()` is
                available to it. It's a thin wrapper — when no user is
                logged in it just renders children with empty state, so
                there's no harm wrapping the chromeless (login) tree too. */}
            <NotificationProvider>
                {/* EH — render every page inside a per-page ErrorBoundary so a
                    render-time crash in one view shows a recoverable error
                    screen instead of white-screening the whole SPA. The
                    boundary's `key={page}` resets the error state when the
                    user navigates to a different page. */}
                {isChromeless
                    ? <ErrorBoundary scope="page" key={page}>{renderPage()}</ErrorBoundary>
                    : <AppShell><ErrorBoundary scope="page" key={page}>{renderPage()}</ErrorBoundary></AppShell>}
                <GlobalStaleCheck />
            </NotificationProvider>
        </AppContext.Provider>
    );
};
