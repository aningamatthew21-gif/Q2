import React, { createContext, useContext, useState, useEffect } from 'react';
import GlobalStaleCheck from '../components/GlobalStaleCheck';
import { logActivity } from '../utils/logger';
import api from '../api';
// v2 (Fluent 2 Office) shell. Replaces AppLayout. The legacy AppLayout
// is still imported below as a fallback; once every page is verified on
// AppShell we'll delete the v1 layout module entirely.
import AppShell from '../components/v2/AppShell';
// eslint-disable-next-line no-unused-vars
import AppLayout from '../components/layout/AppLayout';

// Import all page components
import LoginScreen from '../pages/LoginScreen';
import ControllerAnalyticsDashboard from '../pages/ControllerAnalyticsDashboard';
import SalesAnalyticsDashboard from '../pages/SalesAnalyticsDashboard';
import QuotingModule from '../pages/QuotingModule';
import MyInvoices from '../pages/MyInvoices';
import SalesInvoiceApproval from '../pages/SalesInvoiceApproval';
import SalesInvoiceReview from '../pages/SalesInvoiceReview';
import AllInvoices from '../pages/AllInvoices';
import InvoiceEditor from '../pages/InvoiceEditor';
import InventoryManagement from '../pages/InventoryManagement';
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

const AppContext = createContext();

// Map a user role to its default landing page after login/session-restore.
const roleToLandingPage = (role) => {
    switch (role) {
        case 'controller':
        case 'admin':
            return 'controllerDashboard';
        case 'procurement':
            return 'procurementDashboard';
        case 'sales':
        default:
            return 'salesDashboard';
    }
};

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

const canAccessPage = (role, page) => {
    if (!PAGE_ROLES[page]) return true; // page not restricted
    return PAGE_ROLES[page].includes(role);
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
    'mySignatures'
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
                    localStorage.removeItem('auth_token');
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
            localStorage.removeItem('auth_token');
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
            alert('Failed to send OTP. Please check your email and network connection.');
        }
    };

    const handleOTPLogin = async (otpCode) => {
        console.log('🔐 [DEBUG] handleOTPLogin verification');
        try {
            if (!userEmail) return;

            const response = await api.post('/auth/verify-otp', { email: userEmail, otp: otpCode });
            
            if (response.success) {
                // Store JWT
                localStorage.setItem('auth_token', response.token);
                
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
            alert('Invalid OTP code. Please try again.');
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

        // Role-based access control — redirect to landing page if user lacks access
        if (page !== 'login' && appUser && !canAccessPage(appUser.role, page)) {
            const landing = roleToLandingPage(appUser.role);
            // Silently redirect without mutating URL so the browser back button still works
            setTimeout(() => navigate(landing), 0);
            return null;
        }

        switch (page) {
            case 'login':
                return <LoginScreen onLogin={handleLogin} onOTPLogin={handleOTPLogin} companyName={companyName} />;
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
            default:
                if (appUser) {
                    const landing = roleToLandingPage(appUser.role);
                    if (landing === 'procurementDashboard') return <ProcurementDashboard {...commonProps} />;
                    if (landing === 'salesDashboard')        return <SalesAnalyticsDashboard {...commonProps} />;
                    return <ControllerAnalyticsDashboard {...commonProps} />;
                }
                return <LoginScreen onLogin={handleLogin} onOTPLogin={handleOTPLogin} companyName={companyName} />;
        }
    };

    // Pages that render OUTSIDE the app chrome (sidebar + layout).
    // Login is pre-auth; customerPortal is a public deep-link view.
    const isChromeless = page === 'login' || page === 'customerPortal' || isLoading || !appUser;

    return (
        <AppContext.Provider value={value}>
            {isChromeless ? renderPage() : <AppShell>{renderPage()}</AppShell>}
            <GlobalStaleCheck />
        </AppContext.Provider>
    );
};
