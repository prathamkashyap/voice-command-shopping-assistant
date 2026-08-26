import { createIntent } from './intent-schema.js';

export class LLMIntentParser {
  constructor(options = {}) {
    this.apiEndpoint = options.apiEndpoint || '/api/parse-intent';
    this.timeout = options.timeout || 5000;
    this.enabled = options.enabled !== false;
  }

  async parse(text, locale = 'en-US') {
    if (!this.enabled) {
      throw new Error('LLM parser not enabled');
    }

    try {
      const response = await this.callLLM(text, locale);
      return this.validateAndNormalize(response, text);
    } catch (error) {
      console.warn('LLM parsing failed:', error.message);
      throw error;
    }
  }

  async callLLM(text, locale) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text, locale }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      return data.intent || data;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  validateAndNormalize(rawResponse, originalText) {
    let parsed;

    if (typeof rawResponse === 'string') {
      try {
        parsed = JSON.parse(rawResponse);
      } catch (e) {
        throw new Error('LLM returned invalid JSON');
      }
    } else if (rawResponse && typeof rawResponse === 'object') {
      parsed = rawResponse;
    } else {
      throw new Error('LLM returned unexpected format');
    }

    if (!parsed.action || !['add', 'remove', 'modify', 'search', 'multi'].includes(parsed.action)) {
      throw new Error('Invalid or missing action in LLM response');
    }

    if (parsed.action === 'search') {
      return createIntent({
        action: 'search',
        items: [],
        searchFilters: {
          query: parsed.searchFilters?.query || parsed.item || '',
          maxPrice: parsed.searchFilters?.maxPrice ?? null,
          brand: parsed.searchFilters?.brand ?? null,
          isOrganic: parsed.searchFilters?.isOrganic ?? false,
          category: parsed.searchFilters?.category ?? null
        },
        originalText,
        source: 'llm',
        confidence: parsed.confidence ?? 0.7
      });
    }

    const items = Array.isArray(parsed.items) ? parsed.items : 
      (parsed.item ? [{ item: parsed.item, quantity: parsed.quantity ?? 1, unit: parsed.unit ?? null }] : []);

    if (items.length === 0 && parsed.action !== 'search') {
      throw new Error('No items found in LLM response');
    }

    const normalizedItems = items.map(item => ({
      item: String(item.item || '').trim(),
      quantity: typeof item.quantity === 'number' ? item.quantity : 1,
      unit: item.unit ? String(item.unit).toLowerCase() : null
    })).filter(item => item.item);

    if (normalizedItems.length === 0) {
      throw new Error('No valid items after normalization');
    }

    return createIntent({
      action: parsed.action,
      items: normalizedItems,
      searchFilters: null,
      originalText,
      source: 'llm',
      confidence: parsed.confidence ?? 0.7
    });
  }
}

export class MockLLMIntentParser extends LLMIntentParser {
  constructor() {
    super({ enabled: true });
  }

  async parse(text) {
    const lower = text.toLowerCase();
    
    // Detect multi-item patterns: "add X and Y", "buy X, Y, and Z", "get X and Y and Z"
    const multiMatch = lower.match(/^(?:add|buy|get|i need|i want)\s+(.+)$/i);
    if (multiMatch) {
      const itemsText = multiMatch[1];
      // Split by "and" or "," - handle "X, Y, and Z" pattern
      const parts = itemsText.split(/\s*(?:,|and)\s*/i);
      
      // Filter out empty parts
      const validParts = parts.filter(p => p.trim() && !/^(?:and|or|with|plus)$/i.test(p.trim()));
      
      if (validParts.length > 1) {
        const items = [];
        for (const part of validParts) {
          // Extract quantity and unit if present (e.g., "2 bottles of water")
          const qtyMatch = part.match(/^(\d+(?:\.\d+)?)\s+(\w+)\s+(.+)$/);
          if (qtyMatch) {
            items.push({ 
              item: qtyMatch[3].trim(), 
              quantity: parseFloat(qtyMatch[1]), 
              unit: qtyMatch[2].toLowerCase() 
            });
          } else {
            // Check for word quantities like "a couple of apples"
            const wordQtyMatch = part.match(/^(?:a|an)\s+(\w+)\s+(.+)$/i);
            if (wordQtyMatch) {
              const qtyWords = { 'couple': 2, 'few': 3, 'several': 4, 'dozen': 12 };
              items.push({ 
                item: wordQtyMatch[2].trim(), 
                quantity: qtyWords[wordQtyMatch[1].toLowerCase()] || 1, 
                unit: null 
              });
            } else {
              items.push({ item: part.trim(), quantity: 1, unit: null });
            }
          }
        }
        
        if (items.length > 1) {
          return createIntent({
            action: 'multi',
            items,
            searchFilters: null,
            originalText: text,
            source: 'llm',
            confidence: 0.8
          });
        }
      }
    }
    
    throw new Error('Mock LLM could not parse');
  }
}