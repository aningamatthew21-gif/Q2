import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, FilePlus, Files, UserCheck, CheckCheck,
  ClipboardList, FileText, Factory, Boxes, Users, Tags,
  History, Sliders, X, ShieldCheck, Wallet, PackageCheck, BarChart3,
  AlertOctagon,
  Hash
} from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '../../context/AppContext';
import { navTap, TRANSITION_FAST } from './motion';
import { canOpenPage, legacyRoleToTiered, ROLES } from '../../utils/permissions';

/**
 * LeftNav — flat Fluent 2 navigation rail.
 *
 * - Persistent on md+, drawer on sm.
 * - Active item gets accent left-border + soft background.
 * - The active indicator slides between items via framer-motion's
 *   `layoutId` so swapping pages animates the bar instead of flashing.
 * - Section labels are uppercase, dimmed; they collapse out of view in
 *   dense / collapsed mode (future).
 *
 * Section content mirrors v1 Sidebar.jsx so the same role map drives both
 * during the migration. Keeping a copy here avoids importing the v1
 * Sidebar (which we'll delete at the end).
 */

const ROLE_SECTIONS = {
  sales: [
    { items: [
      { page: 'salesDashboard',       label: 'Dashboard',     icon: LayoutDashboard },
      { page: 'quoting',              label: 'New Quote',     icon: FilePlus       },
      { page: 'myInvoices',           label: 'Invoices',      icon: UserCheck      },
      { page: 'salesInvoiceApproval', label: 'Approvals',     icon: CheckCheck     },
      { page: 'salesPriceList',       label: 'Price List',    icon: Tags           },
      // Module 2 — sales head sees Collections (perm-gated below; officers
      // without customer.statement.read are filtered out automatically).
      { page: 'collectionsWorkbench', label: 'Collections',   icon: Wallet         },
      // Module 5 — Reports hub (hub itself filters columns by perm)
      { page: 'reportsHub',           label: 'Reports',       icon: BarChart3      },
      { page: 'mySignatures',         label: 'My Signatures', icon: FileText       },
      { page: 'auditTrail',           label: 'Audit',         icon: History        }
    ]}
  ],
  controller: [
    { title: 'Workspace', items: [
      { page: 'controllerDashboard', label: 'Dashboard',     icon: LayoutDashboard },
      { page: 'salesDashboard',      label: 'Sales',         icon: LayoutDashboard }
    ]},
    { title: 'Invoices', items: [
      { page: 'invoices',             label: 'All invoices',   icon: Files          },
      { page: 'myInvoices',           label: 'Invoice workspace', icon: UserCheck   },
      { page: 'salesInvoiceApproval', label: 'Approvals',      icon: CheckCheck     },
      { page: 'quoting',              label: 'New Quote',      icon: FilePlus       },
      // Module 2 — Collections workbench
      { page: 'collectionsWorkbench', label: 'Collections',    icon: Wallet         }
    ]},
    { title: 'Procurement', items: [
      { page: 'procurementDashboard',label: 'Dashboard',     icon: LayoutDashboard },
      { page: 'purchaseRequisitions',label: 'Requisitions',  icon: ClipboardList  },
      { page: 'rfqList',             label: 'RFQs',          icon: FileText       },
      { page: 'goodsReceipts',       label: 'Goods Receipts',icon: PackageCheck   },
      { page: 'vendors',             label: 'Vendors',       icon: Factory        },
      { page: 'vendorScorecard',     label: 'Vendor Scorecards', icon: BarChart3  }
    ]},
    { title: 'Catalogue', items: [
      { page: 'inventory',           label: 'Inventory',     icon: Boxes          },
      { page: 'pricingManagement',   label: 'Pricing',       icon: Tags           },
      { page: 'customers',           label: 'Customers',     icon: Users          }
    ]},
    // Module 5 — Reports hub. Finance head holds all 3 reports.run.*
    // actions so the hub renders all three department columns. The
    // hub filters per-user automatically.
    { title: 'Reports', items: [
      { page: 'reportsHub',          label: 'All Reports',   icon: BarChart3      }
    ]},
    { title: 'System', items: [
      { page: 'taxSettings',         label: 'Tax',           icon: Sliders        },
      { page: 'procurementSettings', label: 'Procurement',   icon: Sliders        },
      { page: 'mySignatures',        label: 'My Signatures', icon: FileText       },
      { page: 'auditTrail',          label: 'Audit',         icon: History        },
      { page: 'userManagement',      label: 'Users',         icon: ShieldCheck    },
      // EH — admin Error Monitor (auto-hidden for non-admins by canOpenPage filter)
      { page: 'errorMonitor',        label: 'Error Monitor', icon: AlertOctagon   },
      // Document numbering policy (admin + finance_head; gated by canOpenPage)
      { page: 'numberingSettings',   label: 'Numbering',     icon: Hash           }
    ]}
  ],
  procurement: [
    { items: [
      { page: 'procurementDashboard',label: 'Dashboard',         icon: LayoutDashboard },
      { page: 'purchaseRequisitions',label: 'Requisitions',      icon: ClipboardList  },
      { page: 'rfqList',             label: 'RFQs',              icon: FileText       },
      // Module 3 — Goods Receipts list (officer + head) + Vendor Scorecards (head only via perm gate)
      { page: 'goodsReceipts',       label: 'Goods Receipts',    icon: PackageCheck   },
      { page: 'vendors',             label: 'Vendors',           icon: Factory        },
      { page: 'vendorScorecard',     label: 'Vendor Scorecards', icon: BarChart3      },
      // Module 5 — Reports hub (procurement officer/head see procurement reports)
      { page: 'reportsHub',          label: 'Reports',           icon: BarChart3      },
      { page: 'mySignatures',        label: 'My Signatures',     icon: FileText       },
      { page: 'auditTrail',          label: 'Audit',             icon: History        }
    ]}
  ]
};

