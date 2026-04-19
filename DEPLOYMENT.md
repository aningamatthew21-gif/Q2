# Firebase Functions Deployment Guide

## Overview
This project includes Firebase Cloud Functions for generating comprehensive Controller and Sales reports. The functions provide role-based access control and generate detailed business analytics.

## Prerequisites
1. Firebase CLI installed: `npm install -g firebase-tools`
2. Node.js 18+ (for functions)
3. Firebase project created

## Setup Steps

### 1. Initialize Firebase (if not already done)
```bash
firebase login
firebase init
```

### 2. Install Dependencies
```bash
# Root project dependencies
npm install

# Functions dependencies
cd functions
npm install
cd ..
```

### 3. Deploy Functions
```bash
firebase deploy --only functions
```

### 4. Deploy Storage Rules
```bash
firebase deploy --only storage
```

## Functions Overview

### generateFullReport
- **Type**: Callable Function
- **Purpose**: Generates comprehensive Controller or Sales reports
- **Access**: Role-based (controller/sales)
- **Returns**: JSON report with summary metrics, aging analysis, and detailed tables

### exportReportCsv
- **Type**: HTTP Function
- **Purpose**: Exports cached reports to CSV format
- **Access**: Public (with appId/reportId validation)
- **Returns**: Signed URL to CSV file in Cloud Storage

## Security Features

### Role-Based Access Control
- Controllers can access full financial data
- Sales users can access sales performance data
- Custom claims required: `role: 'controller'` or `role: 'sales'`

### Data Validation
- AppId validation for multi-tenant security
- Date range filtering
- Legacy data exclusion options

## Usage

### Frontend Integration
The ReportModal component is already integrated into:
- ControllerAnalyticsDashboard
- SalesAnalyticsDashboard

### API Calls
```javascript
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions();
const generateReport = httpsCallable(functions, 'generateFullReport');

const result = await generateReport({
  appId: 'your-app-id',
  role: 'controller', // or 'sales'
  startDate: '2024-01-01',
  endDate: '2024-12-31',
  includeLegacy: false
});
```

## Data Structure

### Report Output
```javascript
{
  meta: { appId, roleRequested, generatedBy, generatedAt, startDate, endDate },
  summary: { totalApprovedInvoicesCount, totalRecognizedRevenue, outstandingAR, ... },
  agingBuckets: { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 },
  invoices: [...],
  customerReconciliation: [...],
  cachedReportId: 'report-controller-1234567890'
}
```

## Performance Considerations

### For Large Datasets
- Functions are limited to 1000 invoices per query
- Consider implementing pagination for very large collections
- For production use with 10k+ invoices, consider BigQuery integration

### Caching
- Reports are automatically cached in Firestore
- CSV exports are stored in Cloud Storage
- Signed URLs expire after 1 hour

## Troubleshooting

### Common Issues
1. **Role Access Denied**: Ensure custom claims are set on user accounts
2. **Function Timeout**: Large datasets may cause timeouts; implement date filtering
3. **Storage Permission**: Ensure storage rules allow authenticated access to reports

### Debugging
- Check Firebase Functions logs: `firebase functions:log`
- Verify custom claims: `firebase auth:export`
- Test with small date ranges first

## Customization

### Adding New Metrics
1. Modify the `summary` object in `generateFullReport`
2. Update the ReportModal component to display new metrics
3. Add corresponding CSV export fields

### Modifying Report Logic
1. Edit aggregation logic in the Cloud Function
2. Update data filtering and calculations
3. Test with various data scenarios

## Production Considerations

### Monitoring
- Set up Firebase Function monitoring
- Monitor storage usage for CSV exports
- Track function execution times

### Scaling
- Consider BigQuery for analytics queries
- Implement report queuing for heavy workloads
- Add rate limiting for report generation

### Backup
- Reports are stored in Firestore for audit purposes
- CSV exports are stored in Cloud Storage
- Consider automated backup strategies 