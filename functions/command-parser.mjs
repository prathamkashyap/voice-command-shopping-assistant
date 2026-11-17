const QUANTITY_WORDS = {
  'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
  'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
  'a': 1, 'an': 1, 'couple': 2, 'few': 3, 'several': 4, 'dozen': 12
};

const UNITS = ['bottle', 'bottles', 'pack', 'packs', 'box', 'boxes', 'kg', 'kgs', 'kilogram', 'kilograms',
  'g', 'gram', 'grams', 'l', 'liter', 'liters', 'litre', 'litres', 'ml', 'milliliter', 'milliliters',
  'pcs', 'piece', 'pieces', 'dozen', 'unit', 'units', 'can', 'cans', 'jar', 'jars', 'bag', 'bags'];

// Longest units first so e.g. "kilograms" matches before "kg" would short-circuit it
const UNIT_ALTERNATION = [...UNITS].sort((a, b) => b.length - a.length).join('|');

const ACTION_PATTERNS = {
  // Longer, more specific phrases are listed first so they get stripped whole,
  // before the single-word fallback below has a chance to eat part of them
  // and leave stray connector words ("to", "buy") behind in the item text.
  add: [
    /\b(i need|i want to buy|i want|i would like)\b/i,
    /\b(add|buy|get|put|need|want|grab|pick up)\b/i
  ],
  remove: [
    /\b(remove from|take off from)\b/i,
    /\b(remove|delete|take out|drop)\b/i,
    /\btake\b/i,
    /\boff\b/i
  ],
  modify: [
    /\b(change quantity|update quantity)\b/i,
    /\b(change|update|modify|set)\b/i
  ],
  search: [
    /\b(find me|show me)\b/i,
    /\b(find|search|look for|show me)\b/i
  ]
};

// Action *detection* needs its own, globally-ordered list (most specific and
// unambiguous phrasing first, softest/most generic last). Detecting by
// walking ACTION_PATTERNS action-by-action (add, then remove, then modify,
// then search) meant a soft add-ish word like "need"/"want" always won,
// even in a sentence like "I need to remove milk" or "I want to change
// quantity of milk", because "add" was simply checked first. Flattening
// every action's patterns into one priority-ordered list and checking that
// instead lets an explicit verb ("remove", "change quantity", "find") beat
// a generic opener ("I need", "I want") whenever both are present.
const DETECTION_ORDER = [
  { action: 'remove', pattern: /\b(remove from|take off from)\b/i },
  { action: 'modify', pattern: /\b(change quantity|update quantity)\b/i },
  { action: 'search', pattern: /\b(find me|show me)\b/i },
  { action: 'remove', pattern: /\b(remove|delete|take out|drop)\b/i },
  { action: 'modify', pattern: /\b(change|update|modify|set)\b/i },
  { action: 'search', pattern: /\b(find|search|look for)\b/i },
  { action: 'add', pattern: /\b(add|buy|get|put|need|want|grab|pick up|would like)\b/i },
  { action: 'remove', pattern: /\btake\b/i },
  { action: 'remove', pattern: /\boff\b/i }
];

const PRICE_PATTERNS = [
  /(?:under|below|less than|cheaper than)\s*\$?(\d+(?:\.\d+)?)/i,
  /\$(\d+(?:\.\d+)?)\s*(?:or less|max|maximum)/i,
  /max(?:imum)?\s*(?:price\s*)?\$?(\d+(?:\.\d+)?)/i
];

const BRAND_PATTERN = /\b(?:brand|by)\s+(.+)$/i;

const ORGANIC_PATTERN = /\b(organic|bio)\b/i;

// Only a wholly unrecognized request may be forwarded to the optional endpoint.
// Invalid, incomplete, or ambiguous local commands must request clarification.
export class UnrecognizedCommandError extends Error {}

