import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import GlassSurface from '../common/GlassSurface';
import Icon from '../common/Icon';
import UserSettingsModal from '../common/UserSettingsModal';

/**
 * Sidebar — persistent left-rail navigation.
 *
 * Apple-style translucent glass rail. Role-aware: nav items are
 * filtered by the active user's role (sales / controller / admin /
 * procurement). Uses `navigate()` from AppContext directly — no new
 * routing logic. The sidebar also hosts the user pill and Logout at
 * the bottom, so every page's inline header can lose those elements
 * in Phase D.
 *
 * Breakpoints:
 *   lg (≥1024px):  fixed 240px rail, labels visible
 *   md (≥768px):   collapsed 64px icon rail, labels on hover (tooltip)
 *   sm (<768px):   hidden; a hamburger toggles a drawer variant
 *
 * The drawer behaviour is driven by the `mobileOpen` prop + onClose
 * passed down from AppLayout.
 */

// Groups of nav items per role. Each item: { page, label, icon }
const SECTIONS = {
  sales: [
    { title: null, items: [
      { page: 'salesDashboard',      label: 'Dashboard',      icon: 'chart-line' },
      { page: 'quoting',             label: 'New Quote',      icon: 'file-invoice-dollar' },
      { page: 'myInvoices',          label: 'My Invoices',    icon: 'file-invoice' },
      { page: 'salesInvoiceApproval',label: 'Approvals',      icon: 'check-double' },
      { page: 'mySignatures',        label: 'My Signatures',  icon: 'signature' },
      { page: 'auditTrail',          label: 'Audit',          icon: 'history' }
    ]}
  ],
  controller: [
    { title: 'Overview', items: [
      { page: 'controllerDashboard', label: 'Dashboard',     icon: 'chart-pie' },
      { page: 'salesDashboard',      label: 'Sales',         icon: 'chart-line' }
    ]},
    { title: 'Invoices', items: [
      { page: 'invoices',            label: 'All Invoices',   icon: 'file-invoice' },
      { page: 'myInvoices',          label: 'My Invoices',    icon: 'user-tag' },
      { page: 'salesInvoiceApproval',label: 'Approvals',      icon: 'check-double' },
      { page: 'quoting',             label: 'New Quote',      icon: 'file-invoice-dollar' }
    ]},
    { title: 'Procurement', items: [
      { page: 'procurementDashboard',label: 'Dashboard',      icon: 'truck' },
      { page: 'purchaseRequisitions',label: 'PRs',            icon: 'clipboard-list' },
      { page: 'rfqList',             label: 'RFQs',           icon: 'file-contract' },
      { page: 'vendors',             label: 'Vendors',        icon: 'industry' }
    ]},
    { title: 'Inventory & Pricing', items: [
      { page: 'inventory',           label: 'Inventory',      icon: 'boxes-stacked' },
      { page: 'pricingManagement',   label: 'Pricing',        icon: 'tags' }
    ]},
    { title: 'Customers', items: [
      { page: 'customers',           label: 'Customers',      icon: 'users' }
    ]},
    { title: 'Settings', items: [
      { page: 'taxSettings',         label: 'Tax',            icon: 'percent' },
      { page: 'procurementSettings', label: 'Procurement',    icon: 'sliders' },
      { page: 'mySignatures',        label: 'My Signatures',  icon: 'signature' }
    ]},
    { title: null, items: [
      { page: 'auditTrail',          label: 'Audit',          icon: 'history' }
    ]}
  ],
  procurement: [
    { title: null, items: [
      { page: 'procurementDashboard',label: 'Dashboard',      icon: 'chart-pie' },
      { page: 'purchaseRequisitions',label: 'PRs',            icon: 'clipboard-list' },
      { page: 'rfqList',             label: 'RFQs',           icon: 'file-contract' },
      { page: 'vendors',             label: 'Vendors',        icon: 'industry' },
      { page: 'mySignatures',        label: 'My Signatures',  icon: 'signature' },
      { page: 'auditTrail',          label: 'Audit',          icon: 'history' }
    ]}
  ]
};

function sectionsForRole(role) {
  if (role === 'admin' || role === 'controller') return SECTIONS.controller;
  if (role === 'procurement')                    return SECTIONS.procurement;
  return SECTIONS.sales;
}

// Helper: detect whether the currently-rendered page falls within a given nav item.
// Some pages (rfqBuilder/rfqDetail, purchaseRequisitionDetail, invoiceEditor,
// salesInvoiceReview) are "drill-down" children of a list page. We treat the
// list page as active in those cases so the rail doesn't visually "lose" you.
const DRILL_PARENT = {
  rfqBuilder:              'rfqList',
  rfqDetail:               'rfqList',
  purchaseRequisitionDetail:'purchaseRequisitions',
  invoiceEditor:           'invoices',
  salesInvoiceReview:      'salesInvoiceApproval'
};
function activeMatch(itemPage, currentPage) {
  if (itemPage === currentPage) return true;
  return DRILL_PARENT[currentPage] === itemPage;
}