/* Drill-down children inherit the parent item's active state so the rail
   doesn't visually "lose you" on detail pages. */
const DRILL_PARENT = {
  rfqBuilder:                'rfqList',
  rfqDetail:                 'rfqList',
  purchaseRequisitionDetail: 'purchaseRequisitions',
  invoiceEditor:             'invoices',
  salesInvoiceReview:        'salesInvoiceApproval',
  // Module 2 — viewing a per-customer statement keeps Collections lit.
  customerStatement:         'collectionsWorkbench',
  // Module 3 — no detail drill-downs yet; receipts open in modal,
  // scorecards are single-page.
  // Module 5 — every individual report page keeps "Reports" lit in the rail.
  reportArAging:                'reportsHub',
  reportDsoTrend:               'reportsHub',
  reportCashCollections:        'reportsHub',
  reportSalesRegister:          'reportsHub',
  reportVatCompliance:          'reportsHub',
  reportWhtCollected:           'reportsHub',
  reportCustomerProfitability:  'reportsHub',
  reportBadDebtProvision:       'reportsHub',
  reportSalesPipeline:          'reportsHub',
  reportQuoteConversion:        'reportsHub',
  reportRevenueVsTarget:        'reportsHub',
  reportSalesLeaderboard:       'reportsHub',
  reportQuoteAging:             'reportsHub',
  reportWinLoss:                'reportsHub',
  reportTopCustomers:           'reportsHub',
  reportTopProducts:            'reportsHub',
  reportPrBacklog:              'reportsHub',
  reportRfqCycleTime:           'reportsHub',
  reportRfqsAttention:          'reportsHub',
  reportSpendByVendor:          'reportsHub',
  reportSpendByCategory:        'reportsHub',
  reportOverrideAudit:          'reportsHub',
  reportLeadTimeAccuracy:       'reportsHub',
  reportPrCancellation:         'reportsHub'
};

