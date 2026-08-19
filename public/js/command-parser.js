const QUANTITY_WORDS = {
  'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
  'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
  'a': 1, 'an': 1, 'couple': 2, 'few': 3, 'several': 4, 'dozen': 12
};

const UNITS = ['bottle', 'bottles', 'pack', 'packs', 'box', 'boxes', 'kg', 'kgs', 'kilogram', 'kilograms',
  'g', 'gram', 'grams', 'l', 'liter', 'liters', 'litre', 'litres', 'ml', 'milliliter', 'milliliters',
  'pcs', 'piece', 'pieces', 'dozen', 'unit', 'units', 'can', 'cans', 'jar', 'jars', 'bag', 'bags'];

const ACTION_PATTERNS = {
  add: [
    /\b(add|buy|get|put|need|want|grab|pick up)\b/i,
    /\b(i need|i want|i want to buy|i would like)\b/i
  ],
  remove: [
    /\b(remove|delete|take off|take out|drop)\b/i,
    /\b(remove from|take off from)\b/i
  ],
  modify: [
    /\b(change|update|modify|set)\b/i,
    /\b(change quantity|update quantity)\b/i
  ],
  search: [
    /\b(find|search|look for|show me)\b/i,
    /\b(find me|show me)\b/i
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

    text = text.replace(/\b(from my list|to my list|on my list|in my list)\b/gi, '').trim();
    text = text.replace(/^(i|we)\s+/i, '').trim();
    text = text.replace(/^(please|kindly)\s+/i, '').trim();
    
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
    const numberMatch = text.match(/(\d+(?:\.\d+)?)\s*(\w+)?/);
    if (numberMatch) {
      const quantity = parseFloat(numberMatch[1]);
      const potentialUnit = numberMatch[2]?.toLowerCase();
      const unit = UNITS.includes(potentialUnit) ? potentialUnit : null;
      return {
        quantity,
        unit,
        fullMatch: numberMatch[0]
      };
    }

    for (const [word, value] of Object.entries(QUANTITY_WORDS)) {
      const regex = new RegExp(`\\b${word}\\s+(\\w+)?`, 'i');
      const match = text.match(regex);
      if (match) {
        const potentialUnit = match[1]?.toLowerCase();
        const unit = UNITS.includes(potentialUnit) ? potentialUnit : null;
        return {
          quantity: value,
          unit,
          fullMatch: match[0]
        };
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