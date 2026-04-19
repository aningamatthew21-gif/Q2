/**
 * Natural Language Processing Service
 * Parses complex building requirements into structured specifications
 */

import { BUILDING_SPEC_SCHEMA } from './EnhancedDataSchemas.js';

export class NLPService {
  constructor() {
    this.buildingTypes = {
      office: ['office', 'corporate', 'business', 'workplace', 'headquarters'],
      residential: ['house', 'home', 'apartment', 'residential', 'dwelling'],
      retail: ['shop', 'store', 'retail', 'mall', 'shopping'],
      industrial: ['factory', 'warehouse', 'industrial', 'manufacturing'],
      warehouse: ['warehouse', 'storage', 'distribution', 'logistics']
    };

    this.requirements = {
      access_control: ['access control', 'door access', 'card reader', 'biometric', 'badge', 'keycard'],
      cctv: ['camera', 'surveillance', 'cctv', 'monitoring', 'security camera'],
      network: ['network', 'lan', 'wifi', 'ethernet', 'internet', 'connectivity'],
      fire_safety: ['fire alarm', 'fire safety', 'emergency', 'evacuation', 'fire system'],
      intercom: ['intercom', 'communication', 'phone system', 'paging']
    };

    this.securityLevels = {
      basic: ['basic', 'simple', 'standard'],
      standard: ['standard', 'normal', 'regular'],
      high: ['high', 'enhanced', 'premium', 'advanced'],
      enterprise: ['enterprise', 'corporate', 'mission critical']
    };
  }

  /**
   * Parse building requirement from natural language input
   * @param {string} input - Natural language description
   * @returns {Object} Structured building specification
   */
  parseBuildingRequirement(input) {
    try {
      const normalizedInput = input.toLowerCase();
      
      const buildingSpec = {
        id: this.generateId(),
        type: this.extractBuildingType(normalizedInput),
        floors: this.extractNumber(normalizedInput, ['floor', 'level', 'storey']),
        totalArea: this.extractNumber(normalizedInput, ['sqm', 'square meter', 'area']),
        users: this.extractNumber(normalizedInput, ['user', 'person', 'staff', 'employee', 'people']),
        entrances: this.extractNumber(normalizedInput, ['entrance', 'entry', 'door']),
        exits: this.extractNumber(normalizedInput, ['exit', 'emergency exit']),
        requirements: this.extractRequirements(normalizedInput),
        constraints: {
          budget: this.extractNumber(normalizedInput, ['budget', 'cost', 'price']),
          timeline: this.extractTimeline(normalizedInput),
          compliance: this.extractCompliance(normalizedInput),
          securityLevel: this.extractSecurityLevel(normalizedInput)
        },
        metadata: {
          created: new Date().toISOString(),
          analyzed: new Date().toISOString(),
          confidence: this.calculateConfidence(normalizedInput)
        }
      };

      // Validate and fill defaults
      return this.validateAndFillDefaults(buildingSpec);
    } catch (error) {
      console.error('Error parsing building requirement:', error);
      return this.getDefaultBuildingSpec();
    }
  }

  /**
   * Extract building type from input
   */
  extractBuildingType(input) {
    for (const [type, keywords] of Object.entries(this.buildingTypes)) {
      if (keywords.some(keyword => input.includes(keyword))) {
        return type;
      }
    }
    return 'office'; // Default
  }