const COMMAND_START = /^(?:(?:please|kindly)\s+)?(?:i need|i want|i would like|we need|we want|add|buy|get|put|need|want|grab|pick up|remove|delete|take|drop|change|update|modify|set|find|search|look for|show me)\b/i;
const AMBIGUOUS = /\b(?:no|not|never|don['’]t|without|except|unless|instead|then|if|or)\b/i;
const POLITE_PREFIX = /^(?:please|kindly)\s+/i;
const REQUEST_PREFIX = /^(?:i|we)\s+(?:need|want|would like)\s+to\s+/i;

export class CommandParser {
  constructor(productCatalog) {
    this.productCatalog = productCatalog;
  }

  parseIntent(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) {
      throw new Error('Enter a shopping command of up to 1,000 characters.');
    }
    if (AMBIGUOUS.test(text.replace(/\bor less\b/gi, 'maximum'))) {
      throw new Error('Please clarify the command or submit each action separately.');
    }
    const clauses = text.trim().split(/,\s*and\b|,|\band\b/i).map(part => part.trim());
    if (clauses.length > 32 || clauses.some(part => !part)) {
      throw new Error('Please specify an item for each action and limit the command to 32 items.');
    }
    if (!COMMAND_START.test(clauses[0])) {
      if (this.detectAction(text)) throw new Error('Please start the command with the intended action.');
      throw new UnrecognizedCommandError("I didn't understand that command. Try 'Add milk'.");
    }
    const operations = [];
    let action;
    for (const clause of clauses) {
      const bare = clause.replace(POLITE_PREFIX, '');
      const request = bare.replace(REQUEST_PREFIX, '');
      const explicit = COMMAND_START.test(request) ? request : bare;
      const command = COMMAND_START.test(explicit) ? explicit : `${action} ${clause}`;
      if (/(?:^|\s)-\s*\d/.test(command)) throw new Error('Use a positive quantity or price.');
      const start = command.match(COMMAND_START)?.[0];
      const parsed = this.parse(command, this.detectAction(start || ''));
      action = parsed.action;
      if (parsed.item && /\s(?:add|remove|delete|modify|change|buy)\s/i.test(parsed.item)) {
        throw new Error('Please separate each action with a comma or the word "and".');
      }
      if (action === 'search') {
        if (clauses.length !== 1) throw new Error('Please submit a search separately from other items or actions.');
        return {
          action, items: [], operations: null, originalText: text,
          searchFilters: { query: parsed.item || '', maxPrice: parsed.maxPrice, brand: parsed.brand, isOrganic: parsed.isOrganic, category: null }
        };
      }
      if (action === 'modify' && parsed.quantity == null) throw new Error('Specify the new quantity.');
      if (action === 'remove' && parsed.quantity != null) throw new Error('Please clarify whether to remove the item or change its quantity.');
      const quantity = parsed.quantity ?? 1;
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e6) throw new Error('Use a quantity above zero and at most 1,000,000.');
      if (parsed.item.length > 160) throw new Error('Use an item name of at most 160 characters.');
      operations.push({ action, item: parsed.item, quantity, unit: parsed.unit ?? null });
    }
    const items = operations.map(({ item, quantity, unit }) => ({ item, quantity, unit }));
    return {
      action: operations.length === 1 ? action : 'multi',
      items, operations: operations.length === 1 ? null : operations, searchFilters: null, originalText: text
    };
  }

  parse(text, explicitAction) {
    const lowerText = text.toLowerCase().trim();
    
    const action = explicitAction ?? this.detectAction(lowerText);
    if (!action) {
      throw new Error("I didn't understand that command. Try 'Add milk' or 'Find toothpaste under $5'.");
    }

    const parsed = { action, originalText: text };

    if (action === 'search') {
      return this.parseSearch(lowerText, parsed);
    }

    return this.parseItemCommand(lowerText, parsed);
  }

  detectAction(text) {
    for (const { action, pattern } of DETECTION_ORDER) {
      if (pattern.test(text)) {
        return action;
      }
    }
    return null;
  }

  parseItemCommand(text, parsed) {
    const quantityMatch = this.extractQuantity(text);
    if (quantityMatch) {
      parsed.quantity = quantityMatch.quantity;
      parsed.unit = quantityMatch.unit;
      text = this.removeSpan(text, quantityMatch.index, quantityMatch.fullMatch.length);
    }

    const actionPatterns = ACTION_PATTERNS[parsed.action];
    for (const pattern of actionPatterns) {
      text = text.replace(pattern, '').trim();
    }

    text = this.stripFillerPhrases(text);

    text = text.replace(/\b(from my list|to my list|on my list|in my list|off my list)\b/gi, '').trim();
    text = text.replace(/\bmy list\b/gi, '').replace(/\s+/g, ' ').trim();
    text = text.replace(/^(i|we)\s+/i, '').trim();

    // Clean up connector words left behind by the phrase stripping above,
    // e.g. "of water" -> "water", "milk quantity to" -> "milk"
    text = text.replace(/\b(quantity to|quantity)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    text = text.replace(/^(to|of)\s+/i, '').trim();
    text = text.replace(/\s+(to|of)$/i, '').trim();
    
    parsed.item = text || null;
    
    if (!parsed.item) {
      throw new Error("Please specify what item to " + parsed.action);
    }

    return parsed;
  }

  parseSearch(text, parsed) {
    parsed.maxPrice = this.extractPrice(text);
    
    for (const pattern of PRICE_PATTERNS) {
      text = text.replace(pattern, '').trim();
    }
    parsed.brand = text.match(BRAND_PATTERN)?.[1]?.trim() || null;
    text = text.replace(BRAND_PATTERN, '').trim();
    parsed.isOrganic = ORGANIC_PATTERN.test(text);
    text = text.replace(ORGANIC_PATTERN, '').trim();

    const searchPatterns = ACTION_PATTERNS.search;
    for (const pattern of searchPatterns) {
      text = text.replace(pattern, '').trim();
    }

    text = this.stripFillerPhrases(text);
    text = text.replace(/\b(me|for|some|any)\b/gi, '').trim();
    
    parsed.item = text || null;
    
    if (!parsed.item && parsed.maxPrice == null && !parsed.brand && !parsed.isOrganic) {
      throw new Error("Please specify what to search for");
    }

    return parsed;
  }

  // Removes exactly the matched span at `index`..`index+length`, rather than
  // a plain string.replace(needle, ''), which would remove the *first*
  // occurrence of that text anywhere in the string (unsafe for short/common
  // matches like the word "a").
  removeSpan(text, index, length) {
    return (text.slice(0, index) + text.slice(index + length)).replace(/\s+/g, ' ').trim();
  }

  // Strips generic lead-in phrasing ("I need to", "we want to", "I would
  // like") that can precede an explicit action verb no matter which action
  // it turns out to be, e.g. "I need to remove milk" or "I want to search
  // for water". Shared by both item commands (add/remove/modify) and search
  // so the opener doesn't leak into the parsed item text either way.
  stripFillerPhrases(text) {
    return text
      .replace(/\b(i|we)\s+(need to|want to|would like to|need|want|would like)\b/gi, ' ')
      .replace(/^(please|kindly)\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  extractQuantity(text) {
    // Every branch returns `index` alongside `fullMatch` so the caller can
    // remove exactly the matched span (see parseItemCommand). A plain
    // string.replace(fullMatch, '') is NOT safe here: fullMatch is often a
    // short, common substring like "a" (from the word-quantity "a"/"an"),
    // and String.replace with a string argument removes only the *first*
    // occurrence anywhere in the text — which can land inside an unrelated
    // word. E.g. "add a couple of bananas": the bare match "a" would strip
    // the "a" out of "add" itself, mangling it into "dd".

    // Digit-based quantity with a recognized unit right after it, e.g. "2 bottles"
    let match = text.match(new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s+(${UNIT_ALTERNATION})\\b`, 'i'));
    if (match) {
      return { quantity: parseFloat(match[1]), unit: match[2].toLowerCase(), fullMatch: match[0], index: match.index };
    }

    // Digit-based quantity with no unit, e.g. "5 oranges" — only consume the
    // number itself so the following word stays intact as the item name.
    match = text.match(/\b(\d+(?:\.\d+)?)\b/);
    if (match) {
      return { quantity: parseFloat(match[1]), unit: null, fullMatch: match[0], index: match.index };
    }

    // Compound word-quantity with a unit, e.g. "a couple bottles", "a few
    // packs" — checked before the generic per-word loop below so the
    // leading article gets consumed along with "couple"/"few"/etc. instead
    // of being left dangling in the item text (the per-word loop only
    // matches "couple bottles" on its own, not the "a" in front of it).
    const compoundWithUnit = text.match(new RegExp(`\\b(?:a|an)\\s+(couple|few|several|dozen)\\s+(${UNIT_ALTERNATION})\\b`, 'i'));
    if (compoundWithUnit) {
      return {
        quantity: QUANTITY_WORDS[compoundWithUnit[1].toLowerCase()],
        unit: compoundWithUnit[2].toLowerCase(),
        fullMatch: compoundWithUnit[0],
        index: compoundWithUnit.index
      };
    }

    // Word-based quantity with a recognized unit, e.g. "a dozen" -> handled via UNITS,
    // "a couple bottles"
    for (const [word, value] of Object.entries(QUANTITY_WORDS)) {
      const withUnit = text.match(new RegExp(`\\b${word}\\s+(${UNIT_ALTERNATION})\\b`, 'i'));
      if (withUnit) {
        return { quantity: value, unit: withUnit[1].toLowerCase(), fullMatch: withUnit[0], index: withUnit.index };
      }
    }

    // Compound word-quantity with no unit, e.g. "a couple", "a few", "a
    // dozen" (checked only once no unit-attached match above fired) —
    // without this, the bare-word loop below would match just "a" (=1) and
    // leave "couple of"/"few"/etc. stuck in the item text, since "a" is
    // checked before "couple"/"few"/"several"/"dozen" in QUANTITY_WORDS.
    const compound = text.match(/\b(?:a|an)\s+(couple|few|several|dozen)\b/i);
    if (compound) {
      return { quantity: QUANTITY_WORDS[compound[1].toLowerCase()], unit: null, fullMatch: compound[0], index: compound.index };
    }

    // Word-based quantity with no unit, e.g. "a apple", "two bananas" —
    // consume only the quantity word, leave the item name alone.
    for (const [word, value] of Object.entries(QUANTITY_WORDS)) {
      const bare = text.match(new RegExp(`\\b${word}\\b`, 'i'));
      if (bare) {
        return { quantity: value, unit: null, fullMatch: bare[0], index: bare.index };
      }
    }

    return null;
  }

  extractPrice(text) {
    for (const pattern of PRICE_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        return parseFloat(match[1]);
      }
    }
    return null;
  }
}
