// Firebase Configuration and Optimization Settings
export const firebaseConfig = {
  // Your Firebase config here
  apiKey: "your-api-key",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "your-app-id"
};

// Required Firestore Indexes for Optimization
export const requiredIndexes = [
  // Invoices Collection
  {
    collection: 'invoices',
    fields: [
      { fieldPath: 'customerId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' }
    ]
  },
  {
    collection: 'invoices',
    fields: [
      { fieldPath: 'salespersonId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' }
    ]
  },
  {
    collection: 'invoices',
    fields: [
      { fieldPath: 'date', order: 'DESCENDING' }
    ]
  },
  {
    collection: 'invoices',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'date', order: 'DESCENDING' }
    ]
  },
  
  // Audit Logs Collection
  {
    collection: 'audit_logs',
    fields: [
      { fieldPath: 'timestamp', order: 'DESCENDING' }
    ]
  },
  {
    collection: 'audit_logs',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'timestamp', order: 'DESCENDING' }
    ]
  },
  {
    collection: 'audit_logs',
    fields: [
      { fieldPath: 'category', order: 'ASCENDING' },
      { fieldPath: 'timestamp', order: 'DESCENDING' }
    ]
  }
];

// Performance Optimization Settings
export const optimizationSettings = {
  // Pagination settings
  itemsPerPage: 20,
  maxItemsPerQuery: 1000,
  
  // Cache settings
  cacheDuration: 5 * 60 * 1000, // 5 minutes
  maxCacheSize: 100, // Maximum number of cached items
  
  // Debounce settings
  searchDebounceDelay: 300,
  
  // Real-time update settings
  enableRealTimeUpdates: true,
  realTimeUpdateInterval: 30000, // 30 seconds
  
  // Batch operation settings
  maxBatchSize: 500,
  
  // Query optimization
  enableQueryOptimization: true,
  enableIndexHints: true
};

// Database Structure Documentation
export const databaseStructure = {
  collections: {
    customers: {
      path: 'artifacts/{appId}/public/data/customers',
      fields: ['id', 'name', 'contactPerson', 'contactEmail', 'location', 'poBox', 'region', 'address'],
      indexes: ['name', 'contactEmail', 'region']
    },
    inventory: {
      path: 'artifacts/{appId}/public/data/inventory',
      fields: ['id', 'name', 'vendor', 'stock', 'price', 'restockLimit'],
      indexes: ['name', 'vendor', 'stock']
    },
    invoices: {
      path: 'artifacts/{appId}/public/data/invoices',
      fields: ['id', 'salespersonId', 'customerId', 'customerName', 'date', 'lineItems', 'total', 'taxes', 'status'],
      indexes: ['customerId', 'salespersonId', 'status', 'date']
    },
    audit_logs: {
      path: 'artifacts/{appId}/public/data/audit_logs',
      fields: ['timestamp', 'userId', 'action', 'details', 'category', 'sessionInfo'],
      indexes: ['timestamp', 'userId', 'category']
    },
    settings: {
      path: 'artifacts/{appId}/public/data/settings',
      fields: ['id', 'taxArray'],
      indexes: ['id']
    }
  }
};

// Query Optimization Guidelines
export const queryOptimizationGuidelines = {
  // Always use specific field queries instead of loading entire documents
  useFieldQueries: true,
  
  // Use compound queries for better performance
  useCompoundQueries: true,
  
  // Implement pagination for large datasets
  usePagination: true,
  
  // Cache frequently accessed data
  useCaching: true,
  
  // Use server-side filtering when possible
  useServerSideFiltering: true,
  
  // Implement debounced search
  useDebouncedSearch: true,
  
  // Use batch operations for bulk updates
  useBatchOperations: true
};

export default {
  firebaseConfig,
  requiredIndexes,
  optimizationSettings,
  databaseStructure,
  queryOptimizationGuidelines
};
