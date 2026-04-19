/**
 * Pricing Management Component
 * CIF-based landed cost pricing with configurable presets and per-item overrides.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../api';
import { useRealtimeInventory } from '../hooks/useRealtimeInventory';
import { useApp } from '../context/AppContext';
import { calculateLandedCost } from '../utils/pricing';

const ITEM_TYPES = ['Hardware', 'Software', 'Service'];
const CURRENCIES = ['USD', 'GHS', 'EUR', 'GBP'];

const PricingManagementLocal = ({ userId, navigateTo }) => {
  const { userEmail } = useApp();
  const username = userEmail ? userEmail.split('@')[0] : userId;
  const [activeTab, setActiveTab] = useState('inventory');
  const [inventory, setInventory] = useState([]);
  const [pricingSettings, setPricingSettings] = useState(null);

  const [editingItem, setEditingItem] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [notification, setNotification] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterCurrency, setFilterCurrency] = useState('all');
  const [sortBy, setSortBy] = useState('sku');
  const [sortOrder, setSortOrder] = useState('asc');

  const handleSearchChange = useCallback((e) => setSearchTerm(e.target.value), []);
  const handleClearAllFilters = useCallback(() => {
    setSearchTerm('');
    setFilterType('all');
    setFilterCurrency('all');
  }, []);

  // Real-time inventory listener
  const { data: inventoryData } = useRealtimeInventory();
  useEffect(() => { if (inventoryData) setInventory(inventoryData); }, [inventoryData]);

  // Load pricing settings
  useEffect(() => { loadPricingSettings(); }, []);

  const loadPricingSettings = async () => {
    try {
      const response = await api.get('/settings/pricing');
      if (response.success && response.data) {
        setPricingSettings(response.data);
      } else {
        setPricingSettings({
          defaultMarkupPercent: 30,
          pricingMode: 'markup',
          allocationMethod: 'weight',
          roundingDecimals: 2,
          defaultIncoterm: 'FOB',
          defaultCurrency: 'GHS',
          defaultQuoteExpiryDays: 30,
          approvalThresholds: { minMarginPercent: 15, maxDiscountPercent: 20, requireApprovalAbove: 10000 },
          taxRules: { defaultRate: 0.12 },
          presetRates: { insurancePct: 0.01, freightPct: 0.12, dutyPct: 0.50, handlingPct: 0.02, transferAdminPct: 0.015, defaultFxRate: 13.05 }
        });
      }
    } catch (error) {
      console.error('Error loading pricing settings:', error);
      setNotification({ type: 'error', message: 'Failed to load pricing settings' });
    }
  };

  const presets = pricingSettings?.presetRates || {
    insurancePct: 0.01, freightPct: 0.12, dutyPct: 0.50,
    handlingPct: 0.02, transferAdminPct: 0.015, defaultFxRate: 13.05
  };
  const defaultMarkupPct = pricingSettings?.defaultMarkupPercent || 30;

  // Calculate landed cost for display
  const getLandedCost = useCallback((item) => {
    return calculateLandedCost(item, { ...presets, defaultMarkupPct });
  }, [presets, defaultMarkupPct]);

  const updateInventoryCosts = async (sku, costData) => {
    setLoading(true);
    try {
      await api.put(`/inventory/${sku}`, { ...costData, updatedBy: userEmail });
      setNotification({ type: 'success', message: `Updated pricing for ${sku}` });
      setEditingItem(null);
      setEditForm({});
    } catch (error) {
      console.error('Error updating inventory costs:', error);
      setNotification({ type: 'error', message: 'Failed to update inventory costs' });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveItemCosts = async (e) => {
    e.preventDefault();
    const costData = {
      itemType: editForm.itemType,
      currency: editForm.currency,
      weightKg: parseFloat(editForm.weightKg) || 0,
      costComponents: {
        inboundFreightPerUnit: parseFloat(editForm.freight) || 0,
        dutyPerUnit: parseFloat(editForm.duty) || 0,
        insurancePerUnit: parseFloat(editForm.insurance) || 0,
        packagingPerUnit: parseFloat(editForm.packaging) || 0,
        otherPerUnit: parseFloat(editForm.other) || 0,
        handlingPerUnit: parseFloat(editForm.handling) || 0,
        transferAdminPerUnit: parseFloat(editForm.transferAdmin) || 0
      },
      markupOverridePercent: editForm.markupOverride ? parseFloat(editForm.markupOverride) : null,
      pricingTier: editForm.pricingTier || 'standard'
    };
    await updateInventoryCosts(editingItem.id, costData);
  };

  // When user clicks "Apply Presets", auto-fill based on type + currency rules
  const handleApplyPresets = () => {
    const listPrice = editingItem.price || 0;
    const itemType = editForm.itemType || 'Hardware';
    const currency = (editForm.currency || 'GHS').toUpperCase();
    const isHardware = itemType === 'Hardware';
    const isService = itemType === 'Service';
    const isForeign = currency !== 'GHS';

    if (isService) {
      setEditForm(prev => ({
        ...prev,
        insurance: '0', freight: '0', duty: '0',
        handling: '0', transferAdmin: '0', markupOverride: ''
      }));
      return;
    }

    const insurance = (isHardware && isForeign) ? (listPrice * presets.insurancePct).toFixed(4) : '0';
    const freight = (isHardware && isForeign) ? (listPrice * presets.freightPct).toFixed(4) : '0';
    const cif = listPrice + parseFloat(insurance) + parseFloat(freight);
    const duty = (isHardware && isForeign) ? (cif * presets.dutyPct).toFixed(4) : '0';
    const handling = isHardware ? (cif * presets.handlingPct).toFixed(4) : '0';
    const transferAdmin = (cif * presets.transferAdminPct).toFixed(4);

    setEditForm(prev => ({
      ...prev,
      insurance, freight, duty, handling, transferAdmin,
      markupOverride: String(defaultMarkupPct)
    }));
  };

  // Open edit modal and initialize form state
  const openEditModal = (item) => {
    setEditingItem(item);
    setEditForm({
      itemType: item.itemType || 'Hardware',
      currency: item.currency || 'GHS',
      weightKg: String(item.weightKg || 0),
      insurance: String(item.costComponents?.insurancePerUnit || 0),
      freight: String(item.costComponents?.inboundFreightPerUnit || 0),
      duty: String(item.costComponents?.dutyPerUnit || 0),
      handling: String(item.costComponents?.handlingPerUnit || 0),
      transferAdmin: String(item.costComponents?.transferAdminPerUnit || 0),
      packaging: String(item.costComponents?.packagingPerUnit || 0),
      other: String(item.costComponents?.otherPerUnit || 0),
      markupOverride: item.markupOverridePercent ? String(item.markupOverridePercent) : '',
      pricingTier: item.pricingTier || 'standard'
    });
  };

  // Live preview of the edit form
  const editPreview = useMemo(() => {
    if (!editingItem) return null;
    const previewItem = {
      price: editingItem.price || 0,
      itemType: editForm.itemType || 'Hardware',
      currency: editForm.currency || 'GHS',
      costComponents: {
        insurancePerUnit: parseFloat(editForm.insurance) || 0,
        inboundFreightPerUnit: parseFloat(editForm.freight) || 0,
        dutyPerUnit: parseFloat(editForm.duty) || 0,
        handlingPerUnit: parseFloat(editForm.handling) || 0,
        transferAdminPerUnit: parseFloat(editForm.transferAdmin) || 0,
        packagingPerUnit: parseFloat(editForm.packaging) || 0,
        otherPerUnit: parseFloat(editForm.other) || 0,
      },
      markupOverridePercent: editForm.markupOverride ? parseFloat(editForm.markupOverride) : null
    };
    return calculateLandedCost(previewItem, { ...presets, defaultMarkupPct });
  }, [editingItem, editForm, presets, defaultMarkupPct]);

  // Pricing settings save
  const handleSavePricingSettings = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const formData = new FormData(e.target);
      const settings = {
        defaultMarkupPercent: parseFloat(formData.get('defaultMarkup')) || 30,
        pricingMode: formData.get('pricingMode') || 'markup',
        allocationMethod: formData.get('allocationMethod') || 'weight',
        roundingDecimals: parseInt(formData.get('roundingDecimals')) || 2,
        defaultIncoterm: formData.get('defaultIncoterm') || 'FOB',
        defaultCurrency: formData.get('defaultCurrency') || 'GHS',
        defaultQuoteExpiryDays: parseInt(formData.get('defaultQuoteExpiryDays')) || 30,
        approvalThresholds: {
          minMarginPercent: parseFloat(formData.get('minMarginPercent')) || 15,
          maxDiscountPercent: parseFloat(formData.get('maxDiscountPercent')) || 20,
          requireApprovalAbove: parseFloat(formData.get('requireApprovalAbove')) || 10000
        },
        taxRules: { defaultRate: parseFloat(formData.get('defaultTaxRate')) || 0.12 },
        presetRates: {
          insurancePct: parseFloat(formData.get('insurancePct')) || 0.01,
          freightPct: parseFloat(formData.get('freightPct')) || 0.12,
          dutyPct: parseFloat(formData.get('dutyPct')) || 0.50,
          handlingPct: parseFloat(formData.get('handlingPct')) || 0.02,
          transferAdminPct: parseFloat(formData.get('transferAdminPct')) || 0.015,
          defaultFxRate: parseFloat(formData.get('defaultFxRate')) || 13.05
        }
      };
      await api.post('/settings/pricing', { ...settings, updatedBy: userEmail });
      setPricingSettings(settings);
      setNotification({ type: 'success', message: 'Pricing settings updated successfully' });
    } catch (error) {
      console.error('Error updating pricing settings:', error);
      setNotification({ type: 'error', message: 'Failed to update pricing settings' });
    } finally {
      setLoading(false);
    }
  };

  // Filtered and sorted inventory
  const filteredAndSortedInventory = useMemo(() => {
    let filtered = inventory.filter(item => {
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = !searchTerm ||
        item.id.toLowerCase().includes(searchLower) ||
        item.name.toLowerCase().includes(searchLower) ||
        (item.vendor && item.vendor.toLowerCase().includes(searchLower));
      const matchesType = filterType === 'all' || (item.itemType || 'Hardware') === filterType;
      const matchesCurrency = filterCurrency === 'all' || (item.currency || 'GHS') === filterCurrency;
      return matchesSearch && matchesType && matchesCurrency;
    });

    filtered.sort((a, b) => {
      let aVal, bVal;
      switch (sortBy) {
        case 'sku': aVal = a.id; bVal = b.id; break;
        case 'name': aVal = a.name; bVal = b.name; break;
        case 'baseCost': aVal = a.price || 0; bVal = b.price || 0; break;
        case 'finalPrice': aVal = getLandedCost(a).finalGHS; bVal = getLandedCost(b).finalGHS; break;
        default: aVal = a.id; bVal = b.id;
      }
      if (typeof aVal === 'string') return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return filtered;
  }, [inventory, searchTerm, filterType, filterCurrency, sortBy, sortOrder, getLandedCost]);

  const fmtNum = (v, dec = 2) => v != null ? Number(v).toFixed(dec) : '0.00';
  const fmtCur = (v) => `GHS ${fmtNum(v)}`;

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-[1600px] mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center justify-between">
              <div>
                <button onClick={() => navigateTo('controllerDashboard')} className="flex items-center text-blue-600 hover:text-blue-800 mb-2">
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  Back to Dashboard
                </button>
                <h1 className="text-3xl font-bold text-gray-900">Pricing Management</h1>
                <p className="mt-2 text-gray-600">CIF-based landed cost pricing with configurable presets and per-item overrides.</p>
              </div>
              <div className="text-sm text-gray-500">User: {username}</div>
            </div>
          </div>

          {/* Notification */}
          {notification && (
            <div className={`mb-6 p-4 rounded-md ${notification.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
              {notification.message}
              <button onClick={() => setNotification(null)} className="ml-4 text-sm underline">Dismiss</button>
            </div>
          )}

          {/* Tabs */}
          <div className="border-b border-gray-200 mb-6">
            <nav className="-mb-px flex space-x-8">
              {[
                { key: 'inventory', label: 'Price List' },
                { key: 'presets', label: 'Pricing Presets' },
                { key: 'settings', label: 'General Settings' }
              ].map(tab => (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === tab.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* ======================== PRICE LIST TAB ======================== */}
          {activeTab === 'inventory' && (
            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Price List Management</h3>

                {/* Info box */}
                <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-700">
                  <strong>CIF Formula:</strong> Insurance & Freight (Hardware+Foreign only) &rarr; CIF = List + Ins + Frt &rarr;
                  Duty (Hardware+Foreign on CIF) &rarr; Handling (Hardware on CIF) &rarr; T&A (on CIF) &rarr; Markup (on CIF) &rarr; FX conversion.
                  <span className="ml-2 text-blue-500">Software: only T&A + Markup. Service: manual pricing.</span>
                </div>

                {/* Filters */}
                <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  <div className="lg:col-span-2">
                    <input type="text" placeholder="Search by SKU, name, or vendor..." value={searchTerm} onChange={handleSearchChange}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                  <select value={filterType} onChange={e => setFilterType(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm">
                    <option value="all">All Types</option>
                    {ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <select value={filterCurrency} onChange={e => setFilterCurrency(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm">
                    <option value="all">All Currencies</option>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="flex-1 px-2 py-2 border border-gray-300 rounded-md text-sm">
                      <option value="sku">Sort: SKU</option>
                      <option value="name">Sort: Name</option>
                      <option value="baseCost">Sort: Base Cost</option>
                      <option value="finalPrice">Sort: Final Price</option>
                    </select>
                    <button onClick={() => setSortOrder(o => o === 'asc' ? 'desc' : 'asc')}
                      className="px-3 py-2 border border-gray-300 rounded-md text-sm hover:bg-gray-50">
                      {sortOrder === 'asc' ? '↑' : '↓'}
                    </button>
                  </div>
                </div>

                <div className="flex justify-between items-center text-sm text-gray-600 mb-3">
                  <span>Showing {filteredAndSortedInventory.length} of {inventory.length} items</span>
                  {(searchTerm || filterType !== 'all' || filterCurrency !== 'all') && (
                    <button onClick={handleClearAllFilters} className="text-blue-600 hover:text-blue-800 font-medium">Clear Filters</button>
                  )}
                </div>

                {/* Price List Table */}
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Curr</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">List Price</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Insurance</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Freight</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase bg-yellow-50">CIF</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Duty</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Handling</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">T&A</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Markup</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Selling</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">FX</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase bg-green-50 font-bold">Final (GHS)</th>
                        <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {filteredAndSortedInventory.length > 0 ? (
                        filteredAndSortedInventory.map((item) => {
                          const lc = getLandedCost(item);
                          return (
                            <tr key={item.id} className="hover:bg-gray-50">
                              <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-900">{item.id}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-gray-900 max-w-[200px] truncate">{item.name}</td>
                              <td className="px-3 py-2 whitespace-nowrap">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                  (item.itemType || 'Hardware') === 'Hardware' ? 'bg-blue-100 text-blue-700' :
                                  (item.itemType || 'Hardware') === 'Software' ? 'bg-purple-100 text-purple-700' :
                                  'bg-orange-100 text-orange-700'
                                }`}>{item.itemType || 'Hardware'}</span>
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap text-gray-600">{item.currency || 'GHS'}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-right">{fmtNum(item.price)}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-right text-gray-500">{fmtNum(lc.insurance)}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-right text-gray-500">{fmtNum(lc.freight)}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-right bg-yellow-50 font-medium">{fmtNum(lc.cif)}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-right text-gray-500">{fmtNum(lc.duty)}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-right text-gray-500">{fmtNum(lc.handling)}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-right text-gray-500">{fmtNum(lc.transferAdmin)}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-right text-gray-500">{fmtNum(lc.markup)}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-right font-medium">{fmtNum(lc.selling)}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-right text-gray-500">{lc.fxRate !== 1 ? fmtNum(lc.fxRate, 4) : '-'}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-right bg-green-50 font-bold text-green-700">{fmtCur(lc.finalGHS)}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-center">
                                <button onClick={() => openEditModal(item)} className="text-blue-600 hover:text-blue-900 font-medium text-xs">Edit Pricing</button>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan="16" className="px-4 py-8 text-center text-gray-500">
                            {searchTerm || filterType !== 'all' || filterCurrency !== 'all'
                              ? 'No items match your filters. Try adjusting your search criteria.'
                              : 'No items available in inventory.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ======================== EDIT MODAL ======================== */}
              {editingItem && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
                  <div className="relative top-10 mx-auto p-6 border max-w-2xl shadow-lg rounded-lg bg-white">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">Edit Pricing Components</h3>
                        <p className="text-sm text-gray-500">{editingItem.name} ({editingItem.id})</p>
                      </div>
                      <button onClick={() => { setEditingItem(null); setEditForm({}); }} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
                    </div>

                    <form onSubmit={handleSaveItemCosts} className="space-y-4">
                      {/* Row 1: Base info */}
                      <div className="grid grid-cols-4 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">List Price</label>
                          <div className="p-2 bg-gray-50 border rounded-md text-sm text-gray-600">
                            {editingItem.price ? editingItem.price.toFixed(2) : '0.00'}
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Item Type</label>
                          <select value={editForm.itemType || 'Hardware'} onChange={e => setEditForm(p => ({...p, itemType: e.target.value}))}
                            className="w-full p-2 border rounded-md text-sm">
                            {ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Currency</label>
                          <select value={editForm.currency || 'GHS'} onChange={e => setEditForm(p => ({...p, currency: e.target.value}))}
                            className="w-full p-2 border rounded-md text-sm">
                            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Weight (kg)</label>
                          <input type="number" step="0.1" value={editForm.weightKg || '0'}
                            onChange={e => setEditForm(p => ({...p, weightKg: e.target.value}))}
                            className="w-full p-2 border rounded-md text-sm" />
                        </div>
                      </div>

                      {/* Apply Presets Button */}
                      <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
                        <button type="button" onClick={handleApplyPresets}
                          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700">
                          Apply Presets
                        </button>
                        <span className="text-xs text-blue-600">
                          Auto-fills cost components based on Item Type + Currency rules. You can still override any field below.
                        </span>
                      </div>

                      {/* Cost components grid */}
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Insurance</label>
                          <input type="number" step="0.01" value={editForm.insurance || '0'}
                            onChange={e => setEditForm(p => ({...p, insurance: e.target.value}))}
                            className="w-full p-2 border rounded-md text-sm" />
                          <p className="text-xs text-gray-400 mt-0.5">Preset: {(presets.insurancePct * 100).toFixed(1)}% of list</p>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Freight</label>
                          <input type="number" step="0.01" value={editForm.freight || '0'}
                            onChange={e => setEditForm(p => ({...p, freight: e.target.value}))}
                            className="w-full p-2 border rounded-md text-sm" />
                          <p className="text-xs text-gray-400 mt-0.5">Preset: {(presets.freightPct * 100).toFixed(1)}% of list</p>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Duty</label>
                          <input type="number" step="0.01" value={editForm.duty || '0'}
                            onChange={e => setEditForm(p => ({...p, duty: e.target.value}))}
                            className="w-full p-2 border rounded-md text-sm" />
                          <p className="text-xs text-gray-400 mt-0.5">Preset: {(presets.dutyPct * 100).toFixed(1)}% of CIF</p>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Handling</label>
                          <input type="number" step="0.01" value={editForm.handling || '0'}
                            onChange={e => setEditForm(p => ({...p, handling: e.target.value}))}
                            className="w-full p-2 border rounded-md text-sm" />
                          <p className="text-xs text-gray-400 mt-0.5">Preset: {(presets.handlingPct * 100).toFixed(1)}% of CIF</p>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Transfer & Admin</label>
                          <input type="number" step="0.01" value={editForm.transferAdmin || '0'}
                            onChange={e => setEditForm(p => ({...p, transferAdmin: e.target.value}))}
                            className="w-full p-2 border rounded-md text-sm" />
                          <p className="text-xs text-gray-400 mt-0.5">Preset: {(presets.transferAdminPct * 100).toFixed(1)}% of CIF</p>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Packaging</label>
                          <input type="number" step="0.01" value={editForm.packaging || '0'}
                            onChange={e => setEditForm(p => ({...p, packaging: e.target.value}))}
                            className="w-full p-2 border rounded-md text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Other Charges</label>
                          <input type="number" step="0.01" value={editForm.other || '0'}
                            onChange={e => setEditForm(p => ({...p, other: e.target.value}))}
                            className="w-full p-2 border rounded-md text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Markup Override (%)</label>
                          <input type="number" step="0.1" value={editForm.markupOverride || ''}
                            onChange={e => setEditForm(p => ({...p, markupOverride: e.target.value}))}
                            placeholder={`Default: ${defaultMarkupPct}%`}
                            className="w-full p-2 border rounded-md text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Pricing Tier</label>
                          <select value={editForm.pricingTier || 'standard'} onChange={e => setEditForm(p => ({...p, pricingTier: e.target.value}))}
                            className="w-full p-2 border rounded-md text-sm">
                            <option value="standard">Standard</option>
                            <option value="premium">Premium</option>
                            <option value="budget">Budget</option>
                          </select>
                        </div>
                      </div>

                      {/* Live Preview */}
                      {editPreview && (
                        <div className="p-4 bg-gray-50 border rounded-md">
                          <h4 className="text-sm font-semibold text-gray-700 mb-2">Live Cost Breakdown Preview</h4>
                          <div className="grid grid-cols-6 gap-2 text-xs">
                            <div className="text-center"><div className="text-gray-500">CIF</div><div className="font-medium">{fmtNum(editPreview.cif)}</div></div>
                            <div className="text-center"><div className="text-gray-500">Duty</div><div className="font-medium">{fmtNum(editPreview.duty)}</div></div>
                            <div className="text-center"><div className="text-gray-500">Handling</div><div className="font-medium">{fmtNum(editPreview.handling)}</div></div>
                            <div className="text-center"><div className="text-gray-500">T&A</div><div className="font-medium">{fmtNum(editPreview.transferAdmin)}</div></div>
                            <div className="text-center"><div className="text-gray-500">Markup</div><div className="font-medium">{fmtNum(editPreview.markup)}</div></div>
                            <div className="text-center"><div className="text-gray-500">Selling</div><div className="font-medium">{fmtNum(editPreview.selling)}</div></div>
                          </div>
                          <div className="mt-3 pt-3 border-t flex justify-between items-center">
                            <span className="text-sm text-gray-600">FX Rate: {editPreview.fxRate !== 1 ? fmtNum(editPreview.fxRate, 4) : 'N/A (local)'}</span>
                            <span className="text-lg font-bold text-green-700">Final: GHS {fmtNum(editPreview.finalGHS)}</span>
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex justify-end space-x-3 pt-2">
                        <button type="button" onClick={() => { setEditingItem(null); setEditForm({}); }}
                          className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                        <button type="submit" disabled={loading}
                          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                          {loading ? 'Saving...' : 'Save Changes'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ======================== PRICING PRESETS TAB ======================== */}
          {activeTab === 'presets' && (
            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-2">Pricing Presets (Rate-Based)</h3>
                <p className="text-sm text-gray-500 mb-6">
                  These rates are applied when a user clicks "Apply Presets" on an item. They follow CIF-based costing standards.
                  Rates are percentages expressed as decimals (e.g., 0.12 = 12%).
                </p>

                {pricingSettings && (
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    setLoading(true);
                    try {
                      const fd = new FormData(e.target);
                      const updated = {
                        ...pricingSettings,
                        defaultMarkupPercent: parseFloat(fd.get('presetMarkup')) || 30,
                        presetRates: {
                          insurancePct: parseFloat(fd.get('insurancePct')) || 0.01,
                          freightPct: parseFloat(fd.get('freightPct')) || 0.12,
                          dutyPct: parseFloat(fd.get('dutyPct')) || 0.50,
                          handlingPct: parseFloat(fd.get('handlingPct')) || 0.02,
                          transferAdminPct: parseFloat(fd.get('transferAdminPct')) || 0.015,
                          defaultFxRate: parseFloat(fd.get('defaultFxRate')) || 13.05
                        }
                      };
                      await api.post('/settings/pricing', { ...updated, updatedBy: userEmail });
                      setPricingSettings(updated);
                      setNotification({ type: 'success', message: 'Pricing presets saved.' });
                    } catch (err) {
                      setNotification({ type: 'error', message: 'Failed to save presets.' });
                    } finally { setLoading(false); }
                  }} className="space-y-6">

                    {/* Applicability Rules Info */}
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-md text-sm">
                      <h4 className="font-semibold text-amber-800 mb-2">Auto-Application Rules</h4>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-amber-700">
                            <th className="pb-1">Component</th>
                            <th className="pb-1">Hardware + Foreign</th>
                            <th className="pb-1">Hardware + GHS</th>
                            <th className="pb-1">Software</th>
                            <th className="pb-1">Service</th>
                          </tr>
                        </thead>
                        <tbody className="text-amber-900">
                          <tr><td>Insurance</td><td className="text-green-600">Yes (on List)</td><td>No</td><td>No</td><td>No</td></tr>
                          <tr><td>Freight</td><td className="text-green-600">Yes (on List)</td><td>No</td><td>No</td><td>No</td></tr>
                          <tr><td>Duty</td><td className="text-green-600">Yes (on CIF)</td><td>No</td><td>No</td><td>No</td></tr>
                          <tr><td>Handling</td><td className="text-green-600">Yes (on CIF)</td><td className="text-green-600">Yes (on CIF)</td><td>No</td><td>No</td></tr>
                          <tr><td>Transfer & Admin</td><td className="text-green-600">Yes (on CIF)</td><td className="text-green-600">Yes (on CIF)</td><td className="text-green-600">Yes (on CIF)</td><td>No</td></tr>
                          <tr><td>Markup</td><td className="text-green-600">Yes (on CIF)</td><td className="text-green-600">Yes (on CIF)</td><td className="text-green-600">Yes (on CIF)</td><td>No</td></tr>
                          <tr><td>FX Conversion</td><td className="text-green-600">Yes</td><td>No</td><td className="text-green-600">Yes</td><td>No</td></tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Insurance Rate</label>
                        <div className="flex items-center">
                          <input type="number" step="0.001" name="insurancePct" defaultValue={presets.insurancePct}
                            className="flex-1 p-2 border rounded-l-md text-sm" />
                          <span className="px-3 py-2 bg-gray-100 border border-l-0 rounded-r-md text-sm text-gray-500">= {(presets.insurancePct * 100).toFixed(1)}%</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">Applied on List Price</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Freight Rate</label>
                        <div className="flex items-center">
                          <input type="number" step="0.001" name="freightPct" defaultValue={presets.freightPct}
                            className="flex-1 p-2 border rounded-l-md text-sm" />
                          <span className="px-3 py-2 bg-gray-100 border border-l-0 rounded-r-md text-sm text-gray-500">= {(presets.freightPct * 100).toFixed(1)}%</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">Applied on List Price</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Duty Rate</label>
                        <div className="flex items-center">
                          <input type="number" step="0.001" name="dutyPct" defaultValue={presets.dutyPct}
                            className="flex-1 p-2 border rounded-l-md text-sm" />
                          <span className="px-3 py-2 bg-gray-100 border border-l-0 rounded-r-md text-sm text-gray-500">= {(presets.dutyPct * 100).toFixed(1)}%</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">Applied on CIF</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Handling Rate</label>
                        <div className="flex items-center">
                          <input type="number" step="0.001" name="handlingPct" defaultValue={presets.handlingPct}
                            className="flex-1 p-2 border rounded-l-md text-sm" />
                          <span className="px-3 py-2 bg-gray-100 border border-l-0 rounded-r-md text-sm text-gray-500">= {(presets.handlingPct * 100).toFixed(1)}%</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">Applied on CIF</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Transfer & Admin Rate</label>
                        <div className="flex items-center">
                          <input type="number" step="0.001" name="transferAdminPct" defaultValue={presets.transferAdminPct}
                            className="flex-1 p-2 border rounded-l-md text-sm" />
                          <span className="px-3 py-2 bg-gray-100 border border-l-0 rounded-r-md text-sm text-gray-500">= {(presets.transferAdminPct * 100).toFixed(1)}%</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">Applied on CIF</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Default Markup (%)</label>
                        <input type="number" step="0.1" name="presetMarkup" defaultValue={pricingSettings.defaultMarkupPercent}
                          className="w-full p-2 border rounded-md text-sm" />
                        <p className="text-xs text-gray-400 mt-1">Applied on CIF</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Default FX Rate (to GHS)</label>
                        <input type="number" step="0.01" name="defaultFxRate" defaultValue={presets.defaultFxRate}
                          className="w-full p-2 border rounded-md text-sm" />
                        <p className="text-xs text-gray-400 mt-1">Applied for foreign currencies</p>
                      </div>
                    </div>

                    {/* Example calculation */}
                    <div className="p-4 bg-gray-50 border rounded-md">
                      <h4 className="text-sm font-semibold text-gray-700 mb-2">Example: Hardware item at USD 100.00</h4>
                      <div className="grid grid-cols-7 gap-2 text-xs text-center">
                        {(() => {
                          const ex = calculateLandedCost(
                            { price: 100, itemType: 'Hardware', currency: 'USD' },
                            { ...presets, defaultMarkupPct: pricingSettings.defaultMarkupPercent }
                          );
                          return <>
                            <div><div className="text-gray-500">Insurance</div><div className="font-medium">{fmtNum(ex.insurance)}</div></div>
                            <div><div className="text-gray-500">Freight</div><div className="font-medium">{fmtNum(ex.freight)}</div></div>
                            <div><div className="text-gray-500 bg-yellow-100 rounded">CIF</div><div className="font-bold">{fmtNum(ex.cif)}</div></div>
                            <div><div className="text-gray-500">Duty</div><div className="font-medium">{fmtNum(ex.duty)}</div></div>
                            <div><div className="text-gray-500">Handling</div><div className="font-medium">{fmtNum(ex.handling)}</div></div>
                            <div><div className="text-gray-500">T&A</div><div className="font-medium">{fmtNum(ex.transferAdmin)}</div></div>
                            <div><div className="text-gray-500">Markup</div><div className="font-medium">{fmtNum(ex.markup)}</div></div>
                          </>;
                        })()}
                      </div>
                      <div className="mt-2 text-xs text-right">
                        {(() => {
                          const ex = calculateLandedCost(
                            { price: 100, itemType: 'Hardware', currency: 'USD' },
                            { ...presets, defaultMarkupPct: pricingSettings.defaultMarkupPercent }
                          );
                          return <>Selling: {fmtNum(ex.selling)} &times; FX {fmtNum(ex.fxRate, 2)} = <strong className="text-green-700">GHS {fmtNum(ex.finalGHS)}</strong></>;
                        })()}
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button type="submit" disabled={loading}
                        className="px-6 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                        {loading ? 'Saving...' : 'Save Presets'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}

          {/* ======================== GENERAL SETTINGS TAB ======================== */}
          {activeTab === 'settings' && (
            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Global Pricing Settings</h3>
                {pricingSettings && (
                  <form onSubmit={handleSavePricingSettings} className="space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Default Markup (%)</label>
                        <input type="number" step="0.1" name="defaultMarkup" defaultValue={pricingSettings.defaultMarkupPercent}
                          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" required />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Pricing Mode</label>
                        <select name="pricingMode" defaultValue={pricingSettings.pricingMode}
                          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500">
                          <option value="markup">Markup</option><option value="margin">Margin</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Allocation Method</label>
                        <select name="allocationMethod" defaultValue={pricingSettings.allocationMethod}
                          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500">
                          <option value="weight">By Weight</option><option value="value">By Value</option><option value="equal">Equal Distribution</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Rounding Decimals</label>
                        <input type="number" min="0" max="4" name="roundingDecimals" defaultValue={pricingSettings.roundingDecimals}
                          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" required />
                      </div>
                    </div>

                    {/* Hidden fields to preserve preset rates during general settings save */}
                    <input type="hidden" name="insurancePct" value={presets.insurancePct} />
                    <input type="hidden" name="freightPct" value={presets.freightPct} />
                    <input type="hidden" name="dutyPct" value={presets.dutyPct} />
                    <input type="hidden" name="handlingPct" value={presets.handlingPct} />
                    <input type="hidden" name="transferAdminPct" value={presets.transferAdminPct} />
                    <input type="hidden" name="defaultFxRate" value={presets.defaultFxRate} />

                    <div className="flex justify-end pt-6">
                      <button type="submit" disabled={loading}
                        className="px-6 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                        {loading ? 'Saving...' : 'Save Settings'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PricingManagementLocal;
