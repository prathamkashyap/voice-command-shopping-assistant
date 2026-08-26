import { RuleBasedIntentParser } from './rule-based-parser.js';
import { LLMIntentParser, MockLLMIntentParser } from './llm-parser.js';
import { createIntent } from './intent-schema.js';

export class HybridIntentParser {
  constructor(productCatalog, options = {}) {
    this.ruleParser = new RuleBasedIntentParser(productCatalog);
    this.llmParser = options.useMockLLM 
      ? new MockLLMIntentParser() 
      : new LLMIntentParser({ 
          apiEndpoint: options.apiEndpoint || '/api/parse-intent',
          timeout: options.timeout || 5000,
          enabled: options.llmEnabled !== false
        });
    this.fallbackToLLM = options.fallbackToLLM !== false;
    this.llmEnabled = options.llmEnabled !== false;
  }

  async parse(text, locale = 'en-US') {
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      const ruleResult = this.ruleParser.parse(text);
      
      if (this.shouldUseLLMFallback(ruleResult, text)) {
        if (this.llmEnabled) {
          try {
            const llmResult = await this.llmParser.parse(text, locale);
            const merged = this.mergeResults(ruleResult, llmResult, text);
            const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
            merged.latencyMs = Math.round(elapsed);
            return merged;
          } catch (llmError) {
            console.warn('LLM fallback failed, using rule-based result:', llmError.message);
            const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
            ruleResult.latencyMs = Math.round(elapsed);
            return ruleResult;
          }
        }
      }
      
      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
      ruleResult.latencyMs = Math.round(elapsed);
      return ruleResult;
    } catch (ruleError) {
      if (this.fallbackToLLM && this.llmEnabled) {
        try {
          const llmResult = await this.llmParser.parse(text, locale);
          const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
          return { ...llmResult, source: 'hybrid-fallback', confidence: 0.6, latencyMs: Math.round(elapsed) };
        } catch (llmError) {
          throw new Error(`Both parsers failed. Rule: ${ruleError.message}, LLM: ${llmError.message}`);
        }
      }
      throw ruleError;
    }
  }

  shouldUseLLMFallback(ruleResult, text) {
    const lowerText = text.toLowerCase();
    
    if (ruleResult.action === 'multi') return true;
    if (ruleResult.items.length > 1) return true;
    if (lowerText.includes(' and ') && !lowerText.includes('brand')) return true;
    if (lowerText.match(/\b(add|buy|get).+?(?:and|,).+?(?:add|buy|get)/i)) return true;
    if (ruleResult.confidence < 0.8) return true;
    
    return false;
  }

  mergeResults(ruleResult, llmResult, originalText) {
    if (llmResult.action === 'multi' && ruleResult.action !== 'multi') {
      return { ...llmResult, source: 'hybrid', confidence: 0.85 };
    }
    
    if (llmResult.items.length > ruleResult.items.length) {
      return { ...llmResult, source: 'hybrid', confidence: 0.85 };
    }
    
    if (ruleResult.action === 'search' && llmResult.action === 'search') {
      const mergedFilters = { ...ruleResult.searchFilters, ...llmResult.searchFilters };
      return createIntent({
        action: 'search',
        items: [],
        searchFilters: mergedFilters,
        originalText,
        source: 'hybrid',
        confidence: 0.9
      });
    }
    
    return ruleResult;
  }

  setLLMEnabled(enabled) {
    this.llmEnabled = enabled;
  }
}