export const IntentSchema = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['add', 'remove', 'modify', 'search', 'multi'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item: { type: 'string' },
          quantity: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'] }
        },
        required: ['item']
      }
    },
    searchFilters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        maxPrice: { type: ['number', 'null'] },
        brand: { type: ['string', 'null'] },
        isOrganic: { type: 'boolean' },
        category: { type: ['string', 'null'] }
      }
    },
    originalText: { type: 'string' },
    source: { type: 'string', enum: ['rule', 'llm', 'hybrid'] },
    confidence: { type: 'number' }
  },
  required: ['action', 'originalText']
};

export function createIntent({ action, items = [], searchFilters = null, originalText, source = 'rule', confidence = 1.0 }) {
  const intent = {
    action,
    items: items.map(item => ({
      item: String(item.item || '').trim(),
      quantity: typeof item.quantity === 'number' ? item.quantity : 1,
      unit: item.unit ? String(item.unit).toLowerCase() : null
    })).filter(item => item.item),
    searchFilters,
    originalText,
    source,
    confidence
  };

  if (action === 'search' && searchFilters) {
    intent.searchFilters = {
      query: searchFilters.query || '',
      maxPrice: searchFilters.maxPrice ?? null,
      brand: searchFilters.brand ?? null,
      isOrganic: searchFilters.isOrganic ?? false,
      category: searchFilters.category ?? null
    };
  }

  if ((action === 'add' || action === 'remove' || action === 'modify') && intent.items.length === 0) {
    throw new Error(`Intent ${action} requires at least one item`);
  }

  return intent;
}

export function normalizeLegacyParsed(parsed, source = 'rule') {
  if (parsed.action === 'search') {
    return createIntent({
      action: 'search',
      items: [],
      searchFilters: {
        query: parsed.item,
        maxPrice: parsed.maxPrice,
        brand: parsed.brand,
        isOrganic: parsed.isOrganic,
        category: parsed.category
      },
      originalText: parsed.originalText,
      source,
      confidence: 0.9
    });
  }

  const item = {
    item: parsed.item,
    quantity: parsed.quantity ?? 1,
    unit: parsed.unit ?? null
  };

  return createIntent({
    action: parsed.action,
    items: [item],
    searchFilters: null,
    originalText: parsed.originalText,
    source,
    confidence: 0.9
  });
}