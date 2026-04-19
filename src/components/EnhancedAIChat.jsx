/**
 * Enhanced AI Chat Component
 * Provides building analysis and BOM generation capabilities
 */

import React, { useState, useEffect, useRef } from 'react';
import FormattedMessage from './FormattedMessage.jsx';

const EnhancedAIChat = ({ 
  chatHistory, 
  setChatHistory, 
  userInput, 
  setUserInput, 
  isAiLoading, 
  setIsAiLoading,
  context,
  onAddToQuote,
  onRemoveFromQuote,
  onReduceQuantity 
}) => {
  const [analysisMode, setAnalysisMode] = useState('chat'); // 'chat' | 'building' | 'bom'
  const [buildingAnalysis, setBuildingAnalysis] = useState(null);
  const [bomPreview, setBomPreview] = useState(null);
  const [showBomDetails, setShowBomDetails] = useState(false);
  const chatContainerRef = useRef(null);
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory, buildingAnalysis, bomPreview]);

  // Enhanced message handler with building analysis capabilities
  const handleSendMessage = async () => {
    if (!userInput.trim()) return;

    const input = userInput.trim();
    setUserInput('');
    setIsAiLoading(true);

    // Add user message to history
    const newHistory = [...chatHistory, { role: 'user', parts: [{ text: input }] }];
    setChatHistory(newHistory);

    try {
      // Detect if this is a building analysis request
      if (isBuildingAnalysisRequest(input)) {
        await handleBuildingAnalysis(input, newHistory);
      } else {
        // Handle regular chat
        await handleRegularChat(input, newHistory);
      }
    } catch (error) {
      console.error('AI Error:', error);
      
      setChatHistory([
        ...newHistory,
        {
          role: 'model',
          parts: [{
            text: 'I apologize, but I encountered an error processing your request. Please try again or contact support if the issue persists.'
          }]
        }
      ]);
    } finally {
      setIsAiLoading(false);
    }
  };

  // Check if input is a building analysis request
  const isBuildingAnalysisRequest = (input) => {
    const buildingKeywords = [
      'floor', 'building', 'office', 'house', 'access control', 'cctv', 
      'security', 'entrance', 'door', 'users', 'staff', 'cabling', 'network'
    ];
    
    const lowerInput = input.toLowerCase();
    return buildingKeywords.some(keyword => lowerInput.includes(keyword)) && 
           (lowerInput.includes('need') || lowerInput.includes('want') || lowerInput.includes('require'));
  };

  // Handle building analysis requests
  const handleBuildingAnalysis = async (input, newHistory) => {
    try {
      setAnalysisMode('building');
      
      const response = await fetch(`${BACKEND_URL}/api/ai/analyze-building`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: input,
          context: context
        })
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success && data.result) {
        setBuildingAnalysis(data.result);
        
        // Add analysis result to chat
        const analysisMessage = generateAnalysisMessage(data.result);
        setChatHistory([
          ...newHistory,
          {
            role: 'model',
            parts: [{ text: analysisMessage }]
          }
        ]);

        // Generate BOM preview
        if (data.result.output && data.result.output.bom) {
          setBomPreview(data.result.output.bom);
          setAnalysisMode('bom');
        }
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (error) {
      console.error('Building Analysis Error:', error);
      throw error;
    }
  };

  // Handle regular chat requests
  const handleRegularChat = async (input, newHistory) => {
    const response = await fetch(`${BACKEND_URL}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: input,
        context: context
      })
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.success && data.response) {
      // Process AI response and execute actions
      processAIResponse(data.response, newHistory);
    } else {
      throw new Error('Invalid response from server');
    }
  };

  // Generate analysis message for chat
  const generateAnalysisMessage = (result) => {
    const { buildingSpec, infrastructure, bom } = result.output;
    
    let message = `## 🏢 Building Analysis Complete\n\n`;
    message += `**Building Type:** ${buildingSpec.type}\n`;
    message += `**Floors:** ${buildingSpec.floors}\n`;
    message += `**Users:** ${buildingSpec.users}\n`;
    message += `**Entrances:** ${buildingSpec.entrances}\n\n`;
    
    message += `### 📊 Infrastructure Requirements\n`;
    if (infrastructure.access_control) {
      message += `- **Access Control:** ${infrastructure.access_control.readers} readers, ${infrastructure.access_control.controllers} controllers\n`;
    }
    
    message += `\n### 📋 Recommended Items\n`;
    bom.lineItems.forEach(item => {
      message += `- ${item.description} (${item.quantity} units) - ${item.reasoning}\n`;
    });
    
    message += `\n### 💰 Estimated Cost: GHS ${bom.costs.total || 'TBD'}\n\n`;
    message += `*Click "View BOM Details" below to see the complete breakdown and add items to your quote.*`;
    
    return message;
  };

  // Process AI response and execute actions
  const processAIResponse = (responseText, newHistory) => {
    const executedActions = [];
    let cleanText = responseText;

    // Enhanced action parsing
    const actionPatterns = [
      {
        pattern: /\[ACTION:ADD_TO_QUOTE, SKU:([A-Z0-9-]+), QUANTITY:(\d+)\]/g,
        handler: (match, sku, quantity) => {
          const qty = parseInt(quantity, 10);
          if (qty > 0 && qty <= 1000) {
            // Find item in context inventory
            const item = context.inventory?.find(i => i.id === sku);
            if (item && onAddToQuote) {
              onAddToQuote(item, qty);
              executedActions.push({ type: 'ADD_TO_QUOTE', sku, quantity: qty });
            }
          }
        }
      },
      {
        pattern: /\[ACTION:REMOVE_FROM_QUOTE, SKU:([A-Z0-9-]+)\]/g,
        handler: (match, sku) => {
          if (onRemoveFromQuote) {
            onRemoveFromQuote(sku);
            executedActions.push({ type: 'REMOVE_FROM_QUOTE', sku });
          }
        }
      }
    ];

    // Execute actions
    actionPatterns.forEach(({ pattern, handler }) => {
      let match;
      while ((match = pattern.exec(responseText)) !== null) {
        handler(match, match[1], match[2]);
        cleanText = cleanText.replace(match[0], '');
      }
    });

    // Add processed response to chat
    setChatHistory([
      ...newHistory,
      {
        role: 'model',
        parts: [{ text: cleanText }]
      }
    ]);
  };

  // Handle adding BOM items to quote
  const handleAddBomItems = () => {
    if (!bomPreview || !onAddToQuote) return;

    bomPreview.lineItems.forEach(item => {
      const inventoryItem = context.inventory?.find(i => i.id === item.sku);
      if (inventoryItem) {
        onAddToQuote(inventoryItem, item.quantity);
      }
    });

    // Show success message
    setChatHistory([
      ...chatHistory,
      {
        role: 'model',
        parts: [{
          text: `✅ Added ${bomPreview.lineItems.length} items from the BOM to your quote!`
        }]
      }
    ]);

    // Clear BOM preview
    setBomPreview(null);
    setAnalysisMode('chat');
  };

  // Handle Enter key press
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Analysis Mode Indicator */}
      {analysisMode !== 'chat' && (
        <div className="bg-blue-50 border-b border-blue-200 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-blue-500 rounded-full mr-2"></div>
              <span className="text-sm font-medium text-blue-800">
                {analysisMode === 'building' ? 'Analyzing Building Requirements...' : 'BOM Generated'}
              </span>
            </div>
            <button
              onClick={() => {
                setAnalysisMode('chat');
                setBuildingAnalysis(null);
                setBomPreview(null);
              }}
              className="text-blue-600 hover:text-blue-800 text-sm"
            >
              Back to Chat
            </button>
          </div>
        </div>
      )}

      {/* Chat History */}
      <div 
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        {chatHistory.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                message.role === 'user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              <FormattedMessage message={message.parts[0].text} />
            </div>
          </div>
        ))}

        {isAiLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg px-4 py-2">
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                <span className="text-gray-600">AI is thinking...</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* BOM Preview */}
      {bomPreview && (
        <div className="border-t border-gray-200 p-4 bg-gray-50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-gray-800">Generated BOM</h3>
            <button
              onClick={() => setShowBomDetails(!showBomDetails)}
              className="text-blue-600 hover:text-blue-800 text-sm"
            >
              {showBomDetails ? 'Hide Details' : 'View Details'}
            </button>
          </div>

          {showBomDetails && (
            <div className="mb-4">
              <div className="bg-white rounded-lg p-4 border">
                <div className="space-y-3">
                  {bomPreview.lineItems.map((item, index) => (
                    <div key={index} className="flex items-center justify-between py-2 border-b border-gray-100">
                      <div>
                        <div className="font-medium">{item.description}</div>
                        <div className="text-sm text-gray-600">{item.reasoning}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">Qty: {item.quantity}</div>
                        <div className="text-sm text-gray-600">Confidence: {(item.confidence * 100).toFixed(0)}%</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="flex justify-between items-center">
                    <span className="font-medium">Estimated Total:</span>
                    <span className="font-bold text-lg">GHS {bomPreview.costs.total || 'TBD'}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex space-x-3">
            <button
              onClick={handleAddBomItems}
              className="flex-1 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg font-medium"
            >
              Add All Items to Quote
            </button>
            <button
              onClick={() => setShowBomDetails(!showBomDetails)}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              {showBomDetails ? 'Hide' : 'Details'}
            </button>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t border-gray-200 p-4">
        <div className="flex space-x-2">
          <div className="flex-1">
            <textarea
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Describe your building requirements or ask about products..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              rows="2"
              disabled={isAiLoading}
            />
          </div>
          <button
            onClick={handleSendMessage}
            disabled={isAiLoading || !userInput.trim()}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg font-medium"
          >
            Send
          </button>
        </div>
        
        {/* Quick Action Buttons */}
        <div className="mt-2 flex space-x-2">
          <button
            onClick={() => setUserInput("I need access control for a 4-floor office building with 100 staff")}
            className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-700"
          >
            Office Example
          </button>
          <button
            onClick={() => setUserInput("I need security system for a 3-bedroom house with 2 entrances")}
            className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-700"
          >
            House Example
          </button>
          <button
            onClick={() => setUserInput("What CCTV cameras do we have in stock?")}
            className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-700"
          >
            Check Stock
          </button>
        </div>
      </div>
    </div>
  );
};

export default EnhancedAIChat;
