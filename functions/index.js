const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

const db = admin.firestore();
const bucket = admin.storage().bucket(); // default bucket

// Utility: safe parse ISO date (end inclusive)
const parseDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d;
};

// Helper: get payments sum for an invoice (optionally filter by payment date range)
const sumPayments = (invoice, startDate, endDate) => {
  let sum = 0;
  (invoice.payments || []).forEach(p => {
    if (!p || typeof p.amount !== 'number') return;
    if (startDate || endDate) {
      const pDate = p.date ? new Date(p.date) : null;
      if (pDate) {
        if (startDate && pDate < startDate) return;
        if (endDate && pDate > endDate) return;
      }
    }
    sum += p.amount;
  });
  return sum;
};

// Role check helper
const checkRole = (context, allowedRoles = []) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'User not authenticated');
  const claims = context.auth.token || {};
  const role = claims.role || claims.customRole || null;
  // you should set custom claims during auth provisioning: admin.auth().setCustomUserClaims(uid, { role: 'controller' })
  if (!allowedRoles.includes(role)) {
    throw new functions.https.HttpsError('permission-denied', 'User does not have permission to generate this report');
  }
  return role;
};

// Core callable function
exports.generateFullReport = functions.https.onCall(async (data, context) => {
  // SECURITY: Only controller or sales roles allowed
  const allowed = ['controller','sales'];
  checkRole(context, allowed);

  const appId = data.appId; // required
  const role = data.role || 'controller';
  const startDateIso = data.startDate || null;
  const endDateIso = data.endDate || null;
  const includeLegacy = !!data.includeLegacy; // boolean: include legacy in highlights if explicitly requested

  if (!appId) {
    throw new functions.https.HttpsError('invalid-argument', 'appId is required');
  }

  const startDate = parseDate(startDateIso);
  const endDate = parseDate(endDateIso);
  // Make endDate inclusive (midnight to end of day)
  if (endDate) endDate.setHours(23,59,59,999);

  const invoicesPath = `artifacts/${appId}/public/data/invoices`;
  const customersPath = `artifacts/${appId}/public/data/customers`;

  // Utility to page through invoices efficiently (for modest scale). For huge datasets use BigQuery.
  const invoiceDocs = [];
  try {
    // Query by date if start/end provided, else get all (with caution)
    let q = db.collection(invoicesPath).orderBy('date','desc').limit(1000);
    if (startDate && endDate) {
      q = db.collection(invoicesPath)
            .where('date', '>=', startDateIso)
            .where('date', '<=', endDateIso)
            .orderBy('date','desc');
    } else if (startDate && !endDate) {
      q = db.collection(invoicesPath)
            .where('date', '>=', startDateIso)
            .orderBy('date','desc');
    } else if (!startDate && endDate) {
      q = db.collection(invoicesPath)
            .where('date', '<=', endDateIso)
            .orderBy('date','desc');
    } // else full collection: limited to avoid OOM - you may want to require a date range

    const snapshot = await q.get();
    snapshot.forEach(doc => invoiceDocs.push({ id: doc.id, ...doc.data() }));
  } catch (err) {
    console.error("Invoice fetch error:", err);
    throw new functions.https.HttpsError('internal', 'Failed to read invoices');
  }

  // Metric containers
  const summary = {
    totalApprovedInvoicesCount: 0,
    totalApprovedInvoicesValue: 0,
    totalRecognizedRevenue: 0, // Approved+Paid excluding legacy unless includeLegacy true
    totalPaymentsReceived: 0,
    outstandingAR: 0,
    rejectedInvoiceCount: 0,
    rejectedInvoiceValue: 0,
    legacyOpeningBalanceCount: 0,
    legacyOpeningBalanceValue: 0
  };

  const invoicesByStatus = { Approved: [], Paid: [], Pending: [], Rejected: [], Other: [] };
  const paymentsLog = []; // every payment encountered within date range (if dates passed)
  const invoicesRows = []; // invoice-level details for a table
  const customersSet = new Set();

  // Iterate invoices
  invoiceDocs.forEach(inv => {
    const status = inv.status || 'Other';
    const isLegacy = !!inv.isLegacy;
    const total = typeof inv.total === 'number' ? inv.total : parseFloat(inv.total || 0);
    // categorize
    if (status === 'Rejected') {
      summary.rejectedInvoiceCount += 1;
      summary.rejectedInvoiceValue += total;
    }

    // For revenue recognition we count Approved or Paid and not legacy (unless includeLegacy)
    if ((status === 'Approved' || status === 'Paid') && (!isLegacy || includeLegacy)) {
      summary.totalApprovedInvoicesCount += 1;
      summary.totalApprovedInvoicesValue += total;
      // Recognized revenue: sum invoice totals (Approved/ Paid)
      summary.totalRecognizedRevenue += total;
    }

    // payments within date range (if start/end provided, use payment.date filter)
    (inv.payments || []).forEach(p => {
      const pAmount = typeof p.amount === 'number' ? p.amount : parseFloat(p.amount || 0);
      if (startDate || endDate) {
        const pDate = p.date ? new Date(p.date) : null;
        if (pDate) {
          if (startDate && pDate < startDate) return;
          if (endDate && pDate > endDate) return;
        }
      }
      // exclude payments tied to Rejected invoices? No: a payment on a rejected invoice is odd; we still surface it in paymentsLog for controller review.
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

    // outstanding per invoice (remaining)
    const paidSoFar = (inv.payments || []).reduce((s, p) => s + (parseFloat(p.amount || 0)), 0);
    const remaining = Math.max(0, total - paidSoFar);

    // Aging inclusion: include only Approved invoices (exclude Paid and Rejected)
    // We'll compute aging later when we have all Approved invoices
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

    // legacy opening balance bookkeeping
    if (isLegacy && inv.type === 'OpeningBalance') {
      summary.legacyOpeningBalanceCount += 1;
      summary.legacyOpeningBalanceValue += total;
    }

    // track customers for reconciliation fetch
    if (inv.customerId) customersSet.add(inv.customerId);

    // bucket by status
    if (invoicesByStatus[status]) invoicesByStatus[status].push(inv);
    else invoicesByStatus.Other.push(inv);
  });

  // Aging buckets (Approved only, exclude legacy)
  const now = new Date();
  const agingBuckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  invoicesRows.forEach(inv => {
    if (inv.status !== 'Approved') return;
    if (inv.isLegacy) return;
    const invoiceDate = inv.date ? new Date(inv.date) : null;
    if (!invoiceDate) return;
    const diffDays = Math.ceil((now - invoiceDate) / (1000*60*60*24));
    const rem = inv.remaining || 0;
    if (diffDays <= 30) agingBuckets['0-30'] += rem;
    else if (diffDays <= 60) agingBuckets['31-60'] += rem;
    else if (diffDays <= 90) agingBuckets['61-90'] += rem;
    else agingBuckets['90+'] += rem;
    summary.outstandingAR += rem;
  });

  // Reconciliation: fetch current customer outstanding balances and compare
  const customerIds = Array.from(customersSet);
  const customerRecon = [];
  if (customerIds.length > 0) {
    // batch-get customers
    const batchSize = 500;
    for (let i=0; i<customerIds.length; i += batchSize) {
      const chunk = customerIds.slice(i, i+batchSize);
      const refs = chunk.map(id => db.doc(`${customersPath}/${id}`));
      const snaps = await db.getAll(...refs);
      snaps.forEach((snap, idx) => {
        const id = chunk[idx];
        if (!snap.exists) {
          customerRecon.push({ customerId: id, storedOutstanding: null, computedOutstanding: null, mismatch: true, note: 'Customer doc missing' });
        } else {
          const cust = snap.data();
          const storedOutstanding = typeof cust.outstandingBalance === 'number' ? cust.outstandingBalance : parseFloat(cust.outstandingBalance || 0);
          // compute outstanding by summing remaining of invoicesRows for this customer excluding Rejected and legacy
          const computedOutstanding = invoicesRows
            .filter(r => r.customerId === id && r.status !== 'Rejected' && !r.isLegacy)
            .reduce((s, r) => s + (r.remaining || 0), 0);
          customerRecon.push({
            customerId: id,
            customerName: cust.name || null,
            storedOutstanding,
            computedOutstanding,
            mismatch: Math.abs((storedOutstanding || 0) - (computedOutstanding || 0)) > 0.01
          });
        }
      });
    }
  }

  // Prepare final object
  const report = {
    meta: {
      appId,
      roleRequested: role,
      generatedBy: context.auth ? context.auth.uid : 'system',
      generatedAt: new Date().toISOString(),
      startDate: startDateIso,
      endDate: endDateIso,
      includeLegacy
    },
    summary,
    agingBuckets,
    paymentsLog,
    invoices: invoicesRows,
    customerReconciliation: customerRecon
  };

  // Optionally cache the report in Firestore for quick retrieval
  try {
    const reportsCol = `artifacts/${appId}/public/data/reports`;
    const reportId = `report-${role}-${Date.now()}`;
    await db.collection(reportsCol).doc(reportId).set({
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: context.auth ? context.auth.uid : 'system',
      params: { role, startDateIso, endDateIso, includeLegacy },
      report
    });
    report.meta.cachedReportId = reportId;
  } catch (err) {
    console.warn('Report caching failed:', err.message);
  }

  return report;
});

// OPTIONAL: HTTP endpoint to request CSV export for a previously cached reportId (or generate inline)
// Example: POST /exportReportCsv { appId, reportId } -> returns signed URL to CSV in Storage
exports.exportReportCsv = functions.https.onRequest(async (req, res) => {
  // Add CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    if (req.method !== 'POST') return res.status(405).send('POST only');
    const { appId, reportId } = req.body;
    if (!appId || !reportId) return res.status(400).send('appId and reportId required');

    // Fetch cached report
    const repDoc = await db.doc(`artifacts/${appId}/public/data/reports/${reportId}`).get();
    if (!repDoc.exists) return res.status(404).send('Report not found');
    const report = repDoc.data().report;

    // convert to CSV (simple flattened invoice table + header)
    const rows = [];
    rows.push(['Invoice ID','Customer ID','Customer','Date','DueDate','Total','Paid','Remaining','Status','isLegacy'].join(','));
    (report.invoices || []).forEach(inv => {
      const row = [
        `"${(inv.id||'')}"`,
        `"${(inv.customerId||'')}"`,
        `"${(inv.customerName||'')}"`,
        `"${(inv.date||'')}"`,
        `"${(inv.dueDate||'')}"`,
        `${inv.total||0}`,
        `${inv.paidSoFar||0}`,
        `${inv.remaining||0}`,
        `"${(inv.status||'')}"`,
        `${inv.isLegacy ? 'true' : 'false'}`
      ].join(',');
      rows.push(row);
    });
    const csv = rows.join('\n');

    // store CSV into Cloud Storage under reports/<appId>/<reportId>.csv
    const filePath = `reports/${appId}/${reportId}.csv`;
    const file = bucket.file(filePath);
    await file.save(csv, { contentType: 'text/csv' });

    // make signed URL (valid 1 hour)
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const [url] = await file.getSignedUrl({ action: 'read', expires: expiresAt });
    return res.json({ url });
  } catch (err) {
    console.error('exportReportCsv error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ===== QUOTE CALCULATION FUNCTIONS =====

/**
 * Fetch inventory items in batch
 */
async function fetchInventoryBatch(appId, skus) {
  const inventoryRef = db.collection(`artifacts/${appId}/public/data/inventory`);
  const inventoryMap = {};
  
  // Fetch in batches to avoid Firestore limits
  const batchSize = 10;
  for (let i = 0; i < skus.length; i += batchSize) {
    const batch = skus.slice(i, i + batchSize);
    const promises = batch.map(sku => inventoryRef.doc(sku).get());
    const snaps = await Promise.all(promises);
    
    snaps.forEach((snap, index) => {
      if (snap.exists) {
        inventoryMap[batch[index]] = snap.data();
      }
    });
  }
  
  return inventoryMap;
}

/**
 * Get pricing settings
 */
async function getPricingSettings(appId) {
  const settingsRef = db.collection(`artifacts/${appId}/public/data/settings`).doc('pricing');
  const settingsSnap = await settingsRef.get();
  
  if (!settingsSnap.exists) {
    // Return default settings
    return {
      defaultMarkupPercent: 32,
      pricingMode: 'markup',
      allocationMethod: 'weight',
      roundingDecimals: 2,
      defaultIncoterm: 'FOB',
      defaultCurrency: 'GHS',
      defaultQuoteExpiryDays: 30,
      approvalThresholds: {
        minMarginPercent: 15,
        maxDiscountPercent: 20,
        requireApprovalAbove: 10000
      },
      taxRules: {
        defaultRate: 0.12
      }
    };
  }
  
  return settingsSnap.data();
}

/**
 * Allocate order-level charges to line items
 */
function allocateOrderCharges(lineItems, orderCharges, method = 'weight') {
  const allocations = {};
  
  if (!orderCharges || !orderCharges.shipping || orderCharges.shipping <= 0) {
    return allocations;
  }
  
  let totalKey = 0;
  const keys = lineItems.map(li => {
    let key;
    switch (method) {
      case 'weight':
        key = li.quantity * (li.weightKg || 1);
        break;
      case 'value':
        key = li.quantity * (li.unitCost || 0);
        break;
      case 'equal':
      default:
        key = li.quantity;
        break;
    }
    totalKey += key;
    return key;
  });
  
  lineItems.forEach((li, index) => {
    if (totalKey > 0) {
      allocations[li.sku] = (keys[index] / totalKey) * orderCharges.shipping;
    } else {
      allocations[li.sku] = orderCharges.shipping / lineItems.length;
    }
  });
  
  return allocations;
}

/**
 * Round number to specified decimal places
 */
function round(number, decimals = 2) {
  return Number(Number(number).toFixed(decimals));
}

/**
 * Calculate individual item prices
 */
function calculateItemPrices(lineItems, allocations, settings) {
  const rounding = settings.roundingDecimals || 2;
  
  return lineItems.map(li => {
    // Calculate landed cost per unit
    const allocShippingPerUnit = (allocations[li.sku] || 0) / Math.max(li.quantity, 1);
    const cb = li.costComponents || {};
    
    const unitLandedCost = 
      (li.unitCost || 0) +
      (cb.inboundFreightPerUnit || 0) +
      (cb.dutyPerUnit || 0) +
      (cb.insurancePerUnit || 0) +
      (cb.packagingPerUnit || 0) +
      (cb.otherPerUnit || 0) +
      allocShippingPerUnit;
    
    // Determine markup/margin
    const markupPercent = li.markupOverridePercent !== null 
      ? li.markupOverridePercent 
      : settings.defaultMarkupPercent || 0;
    
    // Calculate unit price
    let unitPrice;
    if (settings.pricingMode === 'margin') {
      const margin = (settings.defaultMarginPercent || 0) / 100;
      unitPrice = unitLandedCost / (1 - margin);
    } else {
      // Default to markup
      unitPrice = unitLandedCost * (1 + (markupPercent / 100));
    }
    
    // Round values
    const roundedLandedCost = round(unitLandedCost, rounding);
    const roundedUnitPrice = round(unitPrice, rounding);
    const lineTotal = round(roundedUnitPrice * li.quantity, rounding);
    
    return {
      ...li,
      unitLandedCost: roundedLandedCost,
      markupPercent,
      pricingMode: settings.pricingMode,
      unitPrice: roundedUnitPrice,
      lineTotal
    };
  });
}

/**
 * Calculate order totals
 */
function calculateTotals(lineItems, orderCharges, customerId, settings) {
  const rounding = settings.roundingDecimals || 2;
  
  // Calculate subtotal
  const subTotal = lineItems.reduce((sum, li) => sum + li.lineTotal, 0);
  
  // Calculate total landed cost for margin
  const totalLandedCost = lineItems.reduce((sum, li) => 
    sum + (li.unitLandedCost * li.quantity), 0);
  
  // Calculate order-level charges
  const shipping = orderCharges?.shipping || 0;
  const handling = orderCharges?.handling || 0;
  const orderDiscount = orderCharges?.orderDiscount || 0;
  
  // Calculate tax
  const taxRate = settings.taxRules?.defaultRate || 0.12;
  const taxableAmount = subTotal + shipping + handling - orderDiscount;
  const tax = round(taxableAmount * taxRate, rounding);
  
  // Calculate final total
  const total = round(subTotal + shipping + handling + tax - orderDiscount, rounding);
  
  // Calculate gross margin percentage
  const grossMarginPercent = round(
    ((subTotal - totalLandedCost) / Math.max(subTotal, 1)) * 100, 
    2
  );
  
  return {
    subTotal: round(subTotal, rounding),
    shipping: round(shipping, rounding),
    handling: round(handling, rounding),
    tax: round(tax, rounding),
    orderDiscount: round(orderDiscount, rounding),
    total: round(total, rounding),
    grossMarginPercent
  };
}

/**
 * Main quote calculation function
 */
exports.calculateQuotePrice = functions.https.onCall(async (data, context) => {
  try {
    // Validate authentication
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    
    const { quoteDraft, appId } = data;
    
    if (!quoteDraft || !appId) {
      throw new functions.https.HttpsError('invalid-argument', 'quoteDraft and appId are required');
    }
    
    // 1. Fetch pricing settings
    const pricingSettings = await getPricingSettings(appId);
    
    // 2. Validate and enrich line items with inventory data
    const skus = [...new Set(quoteDraft.lineItems.map(li => li.sku))];
    const inventoryMap = await fetchInventoryBatch(appId, skus);
    
    const enrichedLineItems = quoteDraft.lineItems.map(li => {
      const inventory = inventoryMap[li.sku];
      if (!inventory) {
        throw new functions.https.HttpsError('not-found', `SKU not found: ${li.sku}`);
      }
      
      return {
        ...li,
        description: inventory.name,
        unitCost: inventory.unitCost || 0,
        weightKg: inventory.weightKg || 0,
        costComponents: inventory.costComponents || {},
        markupOverridePercent: inventory.markupOverridePercent,
        pricingTier: inventory.pricingTier || 'standard'
      };
    });
    
    // 3. Allocate order-level charges
    const allocations = allocateOrderCharges(
      enrichedLineItems, 
      quoteDraft.orderLevelCharges, 
      pricingSettings.allocationMethod
    );
    
    // 4. Calculate landed costs and prices
    const calculatedItems = calculateItemPrices(
      enrichedLineItems, 
      allocations, 
      pricingSettings
    );
    
    // 5. Calculate totals
    const totals = calculateTotals(
      calculatedItems, 
      quoteDraft.orderLevelCharges, 
      quoteDraft.customerId,
      pricingSettings
    );
    
    // 6. Build final quote object
    const computedQuote = {
      ...quoteDraft,
      lineItems: calculatedItems,
      totals,
      audit: {
        computedBy: 'quoteCalc_v2.0',
        computedAt: new Date().toISOString(),
        validated: true,
        computedByUser: context.auth.uid
      }
    };
    
    return {
      success: true,
      quote: computedQuote
    };
    
  } catch (error) {
    console.error('Quote calculation error:', error);
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    
    throw new functions.https.HttpsError('internal', `Quote calculation failed: ${error.message}`);
  }
});

/**
 * Save quote to Firestore
 */
exports.saveQuote = functions.https.onCall(async (data, context) => {
  try {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    
    const { quote, appId } = data;
    
    if (!quote || !appId) {
      throw new functions.https.HttpsError('invalid-argument', 'quote and appId are required');
    }
    
    // Validate quote
    if (!quote.customerId) {
      throw new functions.https.HttpsError('invalid-argument', 'Customer ID is required');
    }
    
    if (!quote.lineItems || quote.lineItems.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'At least one line item is required');
    }
    
    // Save quote
    const quoteRef = db.collection(`artifacts/${appId}/public/data/quotes`).doc(quote.id);
    await quoteRef.set(quote);
    
    return {
      success: true,
      quoteId: quote.id
    };
    
  } catch (error) {
    console.error('Save quote error:', error);
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    
    throw new functions.https.HttpsError('internal', `Save quote failed: ${error.message}`);
  }
});

/**
 * Convert quote to invoice
 */
exports.convertQuoteToInvoice = functions.https.onCall(async (data, context) => {
  try {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    
    const { quoteId, appId } = data;
    
    if (!quoteId || !appId) {
      throw new functions.https.HttpsError('invalid-argument', 'quoteId and appId are required');
    }
    
    // Get quote
    const quoteRef = db.collection(`artifacts/${appId}/public/data/quotes`).doc(quoteId);
    const quoteSnap = await quoteRef.get();
    
    if (!quoteSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Quote not found');
    }
    
    const quote = quoteSnap.data();
    
    if (quote.status !== 'ACCEPTED') {
      throw new functions.https.HttpsError('failed-precondition', 'Only accepted quotes can be converted to invoices');
    }
    
    // Create invoice with exact quote values
    const invoiceId = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;
    const invoiceData = {
      id: invoiceId,
      salespersonId: quote.createdBy,
      customerId: quote.customerId,
      customerName: quote.customerName,
      date: new Date().toISOString().split('T')[0],
      lineItems: quote.lineItems.map(li => ({
        id: li.sku,
        name: li.description,
        quantity: li.quantity,
        price: li.unitPrice
      })),
      total: quote.totals.total,
      taxes: quote.totals.tax,
      status: 'Pending Approval',
      payments: [],
      convertedFromQuoteId: quoteId,
      conversionDate: new Date().toISOString()
    };
    
    const invoiceRef = db.collection(`artifacts/${appId}/public/data/invoices`).doc(invoiceId);
    await invoiceRef.set(invoiceData);
    
    // Update quote status
    await quoteRef.update({ 
      status: 'CONVERTED',
      convertedToInvoiceId: invoiceId,
      conversionDate: new Date().toISOString()
    });
    
    return {
      success: true,
      invoiceId,
      invoice: invoiceData
    };
    
  } catch (error) {
    console.error('Convert quote error:', error);
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    
    throw new functions.https.HttpsError('internal', `Convert quote failed: ${error.message}`);
  }
});

/**
 * Update inventory with cost components
 */
exports.updateInventoryCosts = functions.https.onCall(async (data, context) => {
  try {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    
    const { sku, costData, appId } = data;
    
    if (!sku || !costData || !appId) {
      throw new functions.https.HttpsError('invalid-argument', 'sku, costData, and appId are required');
    }
    
    // Update inventory item
    const inventoryRef = db.collection(`artifacts/${appId}/public/data/inventory`).doc(sku);
    await inventoryRef.update({
      ...costData,
      updatedAt: new Date().toISOString(),
      updatedBy: context.auth.uid
    });
    
    return {
      success: true,
      sku
    };
    
  } catch (error) {
    console.error('Update inventory costs error:', error);
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    
    throw new functions.https.HttpsError('internal', `Update inventory costs failed: ${error.message}`);
  }
});

/**
 * Update pricing settings
 */
exports.updatePricingSettings = functions.https.onCall(async (data, context) => {
  try {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    
    const { settings, appId } = data;
    
    if (!settings || !appId) {
      throw new functions.https.HttpsError('invalid-argument', 'settings and appId are required');
    }
    
    // Update pricing settings
    const settingsRef = db.collection(`artifacts/${appId}/public/data/settings`).doc('pricing');
    await settingsRef.set({
      ...settings,
      updatedAt: new Date().toISOString(),
      updatedBy: context.auth.uid
    }, { merge: true });
    
    return {
      success: true
    };
    
  } catch (error) {
    console.error('Update pricing settings error:', error);
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    
    throw new functions.https.HttpsError('internal', `Update pricing settings failed: ${error.message}`);
  }
}); 