  /**
   * Extract numeric values for specific categories
   */
  extractNumber(input, keywords) {
    for (const keyword of keywords) {
      const regex = new RegExp(`(\\d+)\\s*${keyword}`, 'i');
      const match = input.match(regex);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    return null;
  }

  /**
   * Extract requirements from input
   */
  extractRequirements(input) {
    const found = [];
    for (const [req, keywords] of Object.entries(this.requirements)) {
      if (keywords.some(keyword => input.includes(keyword))) {
        found.push(req);
      }
    }
    return found.length > 0 ? found : ['access_control']; // Default
  }

  /**
   * Extract timeline information
   */
  extractTimeline(input) {
    const timelineKeywords = ['week', 'month', 'day', 'urgent', 'asap', 'immediate'];
    for (const keyword of timelineKeywords) {
      if (input.includes(keyword)) {
        return keyword;
      }
    }
    return 'standard';
  }

  /**
   * Extract compliance requirements
   */
  extractCompliance(input) {
    const compliance = [];
    if (input.includes('iec') || input.includes('electrical')) compliance.push('iec');
    if (input.includes('fire') || input.includes('safety')) compliance.push('fire_safety');
    if (input.includes('accessibility') || input.includes('ada')) compliance.push('accessibility');
    if (input.includes('building code') || input.includes('regulation')) compliance.push('building_code');
    return compliance.length > 0 ? compliance : ['iec', 'fire_safety'];
  }

  /**
   * Extract security level
   */
  extractSecurityLevel(input) {
    for (const [level, keywords] of Object.entries(this.securityLevels)) {
      if (keywords.some(keyword => input.includes(keyword))) {
        return level;
      }
    }
    return 'standard';
  }

  /**
   * Calculate confidence score based on extracted information
   */
  calculateConfidence(input) {
    let confidence = 0.5; // Base confidence
    
    // Increase confidence for specific details
    if (this.extractNumber(input, ['floor', 'level'])) confidence += 0.1;
    if (this.extractNumber(input, ['user', 'person'])) confidence += 0.1;
    if (this.extractNumber(input, ['entrance', 'door'])) confidence += 0.1;
    if (this.extractRequirements(input).length > 1) confidence += 0.1;
    if (input.includes('budget') || input.includes('cost')) confidence += 0.1;
    
    return Math.min(confidence, 1.0);
  }

  /**
   * Validate and fill default values
   */
  validateAndFillDefaults(spec) {
    // Set defaults for missing values
    if (!spec.floors) spec.floors = 1;
    if (!spec.users) spec.users = 10;
    if (!spec.entrances) spec.entrances = 1;
    if (!spec.exits) spec.exits = 1;
    if (!spec.totalArea) spec.totalArea = spec.floors * 100; // Estimate
    
    // Ensure requirements array is not empty
    if (!spec.requirements || spec.requirements.length === 0) {
      spec.requirements = ['access_control'];
    }

    return spec;
  }

  /**
   * Get default building specification
   */
  getDefaultBuildingSpec() {
    return {
      id: this.generateId(),
      type: 'office',
      floors: 1,
      totalArea: 100,
      users: 10,
      entrances: 1,
      exits: 1,
      requirements: ['access_control'],
      constraints: {
        budget: null,
        timeline: 'standard',
        compliance: ['iec', 'fire_safety'],
        securityLevel: 'standard'
      },
      metadata: {
        created: new Date().toISOString(),
        analyzed: new Date().toISOString(),
        confidence: 0.3
      }
    };
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return `spec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Parse complex requirements with multiple buildings
   * @param {string} input - Multi-building description
   * @returns {Array} Array of building specifications
   */
  parseMultipleBuildings(input) {
    // Split input by common separators
    const buildingDescriptions = input.split(/[;,\n]|and|also/);
    
    return buildingDescriptions
      .map(desc => desc.trim())
      .filter(desc => desc.length > 0)
      .map(desc => this.parseBuildingRequirement(desc));
  }

  /**
   * Extract specific product requirements
   * @param {string} input - Product-focused description
   * @returns {Object} Product requirements
   */
  parseProductRequirements(input) {
    const normalizedInput = input.toLowerCase();
    
    return {
      products: this.extractProductTypes(normalizedInput),
      quantities: this.extractQuantities(normalizedInput),
      specifications: this.extractSpecifications(normalizedInput),
      constraints: this.extractProductConstraints(normalizedInput)
    };
  }

  /**
   * Extract product types mentioned
   */
  extractProductTypes(input) {
    const products = [];
    const productKeywords = {
      'reader': ['reader', 'card reader', 'biometric reader'],
      'controller': ['controller', 'panel', 'hub'],
      'lock': ['lock', 'maglock', 'strike'],
      'camera': ['camera', 'ip camera', 'cctv'],
      'switch': ['switch', 'network switch'],
      'ups': ['ups', 'battery', 'backup power']
    };

    for (const [product, keywords] of Object.entries(productKeywords)) {
      if (keywords.some(keyword => input.includes(keyword))) {
        products.push(product);
      }
    }

    return products;
  }

  /**
   * Extract quantities for products
   */
  extractQuantities(input) {
    const quantities = {};
    const quantityRegex = /(\d+)\s*(reader|controller|lock|camera|switch|ups)/gi;
    let match;

    while ((match = quantityRegex.exec(input)) !== null) {
      const quantity = parseInt(match[1], 10);
      const product = match[2].toLowerCase();
      quantities[product] = (quantities[product] || 0) + quantity;
    }

    return quantities;
  }

  /**
   * Extract technical specifications
   */
  extractSpecifications(input) {
    const specs = {};
    
    // Extract common specifications
    if (input.includes('poe')) specs.poe = true;
    if (input.includes('wiegand')) specs.wiegand = true;
    if (input.includes('wireless')) specs.wireless = true;
    if (input.includes('ip65')) specs.weatherproof = true;
    if (input.includes('4k') || input.includes('ultra hd')) specs.resolution = '4k';
    
    return specs;
  }

  /**
   * Extract product constraints
   */
  extractProductConstraints(input) {
    const constraints = {};
    
    if (input.includes('budget') || input.includes('cost')) {
      constraints.budget = this.extractNumber(input, ['budget', 'cost', 'price']);
    }
    
    if (input.includes('urgent') || input.includes('asap')) {
      constraints.urgent = true;
    }
    
    if (input.includes('stock') || input.includes('available')) {
      constraints.stockRequired = true;
    }
    
    return constraints;
  }
}

export default NLPService;
