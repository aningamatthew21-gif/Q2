import React, { useState, useEffect, useMemo, useRef } from 'react';
import api from '../api';
import { useRealtimeInventory } from '../hooks/useRealtimeInventory';
import { useRealtimeCustomers } from '../hooks/useRealtimeCustomers';
import Icon from '../components/common/Icon';
import PageHeader from '../components/common/PageHeader';
import Button from '../components/common/Button';
import PreviewModal from '../components/PreviewModal';
import QuantityModal from '../components/modals/QuantityModal';
import ConfirmationModal from '../components/modals/ConfirmationModal';
import { logActivity } from '../utils/logger';
import EnhancedAIService from '../services/EnhancedAIService';
import NLPService from '../services/NLPService';
import companyLogo from '../assets/company-logo.png';
import { generateTemporaryId } from '../utils/helpers';
import { formatCurrency } from '../utils/formatting';
import { calculateFinalPrice } from '../utils/pricing';

const QuotingModule = ({ navigateTo, userId }) => {
    const [notification, setNotification] = useState(null);

    const { data: inventory, loading: inventoryLoading } = useRealtimeInventory();
    const { data: customers, loading: customersLoading } = useRealtimeCustomers();

    const [taxesData, setTaxesData] = useState([]);
    const [taxesLoading, setTaxesLoading] = useState(true);
    const [pricingData, setPricingData] = useState({});
    const [pricingLoading, setPricingLoading] = useState(true);

    const getItemPrice = (item) => {
        const finalPrice = pricingData[item.id]?.finalPrice || item.price || 0;
        return finalPrice;
    };

    useEffect(() => {
        if (inventory) {
            const pricingMap = {};
            inventory.forEach(item => {
                if (item.price) {
                    const finalPrice = calculateFinalPrice(item);
                    pricingMap[item.id] = { basePrice: item.price, finalPrice: finalPrice, costComponents: item.costComponents || {}, markup: item.markupOverridePercent || 32 };
                }
            });
            setPricingData(pricingMap);
            setPricingLoading(false);
        }
    }, [inventory]);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const [taxesRes, pricingRes] = await Promise.all([
                    api.get('/settings/taxes'),
                    api.get('/settings/pricing')
                ]);
                
                const settingsData = [
                    { id: 'taxes', ...taxesRes.data },
                    { id: 'pricing', ...pricingRes.data }
                ];
                setTaxesData(settingsData);
                setTaxesLoading(false);
            } catch (err) {
                console.error('Error fetching settings:', err);
                setTaxesLoading(false);
            }
        };

        fetchSettings();
    }, []);

    const initialTaxes = [];
    const taxes = useMemo(() => {
        if (taxesData.length > 0) {
            const taxDoc = taxesData.find(doc => doc.id === 'taxes');
            return taxDoc?.taxArray || initialTaxes;
        }
        return initialTaxes;
    }, [taxesData]);

    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [customerSearch, setCustomerSearch] = useState('');
    const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [quoteItems, setQuoteItems] = useState([]);
    const [stockWarning, setStockWarning] = useState(null);
    const [addingItem, setAddingItem] = useState(null);
    const [removingItem, setRemovingItem] = useState(null);

    const [chatHistory, setChatHistory] = useState([]);
    const [userInput, setUserInput] = useState('');
    const textAreaRef = useRef(null);
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [isAiChatOpen, setIsAiChatOpen] = useState(false);
    const chatContainerRef = useRef(null);

    // Draggable Bubble State
    const [bubblePos, setBubblePos] = useState({ x: window.innerWidth - 80, y: window.innerHeight - 100 });
    const [isDragging, setIsDragging] = useState(false);
    const dragStartRef = useRef({ x: 0, y: 0 });
    const [hasDragged, setHasDragged] = useState(false);

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!isDragging) return;
            setBubblePos({
                x: e.clientX - dragStartRef.current.x,
                y: e.clientY - dragStartRef.current.y
            });
            setHasDragged(true);
        };
        const handleMouseUp = () => {
            setIsDragging(false);
        };
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging]);

    const handleBubbleMouseDown = (e) => {
        setIsDragging(true);
        setHasDragged(false);
        dragStartRef.current = {
            x: e.clientX - bubblePos.x,
            y: e.clientY - bubblePos.y
        };
    };

    const [selectedIncoterm, setSelectedIncoterm] = useState('FOB');
    const [incoterms] = useState([
        { value: 'EXW', label: 'EXW - Ex Works', description: 'Buyer responsible for all costs and risks' },
        { value: 'FOB', label: 'FOB - Free On Board', description: 'Seller pays to port, buyer pays shipping' },
        { value: 'CIF', label: 'CIF - Cost, Insurance, Freight', description: 'Seller pays all costs to destination port' },
        { value: 'DDP', label: 'DDP - Delivered Duty Paid', description: 'Seller pays all costs including duties and taxes' }
    ]);

    const [orderCharges, setOrderCharges] = useState({ shipping: 0, handling: 0, discount: 0 });

    // AI services moved to backend (/api/ai/chat) for security
    const aiService = useMemo(() => new EnhancedAIService(), []);
    const nlpService = useMemo(() => new NLPService(), []);

    const [quoteCurrency, setQuoteCurrency] = useState('GHS');
    const toggleQuoteCurrency = () => {
        setQuoteCurrency(prev => prev === 'GHS' ? 'USD' : 'GHS');
    };

    const [fxMonthKey, setFxMonthKey] = useState(() => {
        const now = new Date();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        return `${now.getFullYear()}-${m}`;
    });
    const [fxRateGhsPerUsd, setFxRateGhsPerUsd] = useState(null);
    const [fxLoading, setFxLoading] = useState(true);
    const [fxError, setFxError] = useState(null);

    useEffect(() => {
        const fetchFx = async () => {
            try {
                const response = await api.get('/settings/exchangeRates');
                setFxLoading(false);
                if (response.success && response.data && response.data.rates) {
                    const list = response.data.rates;
                    const current = list.find(r => r.month === fxMonthKey);
                    const rate = current ? Number(current.usdToGhs) : null;
                    setFxRateGhsPerUsd(isFinite(rate) && rate > 0 ? rate : null);
                }
            } catch (err) { 
                console.error("FX Load Error:", err);
                setFxLoading(false); 
                setFxError(err.message); 
            }
        };
        fetchFx();
    }, [fxMonthKey]);

    const convertAmountForQuote = (amountGhs) => {
        try {
            const n = Number(amountGhs) || 0;
            if (quoteCurrency === 'USD') {
                if (!fxRateGhsPerUsd) return 0;
                return Number((n / fxRateGhsPerUsd).toFixed(2));
            }
            return Number(n.toFixed(2));
        } catch (e) { return 0; }
    };

    const formatAmountForQuote = (amountGhs) => {
        try {
            const val = convertAmountForQuote(amountGhs);
            if (quoteCurrency === 'USD') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
            return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(val);
        } catch (e) { return '0.00'; }
    };

    useEffect(() => { if (chatContainerRef.current) { chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight; } }, [chatHistory]);
    const customerDropdownRef = useRef(null);
    useEffect(() => {
        // AUTO-SELECT REMOVED to prevent errors
        // if (customers.length > 0 && !selectedCustomer) { setSelectedCustomer(customers[0]); setCustomerSearch(customers[0].name); } 
    }, [customers, selectedCustomer]);
    useEffect(() => { const handleClickOutside = (event) => { if (customerDropdownRef.current && !customerDropdownRef.current.contains(event.target)) { setIsCustomerDropdownOpen(false); } }; document.addEventListener("mousedown", handleClickOutside); return () => document.removeEventListener("mousedown", handleClickOutside); }, []);

    const filteredInventory = useMemo(() => inventory.filter(item => item.name.toLowerCase().includes(searchTerm.toLowerCase()) || item.id.toLowerCase().includes(searchTerm.toLowerCase())).map(item => ({ ...item, displayPrice: getItemPrice(item) })), [inventory, searchTerm, pricingData]);
    const filteredCustomers = useMemo(() => customers.filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase())), [customers, customerSearch]);

    const totals = useMemo(() => {
        const result = {};
        const subtotal = quoteItems.reduce((acc, item) => acc + (Number(item.finalPrice || getItemPrice(item) || 0) * Number(item.quantity || 0)), 0);
        result.subtotal = subtotal;
        const shipping = Number(orderCharges.shipping || 0);
        const handling = Number(orderCharges.handling || 0);
        const discount = Number(orderCharges.discount || 0);
        result.shipping = shipping; result.handling = handling; result.discount = discount;
        const subtotalWithCharges = subtotal + shipping + handling - discount;
        result.subtotalWithCharges = subtotalWithCharges;
        let levyTotal = subtotalWithCharges;
        taxes.filter(t => t.on === 'subtotal' && t.enabled).forEach(t => { const taxAmount = subtotalWithCharges * (Number(t.rate || 0) / 100); result[t.id] = taxAmount; result[`${t.id}_rate`] = t.rate; levyTotal += taxAmount; });
        result.levyTotal = levyTotal;
        let grandTotal = levyTotal;
        taxes.filter(t => t.on === 'levyTotal' && t.enabled).forEach(t => { const taxAmount = levyTotal * (Number(t.rate || 0) / 100); result[t.id] = taxAmount; result[`${t.id}_rate`] = t.rate; grandTotal += taxAmount; });
        result.grandTotal = grandTotal;
        return result;
    }, [quoteItems, taxes, pricingData, orderCharges]);

    const handleConfirmAddItem = (item, quantity) => {
        const finalPrice = getItemPrice(item);
        setQuoteItems(currentItems => {
            const existing = currentItems.find(i => i.id === item.id);
            if (existing) return currentItems.map(i => i.id === item.id ? { ...i, quantity: i.quantity + quantity, isBackorder: item.stock < (i.quantity + quantity), finalPrice } : i);
            return [...currentItems, { ...item, quantity, isBackorder: item.stock < quantity, finalPrice }];
        });
        setAddingItem(null);
    };
    const handleUpdateQuantity = (itemId, newQuantityStr) => {
        const newQuantity = Math.max(0, parseInt(newQuantityStr, 10) || 0);
        const itemToUpdate = quoteItems.find(i => i.id === itemId);
        const inventoryItem = inventory.find(i => i.id === itemId);
        if (!itemToUpdate || !inventoryItem) return;
        if (newQuantity === 0) { handleRequestRemoveItem(itemToUpdate); return; }
        const finalPrice = getItemPrice(inventoryItem);
        setQuoteItems(currentItems => currentItems.map(i => i.id === itemId ? { ...i, quantity: newQuantity, isBackorder: inventoryItem.stock < newQuantity, finalPrice } : i));
    };
    const handleRequestRemoveItem = (itemToRemove) => setRemovingItem(itemToRemove);
    const handleConfirmRemoveItem = () => { if (!removingItem) return; setQuoteItems(currentItems => currentItems.filter(item => item.id !== removingItem.id)); setRemovingItem(null); };
    const handleSelectCustomer = (customer) => { setSelectedCustomer(customer); setCustomerSearch(customer.name); setIsCustomerDropdownOpen(false); };
    const handleRequestAddItem = (itemToAdd) => { setAddingItem(itemToAdd); };

    const applyFormatting = (kind) => {
        if (!textAreaRef.current) return;
        const start = textAreaRef.current.selectionStart;
        const end = textAreaRef.current.selectionEnd;
        const text = userInput;
        let before = text.substring(0, start);
        let selected = text.substring(start, end);
        let after = text.substring(end);
        let newText = text;
        if (kind === 'bold') newText = `${before}**${selected}**${after}`;
        else if (kind === 'bullet') newText = selected ? `${before}${selected.split('\n').map(l => `* ${l}`).join('\n')}${after}` : `${before}\n* ${after}`;
        setUserInput(newText);
        textAreaRef.current.focus();
    };

    const validateUserInput = (input) => {
        if (!input || input.trim().length === 0) return false;
        if (input.length > 500) { alert("Message too long (max 500 chars)."); return false; }
        if (/<script|onload|onerror/i.test(input)) { alert("Invalid input detected."); return false; }
        return true;
    };

    const renderBuildingAnalysisBOM = (buildingAnalysis) => {
        if (!buildingAnalysis || !buildingAnalysis.bom || buildingAnalysis.bom.length === 0) return null;
        const handleAddAllToQuote = () => {
            buildingAnalysis.bom.forEach(bomItem => {
                const inventoryItem = inventory.find(i => i.name.toLowerCase().includes(bomItem.item.toLowerCase()));
                if (inventoryItem) handleConfirmAddItem(inventoryItem, bomItem.quantity);
            });
            setChatHistory(prev => [...prev, { role: 'system', content: `Added ${buildingAnalysis.bom.length} items from building analysis to the quote.` }]);
        };
        return (
            <div className="mt-4 bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h4 className="font-semibold text-blue-800 mb-2 flex items-center"><Icon id="clipboard-list" className="mr-2" />Building Analysis BOM</h4>
                <div className="text-sm text-blue-700 mb-3">Based on the analysis, here are the estimated materials needed:</div>
                <div className="bg-white rounded border border-blue-100 overflow-hidden mb-3">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-blue-100 text-blue-800"><tr><th className="p-2">Item</th><th className="p-2 text-center">Qty</th><th className="p-2 text-right">Est. Cost</th></tr></thead>
                        <tbody>{buildingAnalysis.bom.map((item, idx) => (<tr key={idx} className="border-b border-blue-50 last:border-0"><td className="p-2">{item.item}</td><td className="p-2 text-center">{item.quantity}</td><td className="p-2 text-right">{formatCurrency(item.currency, item.estimatedCost)}</td></tr>))}</tbody>
                    </table>
                </div>
                <button onClick={handleAddAllToQuote} className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors">Add All to Quote</button>
            </div>
        );
    };

    const handleSendMessage = async () => {
        if (!validateUserInput(userInput)) return;
        if (isAiLoading) return;
        const message = userInput;
        setUserInput('');
        setIsAiLoading(true);
        setChatHistory(prev => [...prev, { role: 'user', content: message }]);
        try {
            // Route AI requests through secure backend /api/ai/chat endpoint
            const res = await api.post('/ai/chat', {
                message,
                context: {
                    inventory: inventory.map(item => ({ id: item.id, name: item.name, sku: item.sku, price: item.price, stock: item.stock })),
                    quoteItems: quoteItems.map(item => ({ sku: item.id, name: item.name, quantity: item.quantity, unitPrice: item.finalPrice || item.price })),
                    selectedCustomer: selectedCustomer ? { name: selectedCustomer.name, country: 'Ghana' } : null,
                    taxSettings: taxesData
                }
            });
            if (res.success && res.response) {
                setChatHistory(prev => [...prev, { role: 'assistant', content: res.response }]);
            } else {
                setChatHistory(prev => [...prev, { role: 'assistant', content: 'I encountered an issue processing your request. Please try again.' }]);
            }
        } catch (error) {
            let errorMessage = 'Sorry, I encountered an error processing your request.';
            if (error.message?.includes('401') || error.message?.includes('Unauthorized')) errorMessage = '⚠️ Authentication required. Please log in again.';
            else if (error.message?.includes('quota')) errorMessage = '⚠️ AI service quota exceeded. Please try again later.';
            setChatHistory(prev => [...prev, { role: 'system', content: errorMessage }]);
        } finally { setIsAiLoading(false); }
    };

    const formatBuildingAnalysisResponse = (result) => {
        if (!result || !result.output || !result.output.bom || !result.output.bom.lineItems) return 'Analysis failed. Please try again.';
        const { buildingSpec, infrastructure, bom, confidence } = result.output;
        let response = `## 🏗️ Building Analysis Complete\n\n`;
        if (buildingSpec) response += `**Building Specifications:**\n• Type: ${buildingSpec.type || 'N/A'}\n• Floors: ${buildingSpec.floors || 'N/A'}\n• Area: ${buildingSpec.totalArea || 'N/A'} sqm\n• Users: ${buildingSpec.users || 'N/A'}\n\n`;
        if (infrastructure) {
            response += `**Infrastructure Requirements:**\n`;
            if (infrastructure.access_control) response += `• Access Control: ${infrastructure.access_control.readers || 0} readers, ${infrastructure.access_control.controllers || 0} controllers\n`;
            if (infrastructure.cctv) response += `• CCTV: ${infrastructure.cctv.cameras || 0} cameras, ${infrastructure.cctv.nvr || 0} NVRs\n`;
            if (infrastructure.network) response += `• Network: ${infrastructure.network.dataPoints || 0} data points, ${infrastructure.network.switches || 0} switches\n`;
            response += `\n`;
        }
        response += `**Bill of Materials:** (${bom.lineItems.length} items)\n\n`;
        bom.lineItems.slice(0, 10).forEach((item, idx) => {
            const price = item.actualPrice || item.unitPrice || item.price || 0;
            response += `${idx + 1}. **${item.description || item.name || item.sku}** × ${item.quantity} @ GHS ${price.toFixed(2)} = GHS ${(price * item.quantity).toFixed(2)}\n`;
        });
        if (bom.lineItems.length > 10) response += `\n... and ${bom.lineItems.length - 10} more items\n`;
        if (bom.costs) response += `\n**Cost Estimate:**\n• Total: ${quoteCurrency} ${(bom.costs.total || 0).toFixed(2)}\n\n`;
        if (confidence) response += `📊 Confidence: ${(confidence * 100).toFixed(0)}%\n\n`;
        response += `_Click "Add to Quote" below to add all items._`;
        return response;
    };

    const formatCostRecommendations = (recommendations) => {
        if (!recommendations) return 'No recommendations available.';
        let response = `## 💰 Cost Recommendations\n\n`;
        if (recommendations.freight) response += `**Shipping & Freight:**\n• Method: ${recommendations.freight.method}\n• Cost: ${quoteCurrency} ${(recommendations.freight.estimatedCost || 0).toFixed(2)}\n\n`;
        if (recommendations.duties) response += `**Import Duties & Taxes:**\n• Rate: ${recommendations.duties.percentage}%\n• Amount: ${quoteCurrency} ${(recommendations.duties.estimatedAmount || 0).toFixed(2)}\n\n`;
        if (recommendations.markupRecommendation) response += `**Suggested Markup:**\n• Percentage: ${recommendations.markupRecommendation.percentage}%\n`;
        return response;
    };

    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [pendingInvoicePayload, setPendingInvoicePayload] = useState(null);

    // --- VIRTUAL INVENTORY STATE ---
    const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
    const [customItem, setCustomItem] = useState({ name: '', description: '', quantity: 1 });

    const handleAddCustomItem = () => {
        if (!customItem.name) return alert("Please enter an item name");

        const newItem = {
            id: `SOURCED-${Date.now()}`,
            name: customItem.name,
            description: customItem.description || 'Sourced Item',
            quantity: Number(customItem.quantity),
            price: 0, // Zero price triggers "Pending Pricing" status
            type: 'sourced', // Flags this as non-inventory
            isCustom: true
        };

        setQuoteItems(prev => [...prev, newItem]);
        setIsCustomModalOpen(false);
        setCustomItem({ name: '', description: '', quantity: 1 });
    };

    const openPreview = () => {
        if (quoteItems.length === 0) { alert("Add items to the quote first."); return; }
        // Validation check for customer
        if (!selectedCustomer) { alert("Please select a customer before proceeding."); return; }
        // Block USD quotes when no exchange rate is set — would save zero values to DB
        if (quoteCurrency === 'USD' && !fxRateGhsPerUsd) {
            alert(`Cannot submit a USD quote — no exchange rate is set for ${fxMonthKey}.\n\nPlease go to Settings → Exchange Rates and add the GHS/USD rate for this month, or switch the quote back to GHS.`);
            return;
        }
        let payload = { customer: selectedCustomer, items: quoteItems, subtotal: totals.subtotal, taxes: taxes, taxConfig: taxes, totals: totals, orderCharges: orderCharges, currency: quoteCurrency, date: new Date().toLocaleDateString(), dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString() };
        if (quoteCurrency === 'USD' && fxRateGhsPerUsd) {
            const convertedItems = quoteItems.map(item => ({ ...item, price: (Number(item.finalPrice || item.price) || 0) / fxRateGhsPerUsd, finalPrice: (Number(item.finalPrice || item.price) || 0) / fxRateGhsPerUsd }));
            const convertedTotals = {};
            Object.keys(totals).forEach(key => { if (key.endsWith('_rate')) convertedTotals[key] = totals[key]; else convertedTotals[key] = (Number(totals[key]) || 0) / fxRateGhsPerUsd; });
            const convertedOrderCharges = { shipping: (Number(orderCharges.shipping) || 0) / fxRateGhsPerUsd, handling: (Number(orderCharges.handling) || 0) / fxRateGhsPerUsd, discount: (Number(orderCharges.discount) || 0) / fxRateGhsPerUsd };
            payload = { ...payload, items: convertedItems, totals: convertedTotals, subtotal: convertedTotals.subtotal, orderCharges: convertedOrderCharges };
        }
        setPendingInvoicePayload(payload);
        setIsPreviewOpen(true);
    };


    const handleSubmitForApproval = async () => {
        if (!userId) return;
        try {
            const tempId = generateTemporaryId();

            // Check if pricing is unknown (sourced items need procurement to determine cost)
            const needsPricing = quoteItems.some(item => item.type === 'sourced' || item.price === 0);
            // Check if any item is a backorder (price known, but stock insufficient)
            const hasBackorders = quoteItems.some(item => {
                if (item.type === 'sourced') return false; // already covered by needsPricing
                const stock = Number(item.stock ?? Infinity);
                return item.quantity > 0 && item.quantity > stock;
            });
            // Sourced items need pricing first; backorders need procurement but price is known
            const initialStatus = needsPricing ? 'Pending Pricing' : 'Pending Approval';
            const requiresProcurement = needsPricing || hasBackorders;

            const invoiceData = {
                id: tempId,
                invoiceNumber: tempId,
                customerId: selectedCustomer.id,
                customerName: selectedCustomer.name,
                customerEmail: selectedCustomer.email || '',
                date: new Date().toLocaleDateString(),
                dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString(),
                status: initialStatus,
                lineItems: quoteItems.map(item => ({
                    id: item.id,
                    description: item.name,
                    quantity: item.quantity,
                    unitPrice: item.finalPrice || item.price,
                    totalPrice: (item.finalPrice || item.price) * item.quantity,
                    type: item.type || 'inventory',
                    stock: item.stock ?? null,
                    isBackorder: item.isBackorder || false
                })),
                subtotal: totals.subtotal,
                taxes: totals.grandTotal - totals.subtotal, // simplified for now
                taxBreakdown: taxes.filter(t => t.enabled).map(t => ({ id: t.id, name: t.name, rate: t.rate, amount: totals[t.id] || 0 })),
                orderCharges: orderCharges,
                total: totals.grandTotal,
                currency: quoteCurrency,
                exchangeRate: fxRateGhsPerUsd,
                createdBy: userId,
                requiresProcurement: requiresProcurement,
                hasBackorders: hasBackorders
            };

            await api.post('/invoices', invoiceData);
            await logActivity(userId, 'Create Quote', `Quote for ${selectedCustomer.name}`, { id: tempId, customerName: selectedCustomer.name, amount: totals.grandTotal });

            let successMsg = 'Quote submitted for Approval!';
            if (needsPricing && hasBackorders) successMsg = 'Quote submitted for Pricing! Purchase requisitions created for sourced & backorder items.';
            else if (needsPricing) successMsg = 'Quote submitted for Pricing!';
            else if (hasBackorders) successMsg = 'Quote submitted for Approval! Purchase requisitions created for backorder items.';
            setNotification({ type: 'success', message: successMsg });

            setQuoteItems([]); setSelectedCustomer(null); setCustomerSearch(''); setOrderCharges({ shipping: 0, handling: 0, discount: 0 });
            setTimeout(() => setNotification(null), 3000);
        } catch (error) { console.error('Failed to submit quote:', error); setNotification({ type: 'error', message: 'Failed to submit quote. Please try again.' }); }
    };

    // const formatCurrency = (currency, amount) => { return new Intl.NumberFormat('en-GH', { style: 'currency', currency: currency }).format(amount); };

    return (
        <>
            {notification && (<div className={`mb-6 p-4 rounded-md ${notification.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>{notification.message}</div>)}
            <PageHeader
                title="New Quote"
                subtitle="Create a new sales quote for approval"
                actions={
                    <Button variant="ghost" size="sm" onClick={() => navigateTo('salesDashboard')} leftIcon={<Icon id="times" />}>
                        Cancel
                    </Button>
                }
            />
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-[calc(100vh-140px)]">
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-white p-6 rounded-xl shadow-md flex flex-col">
                            <h2 className="text-xl font-semibold text-gray-700 mb-4 flex items-center"><Icon id="search" className="mr-3 text-gray-400" />Product Catalog</h2>
                            <div className="relative mb-4">
                                <input type="text" placeholder="Search products..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all" />
                                <Icon id="search" className="absolute left-3 top-2.5 text-gray-400 w-4 h-4" />
                            </div>

                            {/* VIRTUAL INVENTORY BUTTON */}
                            <div className="mb-4">
                                <button
                                    onClick={() => setIsCustomModalOpen(true)}
                                    className="w-full py-2 border-2 border-dashed border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 flex items-center justify-center font-medium transition-colors"
                                >
                                    <Icon id="plus" className="mr-2" /> Add Sourced / Custom Item
                                </button>
                            </div>
                            <div className="h-[400px] overflow-y-auto border border-gray-100 rounded-lg">
                                <table className="w-full text-left">
                                    <thead className="bg-gray-50 sticky top-0 z-10"><tr><th className="p-3 font-semibold text-xs text-gray-500 uppercase tracking-wider">Product</th><th className="p-3 font-semibold text-xs text-gray-500 uppercase tracking-wider text-center">Stock</th><th className="p-3 font-semibold text-xs text-gray-500 uppercase tracking-wider text-right">Price</th></tr></thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {filteredInventory.map(item => (
                                            <tr key={item.id} onClick={() => handleRequestAddItem(item)} className="hover:bg-blue-50 cursor-pointer transition-colors group" title="Click to add to quote">
                                                <td className="p-3"><div className="font-medium text-gray-900 text-sm">{item.name}</div><div className="text-xs text-gray-400 group-hover:text-blue-500">{item.id}</div></td>
                                                <td className={`p-3 text-center font-medium text-sm ${item.stock < 0 ? 'text-red-600' : item.stock <= item.restockLimit ? 'text-orange-600' : 'text-green-600'}`}>{item.stock}</td>
                                                <td className="p-3 text-right text-sm font-medium text-gray-700">{formatCurrency(quoteCurrency, item.displayPrice || item.price)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                    <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-md h-full flex flex-col">
                        <h2 className="text-xl font-semibold text-gray-700 mb-4">Current Quote</h2>
                        {/* UPDATED CUSTOMER INPUT */}
                        <div className="mb-4 relative" ref={customerDropdownRef}>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Customer <span className="text-red-500">*</span></label>
                            <input
                                type="text"
                                value={customerSearch}
                                onChange={(e) => {
                                    setCustomerSearch(e.target.value);
                                    setIsCustomerDropdownOpen(true);
                                    // Reset selected if user modifies text
                                    if (selectedCustomer && e.target.value !== selectedCustomer.name) {
                                        setSelectedCustomer(null);
                                    }
                                }}
                                onFocus={() => setIsCustomerDropdownOpen(true)}
                                className={`w-full mt-1 pl-3 pr-10 py-2 border rounded-md focus:ring-blue-500 ${!selectedCustomer && customerSearch === '' ? 'border-gray-300' : 'border-gray-300'}`}
                                placeholder="Search or select a customer..."
                            />
                            {isCustomerDropdownOpen && (<ul className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-60 overflow-y-auto">{filteredCustomers.length > 0 ? filteredCustomers.map(c => (<li key={c.id} onClick={() => handleSelectCustomer(c)} className="px-4 py-2 hover:bg-blue-50 cursor-pointer">{c.name}</li>)) : <li className="px-4 py-2 text-gray-500">No customers found</li>}</ul>)}
                        </div>
                        <div className="flex-1 overflow-y-auto border rounded-md mb-4">{quoteItems.length > 0 ? (<table className="w-full text-left"><thead className="bg-gray-50 sticky top-0"><tr><th className="p-2 font-semibold text-sm">Item</th><th className="p-2 font-semibold text-sm text-center">Qty</th><th className="p-2 font-semibold text-sm text-right">Unit Price</th><th className="p-2 font-semibold text-sm text-center">Action</th></tr></thead><tbody>{quoteItems.map(item => (<tr key={item.id} className="border-b"><td className="p-2 text-sm font-medium">{item.name}{item.isBackorder && <span className="ml-2 text-xs font-semibold text-yellow-800 bg-yellow-200 px-2 py-0.5 rounded-full">Backorder</span>}{item.type === 'sourced' && <span className="ml-2 text-xs font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">Awaiting Procurement</span>}</td><td className="p-2 text-center"><input type="number" value={item.quantity} onChange={e => handleUpdateQuantity(item.id, e.target.value)} className="w-16 text-center border-gray-300 rounded-md" min="0" /></td><td className="p-2 text-right text-sm">{formatAmountForQuote(item.finalPrice || item.price)}</td><td className="p-2 text-center"><button onClick={() => handleRequestRemoveItem(item)} className="text-red-600 hover:text-red-800 font-medium text-sm py-1 px-3 border border-red-200 rounded hover:bg-red-50 transition-colors">Remove</button></td></tr>))}</tbody></table>) : (<div className="h-full flex items-center justify-center text-gray-500"><p>Use the AI assistant or add items manually.</p></div>)}</div>
                        <div className="border-t pt-4 space-y-2 mt-auto">
                            <div className="flex justify-between text-lg"><span className="font-semibold">GROSS TOTAL</span><span className="font-semibold">{formatAmountForQuote(totals.subtotal)}</span></div>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between"><span>Shipping:</span><span>{formatAmountForQuote(totals.shipping)}</span></div>
                                <div className="flex justify-between"><span>Handling:</span><span>{formatAmountForQuote(totals.handling)}</span></div>
                                <div className="flex justify-between"><span>Discount:</span><span className="text-red-600">-{formatAmountForQuote(totals.discount)}</span></div>
                            </div>
                            <div className="border-t pt-2"><div className="flex justify-between font-semibold"><span>Taxable Amount</span><span>{formatAmountForQuote(totals.subtotalWithCharges)}</span></div></div>
                            {taxes.filter(t => t.enabled && t.on === 'subtotal').map(tax => (<div key={tax.id} className="flex justify-between text-sm text-gray-500"><span>{tax.name} ({tax.rate}%)</span><span>{formatAmountForQuote(totals[tax.id] || 0)}</span></div>))}
                            <div className="flex justify-between font-semibold border-t pt-2"><span>Subtotal (Before VAT)</span><span>{formatAmountForQuote(totals.levyTotal)}</span></div>
                            {taxes.filter(t => t.enabled && t.on === 'levyTotal').map(tax => (<div key={tax.id} className="flex justify-between text-sm text-gray-500"><span>{tax.name} ({tax.rate}%)</span><span>{formatAmountForQuote(totals[tax.id] || 0)}</span></div>))}
                            <div className="flex justify-between text-xl font-bold border-t pt-2 mt-2"><span>Total Amount Payable</span><span>{formatAmountForQuote(totals.grandTotal)}</span></div>
                        </div>
                        <div className="mt-6 space-y-2">
                            <div className="flex items-center justify-end mb-2">
                                <button onClick={toggleQuoteCurrency} className={`relative inline-flex items-center h-9 w-32 px-2 rounded-full transition-colors duration-500 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-300 ${quoteCurrency === 'USD' ? 'bg-blue-700' : 'bg-blue-700'}`} aria-pressed={quoteCurrency === 'USD'} title="Toggle currency between GHS and USD">
                                    <span className="absolute inset-0 flex items-center justify-center text-white text-xs font-extrabold tracking-wide select-none">{quoteCurrency}</span>
                                    <span className={`absolute top-1 h-7 w-7 bg-white rounded-full shadow-md transition-all duration-500 ease-in-out ${quoteCurrency === 'USD' ? 'right-1' : 'left-1'}`} />
                                </button>
                            </div>
                            <div className="flex justify-end -mt-1 mb-3">
                                <div className="text-xs px-3 py-1 rounded-md border border-blue-200 bg-blue-50 text-blue-800" title="Monthly USD→GHS rate being used for conversion">
                                    {fxLoading ? <span>Loading rate…</span> : fxError ? <span>Rate error</span> : fxRateGhsPerUsd ? <span>{`Rate ${fxMonthKey}: GHS ${Number(fxRateGhsPerUsd).toFixed(4)} / USD`}</span> : <span>No rate set for {fxMonthKey}</span>}
                                </div>
                            </div>
                            <button onClick={openPreview} className="w-full py-3 px-4 border-transparent rounded-md text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300" disabled={quoteItems.length === 0 || !selectedCustomer}><Icon id="eye" className="mr-2" /> Preview & Submit</button>
                        </div>
                    </div>
                </div>
            {addingItem && (<QuantityModal item={addingItem} onClose={() => setAddingItem(null)} onConfirm={handleConfirmAddItem} />)}
            {removingItem && (<ConfirmationModal title="Remove Item" message={`Are you sure you want to remove "${removingItem.name}" from the quote?`} onConfirm={handleConfirmRemoveItem} onCancel={() => setRemovingItem(null)} confirmText="Remove" confirmColor="bg-red-600 hover:bg-red-700" />)}
            {isPreviewOpen && pendingInvoicePayload && (<PreviewModal open={isPreviewOpen} payload={pendingInvoicePayload} mode="invoice" onClose={() => setIsPreviewOpen(false)} onConfirm={async () => { setIsPreviewOpen(false); await handleSubmitForApproval(); }} />)}

            {/* ADD SOURCED ITEM MODAL */}
            {isCustomModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white p-6 rounded-xl shadow-xl w-96">
                        <h3 className="text-lg font-bold mb-4 text-gray-800">Add Sourced Item</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Item Name</label>
                                <input type="text" className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500" value={customItem.name} onChange={e => setCustomItem({ ...customItem, name: e.target.value })} placeholder="e.g. 360 Fisheye Camera" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Description</label>
                                <input type="text" className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500" value={customItem.description} onChange={e => setCustomItem({ ...customItem, description: e.target.value })} placeholder="Vendor/Specs..." />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Quantity</label>
                                <input type="number" className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500" value={customItem.quantity} onChange={e => setCustomItem({ ...customItem, quantity: e.target.value })} min="1" />
                            </div>
                        </div>
                        <div className="mt-6 flex justify-end space-x-3">
                            <button onClick={() => setIsCustomModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                            <button onClick={handleAddCustomItem} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Add Item</button>
                        </div>
                    </div>
                </div>
            )}
            <div className="fixed z-50 flex flex-col items-end" style={{ left: bubblePos.x, top: bubblePos.y, cursor: isDragging ? 'grabbing' : 'pointer' }}>
                {isAiChatOpen && (
                    <div className="mb-4 w-96 h-[500px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden animate-fade-in-up transition-all transform origin-bottom-right absolute bottom-16 right-0">
                        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-4 flex justify-between items-center text-white cursor-move" onMouseDown={handleBubbleMouseDown}>
                            <div className="flex items-center">
                                <div className="bg-white/20 p-1.5 rounded-lg mr-3"><img src={companyLogo} alt="AI" className="w-5 h-5 object-contain" /></div>
                                <div><h3 className="font-semibold text-sm">AI Assistant</h3><p className="text-xs text-blue-100 opacity-90">Always here to help</p></div>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); setIsAiChatOpen(false); }} className="text-white/80 hover:text-white hover:bg-white/10 p-1 rounded-full transition-colors"><Icon id="times" className="w-5 h-5" /></button>
                        </div>
                        <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
                            {chatHistory.length === 0 && (<div className="text-center mt-12 px-6"><div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"><img src={companyLogo} alt="AI" className="w-10 h-10 object-contain" /></div><h4 className="text-gray-800 font-medium mb-2">How can I help?</h4><p className="text-sm text-gray-500">Try asking me to "Analyze a building requirement" or "Recommend products for a roof".</p></div>)}
                            {chatHistory.map((msg, idx) => (<div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[85%] p-3 rounded-2xl text-sm shadow-sm ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-none' : msg.role === 'system' ? 'bg-gray-200 text-gray-800 text-xs italic mx-auto' : 'bg-white text-gray-800 border border-gray-100 rounded-bl-none'}`}>{msg.role === 'assistant' ? (<div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1">{msg.content.split('\n').map((line, i) => (<p key={i} className="mb-1 last:mb-0">{line}</p>))}</div>) : (msg.content)}{msg.buildingAnalysis && renderBuildingAnalysisBOM(msg.buildingAnalysis)}</div></div>))}
                            {isAiLoading && (<div className="flex justify-start"><div className="bg-white p-3 rounded-2xl rounded-bl-none shadow-sm border border-gray-100"><div className="flex space-x-1.5"><div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div><div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div><div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div></div></div></div>)}
                        </div>
                        <div className="p-3 bg-white border-t border-gray-100" onMouseDown={(e) => e.stopPropagation()}>
                            <div className="flex space-x-1 mb-2 px-1"><button onClick={() => applyFormatting('bold')} className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors" title="Bold"><Icon id="bold" className="w-3 h-3" /></button><button onClick={() => applyFormatting('bullet')} className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors" title="Bullet List"><Icon id="list-ul" className="w-3 h-3" /></button></div>
                            <div className="flex items-end space-x-2"><textarea ref={textAreaRef} value={userInput} onChange={(e) => setUserInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} placeholder="Type your message..." className="flex-1 p-2.5 bg-gray-50 border-0 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white resize-none text-sm max-h-32 transition-all" rows="1" style={{ minHeight: '44px' }} /><button onClick={handleSendMessage} disabled={!userInput.trim() || isAiLoading} className={`p-2.5 rounded-xl flex-shrink-0 transition-all shadow-sm ${!userInput.trim() || isAiLoading ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-md hover:scale-105 active:scale-95'}`}>{isAiLoading ? (<div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>) : (<Icon id="paper-plane" className="w-5 h-5" />)}</button></div>
                        </div>
                    </div>
                )}
                <button onMouseDown={handleBubbleMouseDown} onClick={() => { if (!hasDragged) setIsAiChatOpen(!isAiChatOpen); }} className={`group flex items-center justify-center w-14 h-14 rounded-full shadow-lg transition-all duration-300 hover:scale-110 focus:outline-none focus:ring-4 focus:ring-blue-300 ${isAiChatOpen ? 'bg-gray-800 text-white rotate-90' : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:shadow-blue-500/30'}`} title={isAiChatOpen ? "Close Assistant" : "Open AI Assistant"}>
                    {isAiChatOpen ? (<Icon id="times" className="w-6 h-6 transition-transform duration-300 -rotate-90" />) : (<img src={companyLogo} alt="AI" className="w-8 h-8 object-contain" />)}
                    {!isAiChatOpen && chatHistory.length > 0 && (<span className="absolute top-0 right-0 w-4 h-4 bg-red-500 border-2 border-white rounded-full"></span>)}
                </button>
            </div>
        </>
    );
};

export default QuotingModule;
