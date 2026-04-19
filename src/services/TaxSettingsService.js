/**
 * Global Tax Settings Service
 * Manages tax rates and configurations across the entire application.
 * Refactored to use the Oracle REST API instead of Firebase Firestore.
 */

import api from '../api';

/**
 * Default tax configuration (fallback if backend is unavailable)
 */
const DEFAULT_TAX_CONFIG = {
  nhil: { enabled: true, rate: 7.5, label: 'NHIL', description: 'National Health Insurance Levy', on: 'subtotal' },
  getfund: { enabled: true, rate: 2.5, label: 'GETFund Levy', description: 'Ghana Education Trust Fund Levy', on: 'subtotal' },
  covidLevy: { enabled: true, rate: 1.0, label: 'COVID-19 HRL', description: 'COVID-19 Health Recovery Levy', on: 'subtotal' },
  vat: { enabled: true, rate: 15.0, label: 'VAT', description: 'Value Added Tax', on: 'levyTotal' },
  importDuty: { enabled: false, rate: 20.0, label: 'Import Duty', description: 'Import Duty for imported goods', on: 'subtotal' }
};

class TaxSettingsService {
  constructor() {
    this.cache = null;
    this.cacheTimestamp = null;
    this.CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  }

  isCacheValid() {
    return this.cacheTimestamp && (Date.now() - this.cacheTimestamp) < this.CACHE_DURATION;
  }

  clearCache() {
    this.cache = null;
    this.cacheTimestamp = null;
    console.log('📊 [TaxSettings] Cache cleared');
  }

  /**
   * Get current tax settings with caching
   */
  async getTaxSettings(forceRefresh = false) {
    try {
      if (!forceRefresh && this.cache && this.isCacheValid()) {
        return this.cache;
      }

      console.log('📊 [TaxSettings] Fetching tax settings from Oracle backend');
      const response = await api.get('/settings/taxes');

      if (response.success && response.data?.taxArray) {
        // Transform array format to the legacy object format expected by calculateTaxes
        const taxObj = {};
        response.data.taxArray.forEach(tax => {
          taxObj[tax.id] = {
            enabled: tax.enabled,
            rate: tax.rate,
            label: tax.name,
            on: tax.on || 'subtotal'
          };
        });

        this.cache = { ...DEFAULT_TAX_CONFIG, ...taxObj, lastUpdated: new Date().toISOString() };
      } else {
        this.cache = { ...DEFAULT_TAX_CONFIG, lastUpdated: new Date().toISOString() };
      }

      this.cacheTimestamp = Date.now();
      return this.cache;
    } catch (error) {
      console.error('❌ [TaxSettings] Error fetching tax settings:', error);
      return DEFAULT_TAX_CONFIG;
    }
  }

  /**
   * Save tax settings via Oracle backend
   */
  async saveTaxSettings(taxArray, updatedBy = 'admin') {
    try {
      const response = await api.post('/settings/taxes', { taxArray });
      if (!response.success) throw new Error(response.error || 'Save failed');

      this.clearCache();
      console.log('✅ [TaxSettings] Tax settings saved successfully');
      return true;
    } catch (error) {
      console.error('❌ [TaxSettings] Error saving tax settings:', error);
      throw error;
    }
  }

  /**
   * Calculate taxes based on current settings
   */
  async calculateTaxes(subtotal, options = {}) {
    const taxSettings = await this.getTaxSettings();
    const { excludeTaxes = [], includeOnly = null } = options;

    let levyTotal = subtotal;
    const taxes = { subtotal, enabledTaxes: [], breakdown: {}, grandTotal: subtotal };

    // Taxes applied to subtotal (NHIL, GETFund, COVID)
    const subtotalTaxes = ['nhil', 'getfund', 'covidLevy'];
    for (const key of subtotalTaxes) {
      const t = taxSettings[key];
      if (t?.enabled && !excludeTaxes.includes(key) && (!includeOnly || includeOnly.includes(key))) {
        const amount = subtotal * (t.rate / 100);
        taxes.breakdown[key] = { amount, rate: t.rate, label: t.label };
        taxes.enabledTaxes.push(taxes.breakdown[key]);
        levyTotal += amount;
      }
    }

    taxes.levyTotal = levyTotal;

    // Taxes applied to levy total (VAT)
    const levyTaxes = ['vat', 'importDuty'];
    for (const key of levyTaxes) {
      const t = taxSettings[key];
      if (t?.enabled && !excludeTaxes.includes(key) && (!includeOnly || includeOnly.includes(key))) {
        const amount = levyTotal * (t.rate / 100);
        taxes.breakdown[key] = { amount, rate: t.rate, label: t.label };
        taxes.enabledTaxes.push(taxes.breakdown[key]);
        levyTotal += amount;
      }
    }

    taxes.grandTotal = levyTotal;
    return taxes;
  }

  /**
   * Get formatted tax rates for display
   */
  async getFormattedTaxRates() {
    const taxSettings = await this.getTaxSettings();
    return Object.entries(taxSettings)
      .filter(([, config]) => typeof config === 'object' && config.enabled && config.rate !== undefined)
      .map(([, config]) => `- ${config.label}: ${config.rate}%`)
      .join('\n');
  }

  /**
   * Get tax settings for AI context
   */
  async getTaxContextForAI() {
    const t = await this.getTaxSettings();
    return {
      nhil: t.nhil?.enabled ? t.nhil.rate : 0,
      getfund: t.getfund?.enabled ? t.getfund.rate : 0,
      covidLevy: t.covidLevy?.enabled ? t.covidLevy.rate : 0,
      vat: t.vat?.enabled ? t.vat.rate : 0,
      importDuty: t.importDuty?.enabled ? t.importDuty.rate : 0
    };
  }

  /**
   * Validate a tax config array
   */
  validateTaxConfig(taxConfig) {
    const errors = [];
    Object.entries(taxConfig).forEach(([key, config]) => {
      if (typeof config === 'object' && config !== null) {
        if (config.enabled && (config.rate < 0 || config.rate > 100)) {
          errors.push(`${key}: Rate must be between 0 and 100`);
        }
        if (config.rate !== undefined && isNaN(config.rate)) {
          errors.push(`${key}: Rate must be a number`);
        }
      }
    });
    return { isValid: errors.length === 0, errors };
  }
}

// Export singleton instance
export const taxSettingsService = new TaxSettingsService();
export default taxSettingsService;