// Pick the visible section layout for the user. We honour BOTH the legacy
// role names AND the new tiered roles so the rail keeps working through the
// rollout. Section content is shared across tiers within a department (an
// officer and a head see the same items — the difference is the *actions*
// available inside each page, not the page list itself).
function sectionsForRole(role) {
  const tiered = isTiered(role) ? role : legacyRoleToTiered(role);
  switch (tiered) {
    case ROLES.ADMIN:
    case ROLES.FINANCE_HEAD:
    case ROLES.FINANCE_OFFICER:
      return ROLE_SECTIONS.controller;
    case ROLES.PROCUREMENT_HEAD:
    case ROLES.PROCUREMENT_OFFICER:
      return ROLE_SECTIONS.procurement;
    default:
      return ROLE_SECTIONS.sales;
  }
}
function isTiered(r) {
  return Object.values(ROLES).indexOf(r) >= 0;
}
function activeMatch(itemPage, currentPage) {
  if (itemPage === currentPage) return true;
  return DRILL_PARENT[currentPage] === itemPage;
}

export default function LeftNav({ mobileOpen = false, onCloseMobile }) {
  const { page, appUser, navigate } = useApp();
  const role = appUser?.role || 'sales';

  // Filter each section's items by the new permission catalogue, then drop
  // sections that become empty. An officer and a head of the same department
  // see the same SECTION layout, but only items they can actually open are
  // rendered. This is purely visual — server-side requirePermission is the
  // load-bearing gate.
  const sections = sectionsForRole(role)
    .map(section => ({ ...section, items: section.items.filter(it => canOpenPage(role, it.page)) }))
    .filter(section => section.items.length > 0);

  const go = (target) => {
    navigate(target);
    onCloseMobile?.();
  };

  return (
    <>
      {/* Mobile backdrop */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="fixed inset-0 z-40 bg-n-900/40 md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onCloseMobile}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      <aside
        className={clsx(
          'fixed md:sticky md:top-12 inset-y-0 left-0 z-40 w-56',
          'bg-white border-r border-n-200',
          'md:translate-x-0 transition-transform duration-200',
          'flex flex-col',
          'h-[calc(100vh)] md:h-[calc(100vh-3rem)]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        aria-label="Primary"
      >
        {/* Mobile-only close button */}
        <div className="md:hidden flex items-center justify-between px-3 h-12 border-b border-n-200">
          <span className="font-semibold text-n-800">MIDSA</span>
          <button
            type="button"
            onClick={onCloseMobile}
            className="w-8 h-8 grid place-items-center rounded-md hover:bg-n-100"
            aria-label="Close navigation"
          >
            <X className="w-4 h-4 text-n-600" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {sections.map((section, idx) => (
            <div key={section.title || `sec-${idx}`} className="mb-1">
              {section.title && (
                <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-n-500">
                  {section.title}
                </div>
              )}
              <ul role="list">
                {section.items.map(item => {
                  const isActive = activeMatch(item.page, page);
                  const Icon = item.icon;
                  return (
                    <li key={item.page} className="relative">
                      {isActive && (
                        <motion.span
                          layoutId="leftnav-active-bar"
                          className="absolute left-0 top-1 bottom-1 w-[3px] bg-accent rounded-r"
                          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                          aria-hidden
                        />
                      )}
                      <motion.button
                        type="button"
                        onClick={() => go(item.page)}
                        whileTap={navTap}
                        transition={TRANSITION_FAST}
                        className={clsx(
                          'w-full flex items-center gap-2.5 pl-4 pr-3 py-1.5 text-[13px] text-left',
                          'transition-colors',
                          isActive
                            ? 'bg-accent-soft text-accent-text font-semibold'
                            : 'text-n-700 hover:bg-n-50'
                        )}
                      >
                        <Icon className={clsx(
                          'w-4 h-4 flex-shrink-0',
                          isActive ? 'text-accent' : 'text-n-500'
                        )} />
                        <span className="truncate">{item.label}</span>
                      </motion.button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
