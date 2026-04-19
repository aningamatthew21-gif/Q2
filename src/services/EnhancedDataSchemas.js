/**
 * Enhanced Data Schemas for Advanced AI Capabilities
 * These schemas extend the existing system without breaking current functionality
 */

/**
 * Building Specification Schema
 * Used for analyzing building requirements and computing infrastructure
 */
export const BUILDING_SPEC_SCHEMA = {
  id: 'string',
  type: 'office|residential|retail|industrial|warehouse',
  floors: 'number',
  totalArea: 'number', // sqm
  users: 'number',
  entrances: 'number',
  exits: 'number',
  requirements: ['access_control', 'cctv', 'network', 'fire_safety', 'intercom'],
  constraints: {
    budget: 'number',
    timeline: 'string',
    compliance: ['iec', 'fire_safety', 'accessibility', 'building_code'],
    securityLevel: 'basic|standard|high|enterprise'
  },
  metadata: {
    created: 'string',
    analyzed: 'string',
    confidence: 'number' // 0-1
  }
};

/**
 * Enhanced BOM Schema
 * Extends existing quote structure with detailed infrastructure and reasoning
 */
export const ENHANCED_BOM_SCHEMA = {
  id: 'string',
  buildingSpec: BUILDING_SPEC_SCHEMA,
  lineItems: [
    {
      sku: 'string',
      description: 'string',
      quantity: 'number',
      reasoning: 'string', // Why this item is needed
      confidence: 'number', // 0-1 confidence score
      alternatives: [
        {
          sku: 'string',
          description: 'string',
          price: 'number',
          pros: ['string'],
          cons: ['string'],
          compatibility: 'string'
        }
      ],
      compliance: ['string'], // Which rules require this
      specs: {
        datasheetUrl: 'string',
        compatibility: 'string',
        eolStatus: 'active|eol|soon_eol',
        warranty: 'string'
      },
      vendorData: {
        vendors: [
          {
            name: 'string',
            price: 'number',
            stock: 'number',
            leadTime: 'number', // days
            reliability: 'number' // 0-1
          }
        ]
      }
    }
  ],
  infrastructure: {
    cabling: {
      total: 'number', // meters
      breakdown: {
        cat6: 'number',
        power: 'number',
        fiber: 'number'
      },
      conduit: {
        total: 'number',
        sizes: {
          '20mm': 'number',
          '25mm': 'number',
          '32mm': 'number'
        }
      }
    },
    power: {
      total: 'number', // watts
      breakdown: {
        readers: 'number',
        controllers: 'number',
        locks: 'number',
        accessories: 'number'
      },
      ups: {
        capacity: 'number', // kVA
        runtime: 'number', // hours
        count: 'number'
      }
    },
    labor: {
      hours: 'number',
      skillLevel: 'basic|intermediate|advanced',
      breakdown: {
        installation: 'number',
        configuration: 'number',
        testing: 'number',
        training: 'number'
      }
    }
  },
  costs: {
    subtotal: 'number',
    duties: 'number',
    taxes: {
      vat: 'number',
      nhil: 'number',
      getfund: 'number',
      covid: 'number'
    },
    shipping: 'number',
    installation: 'number',
    total: 'number'
  },
  compliance: {
    status: 'compliant|non_compliant|partial',
    issues: [
      {
        rule: 'string',
        severity: 'low|medium|high',
        description: 'string',
        resolution: 'string'
      }
    ],
    autoAdded: [
      {
        sku: 'string',
        reason: 'string',
        rule: 'string'
      }
    ]
  }
};

/**
 * Compliance Rule Schema
 * Defines business rules and regulatory requirements
 */
export const COMPLIANCE_RULE_SCHEMA = {
  id: 'string',
  name: 'string',
  description: 'string',
  type: 'safety|regulatory|business|technical',
  severity: 'low|medium|high|critical',
  conditions: {
    buildingType: ['string'],
    area: { min: 'number', max: 'number' },
    users: { min: 'number', max: 'number' },
    requirements: ['string']
  },
  actions: {
    autoAdd: [
      {
        sku: 'string',
        quantity: 'number|function',
        reason: 'string'
      }
    ],
    validate: 'function',
    warn: 'string'
  },
  metadata: {
    source: 'string', // regulation, internal policy, etc.
    lastUpdated: 'string',
    version: 'string'
  }
};

/**
 * Learning Outcome Schema
 * Tracks quote outcomes for continuous improvement
 */
export const LEARNING_OUTCOME_SCHEMA = {
  quoteId: 'string',
  outcome: 'won|lost|pending|cancelled',
  customerFeedback: {
    rating: 'number', // 1-5
    comments: 'string',
    concerns: ['string']
  },
  performance: {
    itemsChosen: ['string'], // SKUs actually selected
    itemsRejected: ['string'],
    discountApplied: 'number',
    marginAchieved: 'number'
  },
  insights: {
    competitiveFactors: ['string'],
    pricingFactors: ['string'],
    technicalFactors: ['string']
  },
  metadata: {
    date: 'string',
    salesperson: 'string',
    customerType: 'string'
  }
};

/**
 * External Data Cache Schema
 * For caching vendor data, specs, and pricing
 */
export const EXTERNAL_DATA_CACHE_SCHEMA = {
  id: 'string', // SKU or search term
  type: 'product_specs|vendor_pricing|tariff_data|shipping_rates',
  data: 'object',
  source: 'string',
  lastUpdated: 'string',
  expiresAt: 'string',
  confidence: 'number' // 0-1
};

/**
 * AI Analysis Result Schema
 * Standardized output from AI analysis
 */
export const AI_ANALYSIS_RESULT_SCHEMA = {
  id: 'string',
  type: 'building_analysis|bom_generation|compliance_check|pricing_analysis',
  input: 'string',
  output: 'object',
  confidence: 'number', // 0-1
  reasoning: 'string',
  sources: ['string'],
  alternatives: ['object'],
  metadata: {
    timestamp: 'string',
    model: 'string',
    processingTime: 'number',
    tokensUsed: 'number'
  }
};

export default {
  BUILDING_SPEC_SCHEMA,
  ENHANCED_BOM_SCHEMA,
  COMPLIANCE_RULE_SCHEMA,
  LEARNING_OUTCOME_SCHEMA,
  EXTERNAL_DATA_CACHE_SCHEMA,
  AI_ANALYSIS_RESULT_SCHEMA
};
