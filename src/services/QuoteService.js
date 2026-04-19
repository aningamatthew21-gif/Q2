/**
 * Enhanced Quote Service with Industry Best Practices
 * Implements landed cost calculation, markup/margin logic, and proper quote lifecycle
 */

import api from '../api';

/**
 * Quote Data Model - Industry Standard Structure
 */
export const QUOTE_SCHEMA = {
  // Quote identification
  id: 'string', // Q-2025-000123
  status: 'string', // DRAFT | SENT | ACCEPTED | EXPIRED | CANCELLED
  createdBy: 'string', // userId
  customerId: 'string',
  customerName: 'string',

  // Quote metadata
  date: 'string', // ISO date
  expiresAt: 'string', // ISO date
  incoterm: 'string', // EXW, FOB, CIF, DDP, etc.
  currency: 'string', // GHS, USD, etc.

  // Line items with cost breakdown
  lineItems: [
    {
      sku: 'string',
      description: 'string',
      quantity: 'number',

      // Cost components (snapshot at quote time)
      unitCost: 'number', // Base COGS
      costBreakdown: {
        inboundFreight: 'number',
        duty: 'number',
        insurance: 'number',
        packaging: 'number',
        other: 'number'
      },

      // Calculated values
      unitLandedCost: 'number', // unitCost + all cost components
      markupPercent: 'number', // Applied markup
      pricingMode: 'string', // 'markup' or 'margin'
      unitPrice: 'number', // Final customer price
      lineTotal: 'number' // unitPrice * quantity
    }
  ],

  // Order-level charges
  orderLevelCharges: {
    shipping: 'number',
    insurance: 'number',
    handling: 'number',
    orderDiscount: 'number'
  },

  // Calculated totals
  totals: {
    subTotal: 'number',
    shipping: 'number',
    tax: 'number',
    total: 'number',
    grossMarginPercent: 'number'
  },

  // Additional fields
  notes: 'string',
  terms: 'string',

  // Audit trail
  audit: {
    computedBy: 'string',
    computedAt: 'string',
    validated: 'boolean',
    history: [
      {
        when: 'string',
        who: 'string',
        change: 'string',
        reason: 'string'
      }
    ]
  }
};

/**
 * Extended Inventory Schema with Cost Components
 */
export const INVENTORY_SCHEMA_EXTENDED = {
  // Existing fields
  id: 'string',
  name: 'string',
  vendor: 'string',
  stock: 'number',
  price: 'number', // Legacy field - will be calculated
  restockLimit: 'number',

  // New cost component fields
  unitCost: 'number', // Base COGS (required)
  weightKg: 'number', // For allocation calculations
  dimensions: {
    length: 'number',
    width: 'number',
    height: 'number'
  },

  // Cost breakdown per unit
  costComponents: {
    inboundFreightPerUnit: 'number',
    dutyPerUnit: 'number',
    insurancePerUnit: 'number',
    packagingPerUnit: 'number',
    otherPerUnit: 'number'
  },

  // Pricing overrides
  markupOverridePercent: 'number', // Optional per-item markup
  pricingTier: 'string', // standard, premium, budget

  // Metadata
  updatedAt: 'string',
  updatedBy: 'string'
};

/**
 * Global Pricing Settings Schema
 */
export const PRICING_SETTINGS_SCHEMA = {
  id: 'pricing',

  // Default pricing rules
  defaultMarkupPercent: 'number',
  defaultMarginPercent: 'number',
  pricingMode: 'string', // 'markup' or 'margin'

  // Allocation methods
  allocationMethod: 'string', // 'weight' | 'value' | 'equal'
  roundingDecimals: 'number',

  // Default terms
  defaultIncoterm: 'string',
  defaultCurrency: 'string',
  defaultQuoteExpiryDays: 'number',

  // Approval thresholds
  approvalThresholds: {
    minMarginPercent: 'number',
    maxDiscountPercent: 'number',
    requireApprovalAbove: 'number' // Order value threshold
  },

  // Tax rules
  taxRules: {
    defaultRate: 'number',
    countryRates: 'object'
  }
};

/**
 * Core Quote Calculation Engine
 */
export class QuoteCalculator {
  constructor() {
    // No longer needs db/appId as api handles it
  }