export default function Sidebar({ mobileOpen = false, onCloseMobile }) {
  const { page, appUser, navigate } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const role = appUser?.role || 'sales';
  const sections = sectionsForRole(role);

  const go = (target) => {
    navigate(target);
    if (onCloseMobile) onCloseMobile();
  };

  const openSettings = () => {
    setSettingsOpen(true);
    if (onCloseMobile) onCloseMobile();
  };

  const logout = () => {
    setSettingsOpen(false);
    navigate('login');
    if (onCloseMobile) onCloseMobile();
  };

  const username = appUser?.name || appUser?.email?.split('@')[0] || 'User';
  const initial  = (username || 'U').slice(0, 1).toUpperCase();

  // Width classes — controls both desktop (lg) and collapsed (md) behavior.
  // When `collapsed` is true we show icon-only regardless of breakpoint.
  const widthClass = collapsed ? 'w-16' : 'w-60';

  // Mobile drawer uses translate; desktop is always visible.
  const mobileClass = mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0';

  return (
    <>
      {/* Mobile backdrop — only visible when drawer is open */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-ink/40 backdrop-blur-sm md:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 transition-transform duration-200',
          mobileClass,
          widthClass
        ].join(' ')}
      >
        <GlassSurface
          as="nav"
          tint="strong"
          radius="panel"
          padding="p-0"
          className="h-full flex flex-col border-r border-line/60 rounded-none"
          aria-label="Primary"
        >
          {/* Brand + user — the top-row button is both "home" and a profile badge.
              Clicking the M brand glyph goes home; clicking the username chip
              opens the settings modal (where logout lives). */}
          <div className="px-3 py-4 flex items-center justify-between gap-2 border-b border-line/50">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => go(role === 'sales' ? 'salesDashboard'
                             : role === 'procurement' ? 'procurementDashboard'
                             : 'controllerDashboard')}
                className="inline-flex items-center justify-center h-8 w-8 rounded-card bg-primary text-white font-bold text-sm flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                title="Home — MIDSA"
                aria-label="Home"
              >
                M
              </button>
              {!collapsed && (
                <button
                  type="button"
                  onClick={openSettings}
                  title="Account & settings"
                  className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1 rounded-card hover:bg-surface-sunken text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="inline-flex items-center justify-center h-7 w-7 rounded-pill bg-primary-soft text-primary font-semibold text-xs flex-shrink-0">
                    {initial}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink truncate">{username}</span>
                    <span className="block text-[10px] text-ink-muted truncate capitalize">{role}</span>
                  </span>
                  <Icon id="ellipsis-vertical" className="text-ink-subtle text-xs" />
                </button>
              )}
            </div>
            {/* Collapse toggle — hidden on mobile drawer (where mobileOpen is true) */}
            <button
              type="button"
              onClick={() => setCollapsed(c => !c)}
              className="hidden md:inline-flex items-center justify-center h-7 w-7 rounded-card text-ink-muted hover:bg-surface-sunken flex-shrink-0"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand' : 'Collapse'}
            >
              <Icon id={collapsed ? 'chevron-right' : 'chevron-left'} />
            </button>
          </div>

          {/* Scrollable nav */}
          <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
            {sections.map((section, idx) => (
              <div key={section.title || `sec-${idx}`}>
                {section.title && !collapsed && (
                  <div className="px-2 mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-subtle">
                    {section.title}
                  </div>
                )}
                <ul className="space-y-0.5">
                  {section.items.map(item => {
                    const isActive = activeMatch(item.page, page);
                    return (
                      <li key={item.page}>
                        <button
                          type="button"
                          onClick={() => go(item.page)}
                          title={collapsed ? item.label : undefined}
                          className={[
                            'w-full flex items-center gap-3 px-3 py-2 rounded-card text-sm transition-colors',
                            isActive
                              ? 'bg-primary-soft text-primary font-medium'
                              : 'text-ink hover:bg-surface-sunken'
                          ].join(' ')}
                        >
                          <span className={[
                            'w-5 text-center flex-shrink-0',
                            isActive ? 'text-primary' : 'text-ink-muted'
                          ].join(' ')}>
                            <Icon id={item.icon} />
                          </span>
                          {!collapsed && <span className="truncate">{item.label}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          {/* Settings footer — single entry point for sound, haptics,
              theme, and logout. Replaces the old inline logout button so
              there's no dead-end when the user collapses the rail. */}
          <div className="border-t border-line/50 px-2 py-3">
            <button
              type="button"
              onClick={openSettings}
              title={collapsed ? 'Account & settings' : undefined}
              className={[
                'w-full flex items-center gap-3 px-3 py-2 rounded-card text-sm transition-colors',
                'text-ink hover:bg-surface-sunken'
              ].join(' ')}
            >
              <span className="w-5 text-center flex-shrink-0 text-ink-muted">
                <Icon id="sliders" />
              </span>
              {!collapsed && <span>Settings</span>}
            </button>
          </div>
        </GlassSurface>
      </aside>

      {/* Settings modal — mounted at the sidebar level so it's always
          available regardless of which page is active. */}
      <UserSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        appUser={appUser}
        onLogout={logout}
      />
    </>
  );
}
