# Enhanced Quote System - User Training Guide

## 🎯 Overview

The Enhanced Quote System transforms your basic quote creation into a professional, industry-standard process with proper cost breakdown, server-side validation, and AI assistance.

## 👨‍💼 Controller Training

### Pricing Management Dashboard

#### Accessing Pricing Management
1. Login as Controller
2. From the main dashboard, click **"Pricing Management"**
3. You'll see two tabs: **Inventory Costs** and **Pricing Settings**

#### Managing Inventory Costs

**Purpose**: Set cost components for each inventory item to ensure accurate quote pricing.

**Step-by-Step Process**:

1. **Navigate to Inventory Costs Tab**
   - View all inventory items in a table format
   - See current cost component status for each item

2. **Edit Cost Components**
   - Click **"Edit Costs"** for any inventory item
   - Fill in the cost breakdown:
     - **Base Cost (GHS)**: The fundamental cost of the item (required)
     - **Weight (kg)**: For shipping allocation calculations
     - **Inbound Freight**: Cost per unit for bringing item to warehouse
     - **Duty**: Import duty cost per unit
     - **Insurance**: Insurance cost per unit
     - **Packaging**: Packaging cost per unit
     - **Other Charges**: Any additional costs per unit
     - **Markup Override (%)**: Special markup for this item (optional)
     - **Pricing Tier**: Standard, Premium, or Budget

3. **Save Changes**
   - Click **"Save Changes"** to update the item
   - Changes are immediately available for quote calculations

**Example Cost Breakdown**:
```
Laser Printer Model X:
- Base Cost: GHS 400.00
- Weight: 8.2 kg
- Inbound Freight: GHS 20.00
- Duty: GHS 10.00
- Insurance: GHS 1.50
- Packaging: GHS 3.00
- Other: GHS 21.00
- Total Landed Cost: GHS 455.50
```

#### Managing Global Pricing Settings

**Purpose**: Configure system-wide pricing rules and approval thresholds.

**Step-by-Step Process**:

1. **Navigate to Pricing Settings Tab**
   - Configure default markup percentage (e.g., 32%)
   - Set pricing mode: Markup or Margin
   - Choose allocation method for shipping costs

2. **Configure Allocation Methods**
   - **By Weight**: Distribute shipping costs based on item weight
   - **By Value**: Distribute shipping costs based on item value
   - **Equal Distribution**: Distribute shipping costs equally among items

3. **Set Approval Thresholds**
   - **Minimum Margin (%)**: Require approval if margin falls below this
   - **Maximum Discount (%)**: Require approval for discounts above this
   - **Approval Above (GHS)**: Require approval for orders above this value

4. **Configure Tax Settings**
   - Set default tax rate (e.g., 12%)
   - Configure quote expiry period (e.g., 30 days)

**Best Practices**:
- Set realistic markup percentages based on your industry
- Use weight-based allocation for physical goods
- Set conservative approval thresholds initially
- Review and adjust settings based on business performance

## 👨‍💻 Salesperson Training

### Enhanced Quote Editor

#### Accessing Enhanced Quote Editor
1. Login as Salesperson
2. From the main dashboard, click **"Enhanced Quote Editor"**
3. You'll see a professional quote creation interface

#### Creating a Professional Quote

**Step-by-Step Process**:

1. **Select Customer**
   - Choose customer from dropdown
   - System automatically applies customer-specific settings
   - Select appropriate **Incoterm** (FOB, CIF, DDP, EXW)

2. **Add Products**
   - Browse available inventory items
   - Click **"Add to Quote"** for desired items
   - System automatically fetches cost components from inventory

3. **Configure Order-Level Charges**
   - **Shipping (GHS)**: Overall shipping cost for the order
   - **Handling (GHS)**: Handling fees
   - **Order Discount (GHS)**: Discount applied to entire order

4. **Calculate Quote**
   - Click **"Calculate Quote"** button
   - System performs server-side calculation with:
     - Landed cost calculation (base + freight + duty + insurance + packaging)
     - Markup application
     - Shipping allocation
     - Tax calculation
     - Margin analysis

5. **Review Cost Breakdown**
   - Toggle **"Show Internal Costs"** to see:
     - Base cost per item
     - Landed cost per item
     - Applied markup percentage
     - Final unit price
   - Review gross margin percentage
   - Ensure pricing meets approval thresholds

6. **Add Additional Information**
   - **Notes**: Additional information for the customer
   - **Terms & Conditions**: Specific terms for this quote

7. **Save or Send Quote**
   - **Save as Draft**: Save for later editing
   - **Send Quote**: Send to customer (sets status to "SENT")

#### Understanding Quote Lifecycle

**Quote Statuses**:
- **DRAFT**: Being prepared, not sent to customer
- **SENT**: Sent to customer, awaiting response
- **ACCEPTED**: Customer accepted the quote
- **EXPIRED**: Quote expired (past expiry date)
- **CANCELLED**: Quote cancelled
- **CONVERTED**: Converted to invoice

