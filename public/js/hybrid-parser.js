import { UnrecognizedCommandError } from './command-parser.js';
import { RuleBasedIntentParser } from './rule-based-parser.js';
import { LLMIntentParser } from './llm-parser.js';

export class HybridIntentParser {
  constructor(productCatalog, options = {}) {
    this.ruleParser = new RuleBasedIntentParser(productCatalog);
    this.llmParser = new LLMIntentParser(options);
    this.fallbackToLLM = options.fallbackToLLM !== false;
    this.llmEnabled = options.llmEnabled !== false && !options.useMockLLM;
  }

  async parse(text, locale = 'en-US') {
    const startTime = performance.now();
    let intent;

    try {
      intent = this.ruleParser.parse(text);
    } catch (error) {
      if (!(error instanceof UnrecognizedCommandError) || !this.fallbackToLLM || !this.llmEnabled) {
        throw error;
      }
      intent = await this.llmParser.parse(text, locale);
    }

    return { ...intent, latencyMs: Math.round(performance.now() - startTime) };
  }

  setLLMEnabled(enabled) {
    this.llmEnabled = enabled;
  }
}
