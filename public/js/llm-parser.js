import { createIntent } from './intent-schema.js';

export class LLMIntentParser {
  constructor(options = {}) {
    this.apiEndpoint = options.apiEndpoint || '/api/parse-intent';
    this.timeout = options.timeout || 5000;
  }

  async parse(text, locale = 'en-US') {
    const response = await this.callLLM(text, locale);
    return this.validateAndNormalize(response, text);
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

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      return data.intent || data;
    } finally {
      clearTimeout(timeoutId);
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
    const operations = Array.isArray(parsed.operations) ? parsed.operations : null;

    if (items.length === 0 && (!operations || operations.length === 0)) {
      throw new Error('No items found in LLM response');
    }

    if (parsed.action === 'multi' && operations && operations.length > 0) {
      return createIntent({
        action: 'multi',
        operations,
        originalText,
        source: 'llm',
        confidence: parsed.confidence ?? 0.7
      });
    }

    if (parsed.action === 'multi') throw new Error('Multi response must include explicit operations');

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