**Converting Quote to Invoice**:
1. Ensure quote status is "ACCEPTED"
2. Click **"Convert to Invoice"**
3. System creates invoice with exact quote values
4. No recalculation - preserves original pricing
5. Invoice goes to "Pending Approval" status

#### Using AI Recommendations

**AI Assistant Features**:
- Analyzes products and suggests freight costs
- Recommends shipping methods (air vs sea vs land)
- Suggests optimal markup based on customer tier
- Flags potential risks or unusual situations

**How to Use**:
1. Add products to quote
2. AI automatically analyzes and provides recommendations
3. Review suggestions in the recommendations panel
4. Accept or modify suggestions as needed
5. All recommendations are validated against business rules

## 🔍 Understanding Cost Components

### Landed Cost Calculation
```
Landed Cost = Base Cost + Inbound Freight + Duty + Insurance + Packaging + Other
```

### Pricing Calculation
```
Unit Price = Landed Cost × (1 + Markup%)
```

### Order Total Calculation
```
Subtotal = Sum(Unit Price × Quantity for all items)
Tax = (Subtotal + Shipping + Handling - Discount) × Tax Rate
Total = Subtotal + Shipping + Handling + Tax - Discount
```

### Margin Calculation
```
Gross Margin % = ((Subtotal - Total Landed Cost) / Subtotal) × 100
```

## 📋 Incoterms Guide

### EXW (Ex Works)
- **Seller's Responsibility**: Make goods available at seller's premises
- **Buyer's Responsibility**: All transportation, insurance, and import costs
- **Quote Impact**: Include only seller's costs

### FOB (Free On Board)
- **Seller's Responsibility**: Deliver goods to port, pay export costs
- **Buyer's Responsibility**: Transportation from port, import costs
- **Quote Impact**: Include seller's costs + export costs

### CIF (Cost, Insurance & Freight)
- **Seller's Responsibility**: Pay freight and insurance to destination port
- **Buyer's Responsibility**: Import costs and inland transportation
- **Quote Impact**: Include seller's costs + freight + insurance

### DDP (Delivered Duty Paid)
- **Seller's Responsibility**: All costs including duties and taxes
- **Buyer's Responsibility**: None
- **Quote Impact**: Include all costs including duties and taxes

## 🚨 Common Issues & Solutions

### Issue: "SKU not found" Error
**Cause**: Inventory item doesn't have cost components set
**Solution**: Controller needs to set cost components in Pricing Management

### Issue: Low Margin Warning
**Cause**: Quote margin below approval threshold
**Solution**: 
- Increase markup percentage
- Reduce costs if possible
- Get manager approval

### Issue: Calculation Errors
**Cause**: Missing or invalid data
**Solution**: 
- Check all required fields are filled
- Verify cost components are set
- Contact controller for data issues

### Issue: Quote Not Converting to Invoice
**Cause**: Quote status not "ACCEPTED"
**Solution**: 
- Ensure customer has accepted the quote
- Check quote expiry date
- Verify quote status

## 📊 Best Practices

### For Controllers
1. **Set Realistic Costs**: Use actual freight and duty rates
2. **Regular Updates**: Update cost components as rates change
3. **Monitor Margins**: Track margin performance across quotes
4. **Review Settings**: Periodically review pricing settings

### For Salespeople
1. **Verify Customer**: Always select correct customer
2. **Check Incoterms**: Ensure Incoterm matches customer agreement
3. **Review Calculations**: Always review cost breakdown before sending
4. **Follow Process**: Use proper quote lifecycle (Draft → Send → Accept → Invoice)

### General
1. **Data Accuracy**: Ensure all data is accurate and up-to-date
2. **Communication**: Communicate any issues or questions
3. **Training**: Stay updated on new features and changes
4. **Feedback**: Provide feedback for system improvements

## 🎯 Success Metrics

### For Controllers
- All inventory items have complete cost components
- Pricing settings are optimized for business goals
- Approval thresholds are appropriate
- Cost data is accurate and up-to-date

### For Salespeople
- Quotes are created efficiently and accurately
- Customer satisfaction with quote quality
- Proper quote lifecycle management
- Effective use of AI recommendations

## 📞 Support & Help

### Getting Help
1. **Check Documentation**: Review this guide and system documentation
2. **Browser Console**: Press F12 to check for errors
3. **Contact Controller**: For pricing and cost component issues
4. **System Admin**: For technical issues

### Reporting Issues
When reporting issues, include:
- What you were trying to do
- What happened instead
- Any error messages
- Screenshots if helpful
- Browser and system information

---

## 🎉 Training Complete!

You're now ready to use the Enhanced Quote System effectively. The system will help you create professional, accurate quotes that follow industry best practices while maintaining efficiency and ease of use.

Remember: The system is designed to work with your existing workflow while adding powerful new capabilities. Take time to explore the features and don't hesitate to ask questions as you get familiar with the new system.
