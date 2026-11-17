import { CommandParser } from './command-parser.js';
import { createIntent } from './intent-schema.js';

export class RuleBasedIntentParser {
  constructor(productCatalog) {
    this.parser = new CommandParser(productCatalog);
  }

  parse(text) {
    return createIntent({ ...this.parser.parseIntent(text), source: 'rule', confidence: 0.9 });
  }
}
