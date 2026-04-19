/**
 * Cloud Function for Server-Side Quote Calculation
 * Implements industry-standard landed cost calculation with validation
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions');

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

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
