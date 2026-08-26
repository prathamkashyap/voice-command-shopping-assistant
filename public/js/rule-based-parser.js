import { CommandParser } from './command-parser.js';
import { createIntent, normalizeLegacyParsed } from './intent-schema.js';

export class RuleBasedIntentParser {
  constructor(productCatalog) {
    this.parser = new CommandParser(productCatalog);
  }

  parse(text) {
    const parsed = this.parser.parse(text);
    return normalizeLegacyParsed(parsed, 'rule');
  }
}