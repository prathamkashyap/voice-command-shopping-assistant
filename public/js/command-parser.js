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

const PRICE_PATTERNS = [
  /(?:under|below|less than|cheaper than)\s*\$?(\d+(?:\.\d+)?)/i,
  /\$(\d+(?:\.\d+)?)\s*(?:or less|max|maximum)/i,
  /max(?:imum)?\s*(?:price\s*)?\$?(\d+(?:\.\d+)?)/i
];

const BRAND_PATTERNS = [
  /\b(?:brand|by)\s+([a-zA-Z]+)/i
];

const ORGANIC_PATTERN = /\b(organic|bio)\b/i;

export class CommandParser {
  constructor(productCatalog) {
    this.productCatalog = productCatalog;
  }

  parse(text) {
    const lowerText = text.toLowerCase().trim();
    
    const action = this.detectAction(lowerText);
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
    for (const [action, patterns] of Object.entries(ACTION_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          return action;
        }
      }
    }
    return null;
  }

  parseItemCommand(text, parsed) {
    const quantityMatch = this.extractQuantity(text);
    if (quantityMatch) {
      parsed.quantity = quantityMatch.quantity;
      parsed.unit = quantityMatch.unit;
      text = text.replace(quantityMatch.fullMatch, '').trim();
    }

    const actionPatterns = ACTION_PATTERNS[parsed.action];
    for (const pattern of actionPatterns) {
      text = text.replace(pattern, '').trim();
    }

    text = text.replace(/\b(from my list|to my list|on my list|in my list|off my list)\b/gi, '').trim();
    text = text.replace(/\bmy list\b/gi, '').replace(/\s+/g, ' ').trim();
    text = text.replace(/^(i|we)\s+/i, '').trim();
    text = text.replace(/^(please|kindly)\s+/i, '').trim();

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
    parsed.brand = this.extractBrand(text);
    parsed.isOrganic = ORGANIC_PATTERN.test(text);
    
    for (const pattern of PRICE_PATTERNS) {
      text = text.replace(pattern, '').trim();
    }
    for (const pattern of BRAND_PATTERNS) {
      text = text.replace(pattern, '').trim();
    }
    text = text.replace(ORGANIC_PATTERN, '').trim();

    const searchPatterns = ACTION_PATTERNS.search;
    for (const pattern of searchPatterns) {
      text = text.replace(pattern, '').trim();
    }
    
    text = text.replace(/\b(me|for|some|any)\b/gi, '').trim();
    
    parsed.item = text || null;
    
    if (!parsed.item) {
      throw new Error("Please specify what to search for");
    }

    return parsed;
  }

  extractQuantity(text) {
    // Digit-based quantity with a recognized unit right after it, e.g. "2 bottles"
    let match = text.match(new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s+(${UNIT_ALTERNATION})\\b`, 'i'));
    if (match) {
      return { quantity: parseFloat(match[1]), unit: match[2].toLowerCase(), fullMatch: match[0] };
    }

    // Digit-based quantity with no unit, e.g. "5 oranges" — only consume the
    // number itself so the following word stays intact as the item name.
    match = text.match(/\b(\d+(?:\.\d+)?)\b/);
    if (match) {
      return { quantity: parseFloat(match[1]), unit: null, fullMatch: match[0] };
    }

    // Word-based quantity with a recognized unit, e.g. "a dozen" -> handled via UNITS,
    // "a couple bottles"
    for (const [word, value] of Object.entries(QUANTITY_WORDS)) {
      const withUnit = text.match(new RegExp(`\\b${word}\\s+(${UNIT_ALTERNATION})\\b`, 'i'));
      if (withUnit) {
        return { quantity: value, unit: withUnit[1].toLowerCase(), fullMatch: withUnit[0] };
      }
    }

    // Word-based quantity with no unit, e.g. "a apple", "two bananas" —
    // consume only the quantity word, leave the item name alone.
    for (const [word, value] of Object.entries(QUANTITY_WORDS)) {
      const bare = text.match(new RegExp(`\\b${word}\\b`, 'i'));
      if (bare) {
        return { quantity: value, unit: null, fullMatch: bare[0] };
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

  extractBrand(text) {
    for (const pattern of BRAND_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        return match[1];
      }
    }
    return null;
  }
}