  /**
   * Main quote calculation function
   * Implements industry-standard landed cost calculation
   */
  async calculateQuotePrice(quoteDraft, settings = {}) {
    try {
      // 1. Fetch pricing settings
      const pricingSettings = await this.getPricingSettings();

      // 2. Validate and enrich line items with inventory data
      const enrichedLineItems = await this.enrichLineItems(quoteDraft.lineItems);

      // 3. Allocate order-level charges
      const allocations = this.allocateOrderCharges(
        enrichedLineItems,
        quoteDraft.orderLevelCharges,
        pricingSettings.allocationMethod
      );

      // 4. Calculate landed costs and prices
      const calculatedItems = this.calculateItemPrices(
        enrichedLineItems,
        allocations,
        pricingSettings
      );

      // 5. Calculate totals
      const totals = this.calculateTotals(
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
          validated: true
        }
      };

      return computedQuote;

    } catch (error) {
      console.error('Quote calculation error:', error);
      throw new Error(`Quote calculation failed: ${error.message}`);
    }
  }

  /**
   * Fetch pricing settings from Firestore
   */
  async getPricingSettings() {
    try {
      const response = await api.get('/settings/pricing');
      if (response.success && response.data) {
        return response.data;
      }
    } catch (err) {
      console.warn('Could not fetch pricing settings, using defaults:', err);
    }

    // Return default settings if none exist
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

  /**
   * Enrich line items with inventory cost data
   */
  async enrichLineItems(lineItems) {
    const skus = [...new Set(lineItems.map(li => li.sku))];
    const inventoryMap = await this.fetchInventoryBatch(skus);

    return lineItems.map(li => {
      const inventory = inventoryMap[li.sku];
      if (!inventory) {
        throw new Error(`SKU not found in inventory: ${li.sku}`);
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
  }

  /**
   * Fetch multiple inventory items efficiently
   */
  async fetchInventoryBatch(skus) {
    const inventoryMap = {};

    // Fetch each item from Oracle API
    const promises = skus.map(sku => api.get(`/inventory/${sku}`));
    const results = await Promise.all(promises);

    results.forEach((res, index) => {
      if (res.success && res.data) {
        inventoryMap[skus[index]] = res.data;
      }
    });

    return inventoryMap;
  }

  /**
   * Allocate order-level charges to line items
   */
  allocateOrderCharges(lineItems, orderCharges, method = 'weight') {
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
   * Calculate individual item prices using landed cost logic
   */
  calculateItemPrices(lineItems, allocations, settings) {
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
      const roundedLandedCost = this.round(unitLandedCost, rounding);
      const roundedUnitPrice = this.round(unitPrice, rounding);
      const lineTotal = this.round(roundedUnitPrice * li.quantity, rounding);

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
   * Calculate order totals and margins
   */
  calculateTotals(lineItems, orderCharges, customerId, settings) {
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

    // Calculate tax (simplified - can be enhanced with tax service)
    const taxRate = this.getTaxRate(customerId, settings);
    const taxableAmount = subTotal + shipping + handling - orderDiscount;
    const tax = this.round(taxableAmount * taxRate, rounding);

    // Calculate final total
    const total = this.round(subTotal + shipping + handling + tax - orderDiscount, rounding);

    // Calculate gross margin percentage
    const grossMarginPercent = this.round(
      ((subTotal - totalLandedCost) / Math.max(subTotal, 1)) * 100,
      2
    );

    return {
      subTotal: this.round(subTotal, rounding),
      shipping: this.round(shipping, rounding),
      handling: this.round(handling, rounding),
      tax: this.round(tax, rounding),
      orderDiscount: this.round(orderDiscount, rounding),
      total: this.round(total, rounding),
      grossMarginPercent
    };
  }

  /**
   * Get tax rate for customer (simplified implementation)
   */
  getTaxRate(customerId, settings) {
    // This can be enhanced to fetch customer-specific tax rates
    // For now, return default rate
    return settings.taxRules?.defaultRate || 0.12;
  }

  /**
   * Round number to specified decimal places
   */
  round(number, decimals = 2) {
    return Number(Number(number).toFixed(decimals));
  }

  /**
   * Validate quote before saving
   */
  validateQuote(quote) {
    const errors = [];

    if (!quote.customerId) errors.push('Customer ID is required');
    if (!quote.lineItems || quote.lineItems.length === 0) errors.push('At least one line item is required');

    quote.lineItems.forEach((li, index) => {
      if (!li.sku) errors.push(`Line item ${index + 1}: SKU is required`);
      if (!li.quantity || li.quantity <= 0) errors.push(`Line item ${index + 1}: Valid quantity is required`);
      if (li.unitPrice <= 0) errors.push(`Line item ${index + 1}: Unit price must be positive`);
    });

    if (errors.length > 0) {
      throw new Error(`Quote validation failed: ${errors.join(', ')}`);
    }

    return true;
  }

  /**
   * Approve or Reject an invoice
   */
  async approveInvoice(invoiceId, approvalData, userId) {
    const { status, signature } = approvalData;
    
    const updates = {
      status: status,
      signatureData: JSON.stringify(signature || null)
    };

    const response = await api.put(`/invoices/${invoiceId}`, updates);
    if (!response.success) {
      throw new Error(response.error || `Failed to ${status.toLowerCase()} invoice`);
    }
    return response;
  }

  /**
   * Save quote to Firestore
   */
  async saveQuote(quote) {
    this.validateQuote(quote);
    const response = await api.post('/quotes', quote);
    if (!response.success) {
      throw new Error(response.error || 'Failed to save quote');
    }
    return quote;
  }

  /**
   * Convert accepted quote to invoice
   */
  async convertQuoteToInvoice(quoteId) {
    const res = await api.get(`/quotes/${quoteId}`);
    if (!res.success) {
      throw new Error('Quote not found');
    }

    const quote = res.data;
    if (quote.status !== 'ACCEPTED') {
      throw new Error('Only accepted quotes can be converted to invoices');
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

    await api.post('/invoices', invoiceData);

    // Update quote status
    await api.put(`/quotes/${quoteId}`, {
      status: 'CONVERTED',
      convertedToInvoice: true
    });

    return invoiceData;
  }
}

/**
 * Utility functions for quote management
 */
export const QuoteUtils = {
  /**
   * Generate unique quote ID
   */
  generateQuoteId() {
    const year = new Date().getFullYear();
    const timestamp = String(Date.now()).slice(-6);
    return `Q-${year}-${timestamp}`;
  },

  /**
   * Calculate quote expiry date
   */
  calculateExpiryDate(days = 30) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString();
  },

  /**
   * Format currency for display
   */
  formatCurrency(amount, currency = 'GHS') {
    return new Intl.NumberFormat('en-GH', {
      style: 'currency',
      currency: currency
    }).format(amount);
  },

  /**
   * Check if quote is expired
   */
  isQuoteExpired(expiresAt) {
    return new Date(expiresAt) < new Date();
  }
};

export default QuoteCalculator;
