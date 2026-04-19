/**
 * Enhanced AI Service
 * Orchestrates advanced AI capabilities for building analysis and BOM generation
 */

import NLPService from './NLPService.js';
import InfrastructureCalculator from './InfrastructureCalculator.js';
import { AI_ANALYSIS_RESULT_SCHEMA } from './EnhancedDataSchemas.js';

export class EnhancedAIService {
  constructor() {
    this.nlpService = new NLPService();
    this.calculator = new InfrastructureCalculator();
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Analyze building requirement and generate complete BOM
   * @param {string} input - Natural language building description
   * @param {Object} context - Current system context (inventory, customers, etc.)
   * @returns {Object} Complete analysis result
   */
  async analyzeBuildingRequirement(input, context) {
    try {
      const startTime = Date.now();
      const analysisId = this.generateId();

      // Step 1: Parse building requirements
      const buildingSpec = this.nlpService.parseBuildingRequirement(input);
      
      // Step 2: Calculate infrastructure requirements
      const infrastructure = this.calculator.calculateInfrastructure(buildingSpec);
      
      // Step 3: Generate BOM
      const bom = this.calculator.generateBOM(infrastructure, buildingSpec);
      
      // Step 4: Enhance with inventory data
      const enhancedBOM = await this.enhanceWithInventory(bom, context);
      
      // Step 5: Generate reasoning and confidence
      const reasoning = this.generateReasoning(buildingSpec, infrastructure, enhancedBOM);
      
      const result = {
        id: analysisId,
        type: 'building_analysis',
        input,
        output: {
          buildingSpec,
          infrastructure,
          bom: enhancedBOM,
          reasoning,
          confidence: this.calculateOverallConfidence(buildingSpec, enhancedBOM)
        },
        metadata: {
          timestamp: new Date().toISOString(),
          model: 'enhanced-ai-v1',
          processingTime: Date.now() - startTime,
          tokensUsed: 0 // Would be calculated from AI calls
        }
      };

      // Cache result
      this.cacheResult(analysisId, result);

      return result;
    } catch (error) {
      console.error('Error analyzing building requirement:', error);
      return this.getErrorResult(input, error);
    }
  }

  /**
   * Enhance BOM with real inventory data
   */
  async enhanceWithInventory(bom, context) {
    const enhancedBOM = { ...bom };
    
    if (!context.inventory || context.inventory.length === 0) {
      return enhancedBOM;
    }

    // Map BOM items to actual inventory
    enhancedBOM.lineItems = bom.lineItems.map(item => {
      const inventoryItem = context.inventory.find(inv => 
        inv.id === item.sku || 
        inv.name.toLowerCase().includes(item.sku.toLowerCase())
      );

      if (inventoryItem) {
        return {
          ...item,
          available: true,
          stock: inventoryItem.stock,
          actualPrice: inventoryItem.price,
          vendor: inventoryItem.vendor || 'Unknown',
          alternatives: this.findAlternatives(inventoryItem, context.inventory)
        };
      } else {
        return {
          ...item,
          available: false,
          stock: 0,
          alternatives: this.findAlternatives(item, context.inventory)
        };
      }
    });

    // Update costs with actual prices
    enhancedBOM.costs = this.recalculateCosts(enhancedBOM.lineItems);

    return enhancedBOM;
  }

  /**
   * Find alternative products for unavailable items
   */
  findAlternatives(item, inventory) {
    const alternatives = [];
    const itemType = this.getItemType(item.sku);
    
    inventory.forEach(inv => {
      if (inv.id !== item.sku && this.getItemType(inv.id) === itemType) {
        alternatives.push({
          sku: inv.id,
          name: inv.name,
          price: inv.price,
          stock: inv.stock,
          compatibility: this.checkCompatibility(item, inv),
          pros: this.getProductPros(inv),
          cons: this.getProductCons(inv)
        });
      }
    });

    return alternatives.slice(0, 3); // Return top 3 alternatives
  }

  /**
   * Determine item type from SKU
   */
  getItemType(sku) {
    if (sku.includes('READER')) return 'reader';
    if (sku.includes('CTRL')) return 'controller';
    if (sku.includes('LOCK')) return 'lock';
    if (sku.includes('CAM')) return 'camera';
    if (sku.includes('SW')) return 'switch';
    if (sku.includes('UPS')) return 'ups';
    if (sku.includes('CABLE')) return 'cable';
    return 'unknown';
  }

  /**
   * Check compatibility between items
   */
  checkCompatibility(original, alternative) {
    // Basic compatibility check - would be enhanced with actual product specs
    const originalType = this.getItemType(original.sku);
    const alternativeType = this.getItemType(alternative.sku);
    
    if (originalType === alternativeType) {
      return 'Full compatibility';
    } else if (originalType === 'reader' && alternativeType === 'reader') {
      return 'Reader compatibility - verify protocol';
    } else {
      return 'Limited compatibility - verify requirements';
    }
  }

  /**
   * Get product advantages
   */
  getProductPros(product) {
    const pros = [];
    if (product.stock > 10) pros.push('High stock availability');
    if (product.price < 200) pros.push('Cost effective');
    if (product.name.toLowerCase().includes('poe')) pros.push('PoE support');
    if (product.name.toLowerCase().includes('4k')) pros.push('High resolution');
    return pros;
  }

  /**
   * Get product disadvantages
   */
  getProductCons(product) {
    const cons = [];
    if (product.stock < 5) cons.push('Low stock');
    if (product.price > 500) cons.push('Higher cost');
    return cons;
  }

  /**
   * Recalculate costs with actual prices
   */
  recalculateCosts(lineItems) {
    let subtotal = 0;
    
    lineItems.forEach(item => {
      const price = item.actualPrice || item.unitPrice || 100;
      item.lineTotal = price * item.quantity;
      subtotal += item.lineTotal;
    });

    const duties = subtotal * 0.20;
    const vat = subtotal * 0.15;
    const nhil = subtotal * 0.025;
    const getfund = subtotal * 0.025;
    const covid = subtotal * 0.01;
    const totalTaxes = vat + nhil + getfund + covid;

    return {
      subtotal,
      duties,
      taxes: { vat, nhil, getfund, covid },
      total: subtotal + duties + totalTaxes
    };
  }

  /**
   * Generate detailed reasoning for the analysis
   */
  generateReasoning(buildingSpec, infrastructure, bom) {
    const reasoning = {
      buildingAnalysis: this.generateBuildingReasoning(buildingSpec),
      infrastructureCalculation: this.generateInfrastructureReasoning(infrastructure),
      bomGeneration: this.generateBOMReasoning(bom),
      recommendations: this.generateRecommendations(buildingSpec, bom)
    };

    return reasoning;
  }

  /**
   * Generate building analysis reasoning
   */
  generateBuildingReasoning(buildingSpec) {
    return {
      type: `Identified as ${buildingSpec.type} building`,
      scale: `${buildingSpec.floors} floors, ${buildingSpec.users} users, ${buildingSpec.totalArea}sqm`,
      requirements: buildingSpec.requirements.join(', '),
      securityLevel: buildingSpec.constraints.securityLevel,
      confidence: buildingSpec.metadata.confidence
    };
  }

  /**
   * Generate infrastructure calculation reasoning
   */
  generateInfrastructureReasoning(infrastructure) {
    return {
      accessControl: infrastructure.access_control.reasoning,
      cctv: infrastructure.cctv.reasoning,
      network: infrastructure.network.reasoning,
      power: infrastructure.power.reasoning,
      cabling: infrastructure.cabling.reasoning,
      labor: infrastructure.labor.reasoning
    };
  }

  /**
   * Generate BOM reasoning
   */
  generateBOMReasoning(bom) {
    const reasoning = {
      totalItems: bom.lineItems.length,
      availableItems: bom.lineItems.filter(item => item.available).length,
      unavailableItems: bom.lineItems.filter(item => !item.available).length,
      totalCost: bom.costs.total,
      compliance: bom.compliance.status
    };

    if (bom.compliance.issues.length > 0) {
      reasoning.complianceIssues = bom.compliance.issues.map(issue => ({
        severity: issue.severity,
        description: issue.description
      }));
    }

    return reasoning;
  }

  /**
   * Generate recommendations
   */
  generateRecommendations(buildingSpec, bom) {
    const recommendations = [];

    // Stock recommendations
    const lowStockItems = bom.lineItems.filter(item => item.stock < 5);
    if (lowStockItems.length > 0) {
      recommendations.push({
        type: 'stock',
        priority: 'high',
        message: `${lowStockItems.length} items have low stock - consider alternatives or lead time`,
        items: lowStockItems.map(item => item.sku)
      });
    }

    // Cost optimization
    const highCostItems = bom.lineItems.filter(item => item.actualPrice > 500);
    if (highCostItems.length > 0) {
      recommendations.push({
        type: 'cost',
        priority: 'medium',
        message: `${highCostItems.length} high-cost items found - review alternatives`,
        items: highCostItems.map(item => item.sku)
      });
    }

    // Compliance recommendations
    if (bom.compliance.issues.length > 0) {
      recommendations.push({
        type: 'compliance',
        priority: 'high',
        message: `${bom.compliance.issues.length} compliance issues require attention`,
        issues: bom.compliance.issues.map(issue => issue.description)
      });
    }

    // Installation recommendations
    if (bom.infrastructure.labor.hours > 80) {
      recommendations.push({
        type: 'installation',
        priority: 'medium',
        message: `Large project (${bom.infrastructure.labor.hours}h) - consider phased implementation`,
        details: 'Break into phases for better project management'
      });
    }

    return recommendations;
  }

  /**
   * Calculate overall confidence score
   */
  calculateOverallConfidence(buildingSpec, bom) {
    let confidence = buildingSpec.metadata.confidence || 0.5;

    // Adjust based on data availability
    const availableItems = bom.lineItems.filter(item => item.available).length;
    const totalItems = bom.lineItems.length;
    const availabilityRatio = totalItems > 0 ? availableItems / totalItems : 1;
    
    confidence = confidence * availabilityRatio;

    // Adjust based on compliance
    if (bom.compliance.status === 'compliant') {
      confidence += 0.1;
    } else if (bom.compliance.status === 'non_compliant') {
      confidence -= 0.2;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Cache analysis result
   */
  cacheResult(id, result) {
    this.cache.set(id, {
      result,
      timestamp: Date.now()
    });

    // Clean up old cache entries
    this.cleanupCache();
  }

  /**
   * Get cached result
   */
  getCachedResult(id) {
    const cached = this.cache.get(id);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.result;
    }
    return null;
  }

  /**
   * Clean up expired cache entries
   */
  cleanupCache() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.cacheTimeout) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get error result
   */
  getErrorResult(input, error) {
    return {
      id: this.generateId(),
      type: 'building_analysis',
      input,
      output: null,
      error: {
        message: error.message,
        code: 'ANALYSIS_ERROR'
      },
      metadata: {
        timestamp: new Date().toISOString(),
        model: 'enhanced-ai-v1',
        processingTime: 0,
        tokensUsed: 0
      }
    };
  }

  /**
   * Analyze product requirements (for product-focused requests)
   * @param {string} input - Product requirement description
   * @param {Object} context - System context
   * @returns {Object} Product analysis result
   */
  async analyzeProductRequirements(input, context) {
    try {
      const productReq = this.nlpService.parseProductRequirements(input);
      const recommendations = this.generateProductRecommendations(productReq, context);
      
      return {
        id: this.generateId(),
        type: 'product_analysis',
        input,
        output: {
          requirements: productReq,
          recommendations
        },
        metadata: {
          timestamp: new Date().toISOString(),
          model: 'enhanced-ai-v1',
          processingTime: 0,
          tokensUsed: 0
        }
      };
    } catch (error) {
      console.error('Error analyzing product requirements:', error);
      return this.getErrorResult(input, error);
    }
  }

  /**
   * Generate product recommendations
   */
  generateProductRecommendations(productReq, context) {
    const recommendations = [];

    if (!context.inventory || context.inventory.length === 0) {
      return recommendations;
    }

    // Find products matching requirements
    productReq.products.forEach(productType => {
      const matchingItems = context.inventory.filter(item => 
        item.name.toLowerCase().includes(productType) ||
        item.id.toLowerCase().includes(productType)
      );

      if (matchingItems.length > 0) {
        recommendations.push({
          type: productType,
          items: matchingItems.slice(0, 5), // Top 5 matches
          reasoning: `Found ${matchingItems.length} ${productType} products in inventory`
        });
      }
    });

    return recommendations;
  }
}

export default EnhancedAIService;
