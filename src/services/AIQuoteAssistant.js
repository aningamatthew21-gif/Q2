/**
 * AI Quote Assistant with Cost Component Recommendations
 * Provides intelligent suggestions for freight, duties, insurance, and pricing
 */

export class AIQuoteAssistant {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent';
  }

  /**
   * Generate cost component recommendations for a quote
   */
  async generateCostRecommendations(context) {
    const { inventory, customers, quoteItems, selectedCustomer, incoterm } = context;
    
    const systemPrompt = `
You are an expert international trade and pricing consultant with 20+ years of experience in freight forwarding, customs, and pricing strategies.

Your task is to analyze quote requests and provide specific, actionable recommendations for cost components that should be included in professional quotes.

CONTEXT:
- Customer: ${selectedCustomer?.name || 'Not selected'}
- Incoterm: ${incoterm || 'FOB'}
- Quote Items: ${quoteItems.map(item => `${item.description} (${item.quantity} units)`).join(', ') || 'None'}
- Available Inventory: ${inventory.length} items
- Customer History: ${customers.length} customers in database

COST COMPONENT RECOMMENDATIONS:
For each item in the quote, analyze and recommend:

1. FREIGHT ESTIMATES:
   - Inbound freight per unit (if applicable)
   - Shipping method recommendations (air vs sea vs land)
   - Estimated costs based on weight/dimensions

2. DUTY & TAXES:
   - Import duty estimates per unit
   - VAT/tax implications
   - Customs clearance costs

3. INSURANCE:
   - Recommended insurance coverage
   - Estimated insurance cost per unit
   - Risk assessment based on product type

4. PACKAGING & HANDLING:
   - Special packaging requirements
   - Handling fees per unit
   - Storage costs if applicable

5. OTHER CHARGES:
   - Documentation fees
   - Inspection costs
   - Special services required

6. PRICING STRATEGY:
   - Recommended markup percentage
   - Volume discount suggestions
   - Competitive pricing analysis

RESPONSE FORMAT:
Respond with a JSON action block containing specific recommendations:

{
  "recommendations": [
    {
      "type": "COST_COMPONENT",
      "sku": "ITEM_SKU",
      "component": "freight|duty|insurance|packaging|other",
      "suggestedValue": 25.50,
      "reason": "Based on weight and shipping distance",
      "confidence": "high|medium|low"
    },
    {
      "type": "MARKUP_RECOMMENDATION",
      "sku": "ITEM_SKU",
      "suggestedMarkup": 35,
      "reason": "Premium product with high demand",
      "confidence": "high"
    },
    {
      "type": "SHIPPING_METHOD",
      "recommendation": "air_freight",
      "reason": "High-value items require faster delivery",
      "estimatedCost": 150.00
    }
  ],
  "summary": "Brief explanation of key recommendations",
  "riskFactors": ["List any potential risks or considerations"]
}

IMPORTANT GUIDELINES:
- Always provide specific numerical values when possible
- Base recommendations on industry standards and best practices
- Consider the Incoterm when determining which costs apply
- Factor in customer history and relationship
- Provide clear reasoning for each recommendation
- Flag any high-risk or unusual situations
`;

    try {
      const response = await fetch(`${this.baseUrl}?key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: systemPrompt }]
            }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`API call failed with status: ${response.status}`);
      }

      const result = await response.json();
      const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Parse JSON recommendations from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const recommendations = JSON.parse(jsonMatch[0]);
        return {
          success: true,
          recommendations: recommendations.recommendations || [],
          summary: recommendations.summary || '',
          riskFactors: recommendations.riskFactors || []
        };
      } else {
        // Fallback to text parsing if JSON not found
        return this.parseTextRecommendations(responseText);
      }

    } catch (error) {
      console.error('AI recommendation error:', error);
      return {
        success: false,
        error: error.message,
        recommendations: [],
        summary: 'Unable to generate recommendations due to technical error',
        riskFactors: ['AI service unavailable']
      };
    }
  }

  /**
   * Parse text-based recommendations if JSON parsing fails
   */
  parseTextRecommendations(responseText) {
    const recommendations = [];
    
    // Look for cost component mentions
    const freightMatch = responseText.match(/freight[:\s]+([0-9.]+)/i);
    if (freightMatch) {
      recommendations.push({
        type: 'COST_COMPONENT',
        component: 'freight',
        suggestedValue: parseFloat(freightMatch[1]),
        reason: 'AI suggested freight cost',
        confidence: 'medium'
      });
    }

    const dutyMatch = responseText.match(/duty[:\s]+([0-9.]+)/i);
    if (dutyMatch) {
      recommendations.push({
        type: 'COST_COMPONENT',
        component: 'duty',
        suggestedValue: parseFloat(dutyMatch[1]),
        reason: 'AI suggested duty cost',
        confidence: 'medium'
      });
    }

    const markupMatch = responseText.match(/markup[:\s]+([0-9.]+)/i);
    if (markupMatch) {
      recommendations.push({
        type: 'MARKUP_RECOMMENDATION',
        suggestedMarkup: parseFloat(markupMatch[1]),
        reason: 'AI suggested markup percentage',
        confidence: 'medium'
      });
    }

    return {
      success: true,
      recommendations,
      summary: 'Parsed recommendations from AI response',
      riskFactors: ['Recommendations parsed from text - verify accuracy']
    };
  }

  /**
   * Validate AI recommendations against business rules
   */
  validateRecommendations(recommendations, businessRules) {
    const validatedRecommendations = [];
    const warnings = [];

    recommendations.forEach(rec => {
      // Validate cost components
      if (rec.type === 'COST_COMPONENT') {
        if (rec.suggestedValue < 0) {
          warnings.push(`Negative cost value for ${rec.component}: ${rec.suggestedValue}`);
          return;
        }

        if (rec.suggestedValue > businessRules.maxCostPerUnit) {
          warnings.push(`High cost value for ${rec.component}: ${rec.suggestedValue} exceeds maximum`);
        }

        validatedRecommendations.push(rec);
      }

      // Validate markup recommendations
      if (rec.type === 'MARKUP_RECOMMENDATION') {
        if (rec.suggestedMarkup < businessRules.minMarkup) {
          warnings.push(`Low markup suggestion: ${rec.suggestedMarkup}% below minimum`);
        }

        if (rec.suggestedMarkup > businessRules.maxMarkup) {
          warnings.push(`High markup suggestion: ${rec.suggestedMarkup}% above maximum`);
        }

        validatedRecommendations.push(rec);
      }
    });

    return {
      recommendations: validatedRecommendations,
      warnings,
      isValid: warnings.length === 0
    };
  }

  /**
   * Generate shipping method recommendations
   */
  async generateShippingRecommendations(quoteItems, destination) {
    const totalWeight = quoteItems.reduce((sum, item) => 
      sum + (item.quantity * (item.weightKg || 1)), 0);
    const totalValue = quoteItems.reduce((sum, item) => 
      sum + (item.quantity * (item.unitCost || 0)), 0);

    const recommendations = [];

    // Air freight recommendation for high-value or urgent items
    if (totalValue > 5000 || totalWeight < 100) {
      recommendations.push({
        method: 'air_freight',
        estimatedCost: Math.max(totalWeight * 8, 200), // Minimum 200 GHS
        reason: 'High value or low weight items suitable for air freight',
        transitTime: '3-5 days',
        confidence: 'high'
      });
    }

    // Sea freight recommendation for bulk items
    if (totalWeight > 100 && totalValue < 10000) {
      recommendations.push({
        method: 'sea_freight',
        estimatedCost: Math.max(totalWeight * 2, 100), // Minimum 100 GHS
        reason: 'Bulk items suitable for sea freight',
        transitTime: '15-30 days',
        confidence: 'high'
      });
    }

    // Land freight for regional shipments
    if (destination && destination.region === 'West Africa') {
      recommendations.push({
        method: 'land_freight',
        estimatedCost: Math.max(totalWeight * 1.5, 50), // Minimum 50 GHS
        reason: 'Regional shipment suitable for land transport',
        transitTime: '5-10 days',
        confidence: 'medium'
      });
    }

    return recommendations;
  }

  /**
   * Generate markup recommendations based on customer history
   */
  generateMarkupRecommendations(customer, quoteItems) {
    const recommendations = [];
    
    // Base markup on customer tier
    let baseMarkup = 32; // Default markup
    
    if (customer.tier === 'premium') {
      baseMarkup = 25; // Lower markup for premium customers
    } else if (customer.tier === 'budget') {
      baseMarkup = 40; // Higher markup for budget customers
    }

    // Adjust based on order volume
    const totalQuantity = quoteItems.reduce((sum, item) => sum + item.quantity, 0);
    if (totalQuantity > 50) {
      baseMarkup -= 5; // Volume discount
    }

    // Adjust based on product categories
    const hasElectronics = quoteItems.some(item => 
      item.description.toLowerCase().includes('printer') || 
      item.description.toLowerCase().includes('monitor')
    );
    
    if (hasElectronics) {
      baseMarkup += 3; // Electronics typically have higher margins
    }

    recommendations.push({
      type: 'MARKUP_RECOMMENDATION',
      suggestedMarkup: Math.max(baseMarkup, 15), // Minimum 15% markup
      reason: `Based on customer tier (${customer.tier || 'standard'}), order volume (${totalQuantity} units), and product mix`,
      confidence: 'high'
    });

    return recommendations;
  }

  /**
   * Generate comprehensive quote analysis
   */
  async generateQuoteAnalysis(context) {
    const { quoteItems, selectedCustomer, computedQuote } = context;
    
    const analysis = {
      profitability: {
        grossMargin: computedQuote?.totals?.grossMarginPercent || 0,
        recommendation: computedQuote?.totals?.grossMarginPercent >= 20 ? 'Good' : 'Consider increasing markup',
        riskLevel: computedQuote?.totals?.grossMarginPercent < 15 ? 'High' : 'Low'
      },
      competitiveness: {
        averageMarkup: quoteItems.reduce((sum, item) => sum + (item.markupPercent || 32), 0) / quoteItems.length,
        recommendation: 'Competitive pricing',
        marketPosition: 'Standard'
      },
      customerValue: {
        orderValue: computedQuote?.totals?.total || 0,
        customerTier: selectedCustomer?.tier || 'standard',
        recommendation: selectedCustomer?.tier === 'premium' ? 'Consider additional services' : 'Standard service level'
      },
      riskFactors: []
    };

    // Add risk factors
    if (analysis.profitability.grossMargin < 15) {
      analysis.riskFactors.push('Low margin - consider price adjustment');
    }

    if (quoteItems.length > 10) {
      analysis.riskFactors.push('Large order - verify stock availability');
    }

    if (computedQuote?.totals?.total > 50000) {
      analysis.riskFactors.push('High value order - consider payment terms');
    }

    return analysis;
  }
}

/**
 * Utility functions for AI integration
 */
export const AIQuoteUtils = {
  /**
   * Format AI recommendations for UI display
   */
  formatRecommendationsForUI(recommendations) {
    return recommendations.map(rec => ({
      id: `${rec.type}_${Date.now()}_${Math.random()}`,
      type: rec.type,
      title: this.getRecommendationTitle(rec),
      description: rec.reason,
      value: rec.suggestedValue || rec.suggestedMarkup,
      confidence: rec.confidence,
      actionable: true
    }));
  },

  /**
   * Get user-friendly title for recommendation
   */
  getRecommendationTitle(recommendation) {
    switch (recommendation.type) {
      case 'COST_COMPONENT':
        return `Add ${recommendation.component} cost`;
      case 'MARKUP_RECOMMENDATION':
        return `Set ${recommendation.suggestedMarkup}% markup`;
      case 'SHIPPING_METHOD':
        return `Use ${recommendation.recommendation}`;
      default:
        return 'AI Recommendation';
    }
  },

  /**
   * Apply AI recommendations to quote
   */
  applyRecommendations(quoteItems, recommendations) {
    const updatedItems = [...quoteItems];
    
    recommendations.forEach(rec => {
      if (rec.type === 'COST_COMPONENT' && rec.sku) {
        const itemIndex = updatedItems.findIndex(item => item.sku === rec.sku);
        if (itemIndex !== -1) {
          if (!updatedItems[itemIndex].costComponents) {
            updatedItems[itemIndex].costComponents = {};
          }
          updatedItems[itemIndex].costComponents[`${rec.component}PerUnit`] = rec.suggestedValue;
        }
      }
      
      if (rec.type === 'MARKUP_RECOMMENDATION' && rec.sku) {
        const itemIndex = updatedItems.findIndex(item => item.sku === rec.sku);
        if (itemIndex !== -1) {
          updatedItems[itemIndex].markupOverridePercent = rec.suggestedMarkup;
        }
      }
    });
    
    return updatedItems;
  }
};

export default AIQuoteAssistant;
