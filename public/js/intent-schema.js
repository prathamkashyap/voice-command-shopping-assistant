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
    operations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'remove', 'modify'] },
          item: { type: 'string' },
          quantity: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'] }
        },
        required: ['action', 'item']
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

const ITEM_ACTIONS = new Set(['add', 'remove', 'modify']);

export function createIntent({ action, items = [], operations = null, searchFilters = null, originalText, source = 'rule', confidence = 1.0 }) {
  const normalizedItems = items.map(item => ({
    item: String(item.item || '').trim(),
    quantity: typeof item.quantity === 'number' ? item.quantity : 1,
    unit: item.unit ? String(item.unit).toLowerCase() : null
  })).filter(item => item.item);

  const normalizedOperations = Array.isArray(operations)
    ? operations.map(operation => {
        const operationAction = ITEM_ACTIONS.has(operation.action) ? operation.action : null;
        if (!operationAction) {
          throw new Error(`Invalid multi operation action: ${operation.action}`);
        }
        return {
          action: operationAction,
          item: String(operation.item || '').trim(),
          quantity: typeof operation.quantity === 'number' ? operation.quantity : 1,
          unit: operation.unit ? String(operation.unit).toLowerCase() : null
        };
      }).filter(operation => operation.item)
    : null;

  const intent = {
    action,
    items: normalizedItems,
    operations: normalizedOperations,
    searchFilters,
    originalText,
    source,
    confidence
  };

  if (action === 'multi') {
    if (normalizedOperations && normalizedOperations.length > 0) {
      intent.items = normalizedOperations.map(({ action: _operationAction, ...item }) => item);
    } else if (normalizedOperations !== null) {
      throw new Error('Intent multi requires at least one operation');
    } else {
      intent.operations = normalizedItems.map(item => ({ action: 'add', ...item }));
    }

    if (intent.items.length === 0 || intent.operations.length === 0) {
      throw new Error('Intent multi requires at least one item');
    }
  } else {
    intent.operations = null;
  }

  if (ITEM_ACTIONS.has(action) && normalizedItems.length === 0) {
    throw new Error(`Intent ${action} requires at least one item`);
  }

  if (action === 'search' && searchFilters) {
    intent.searchFilters = {
      query: searchFilters.query || '',
      maxPrice: searchFilters.maxPrice ?? null,
      brand: searchFilters.brand ?? null,
      isOrganic: searchFilters.isOrganic ?? false,
      category: searchFilters.category ?? null
    };
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
