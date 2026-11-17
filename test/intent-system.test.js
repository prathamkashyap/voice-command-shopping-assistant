import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { 
  createIntent, 
  normalizeLegacyParsed, 
  IntentSchema 
} from '../public/js/intent-schema.js';
import { RuleBasedIntentParser } from '../public/js/rule-based-parser.js';
import { readFileSync } from 'node:fs';
import { LLMIntentParser } from '../public/js/llm-parser.js';
import { HybridIntentParser } from '../public/js/hybrid-parser.js';

const mockCatalog = {
  products: [
    { id: 1, name: 'Milk', category: 'Dairy', keywords: ['milk', 'dairy'], price: 3.99, size: '1L', brand: 'Local', substitutes: ['Almond Milk'] },
    { id: 2, name: 'Bread', category: 'Bakery', keywords: ['bread', 'bakery'], price: 2.49, size: '1 loaf', brand: 'Local', substitutes: ['Gluten-free Bread'] },
    { id: 3, name: 'Apples', category: 'Produce', keywords: ['apples', 'fruit'], price: 4.99, size: '1 kg', brand: 'Organic Farm', substitutes: ['Pears'] },
    { id: 4, name: 'Organic Tomatoes', category: 'Produce', keywords: ['tomatoes', 'organic', 'vegetable'], price: 3.99, size: '500g', brand: 'Organic Farm', substitutes: ['Regular Tomatoes'] },
    { id: 5, name: 'Water', category: 'Beverages', keywords: ['water', 'bottled water'], price: 1.99, size: '1.5L', brand: 'SpringCo', substitutes: ['Sparkling Water'] },
  ],
  findBestMatch: function(query) {
    const lowerQuery = query.toLowerCase();
    for (const product of this.products) {
      if (product.name.toLowerCase() === lowerQuery) return product;
      if (product.name.toLowerCase().includes(lowerQuery)) return product;
      for (const keyword of product.keywords) {
        if (keyword.toLowerCase().includes(lowerQuery)) return product;
      }
    }
    return null;
  }
};

describe('Intent Schema', () => {
  describe('createIntent', () => {
    it('should create valid add intent', () => {
      const intent = createIntent({
        action: 'add',
        items: [{ item: 'milk', quantity: 2, unit: 'bottles' }],
        originalText: 'Add 2 bottles of milk',
        source: 'rule',
        confidence: 0.9
      });
      
      assert.equal(intent.action, 'add');
      assert.deepEqual(intent.items, [{ item: 'milk', quantity: 2, unit: 'bottles' }]);
      assert.equal(intent.searchFilters, null);
      assert.equal(intent.source, 'rule');
      assert.equal(intent.confidence, 0.9);
    });

    it('should create valid search intent with filters', () => {
      const intent = createIntent({
        action: 'search',
        items: [],
        searchFilters: {
          query: 'tomatoes',
          maxPrice: 5,
          brand: 'Organic Farm',
          isOrganic: true,
          category: 'Produce'
        },
        originalText: 'Find organic tomatoes under $5',
        source: 'llm',
        confidence: 0.8
      });
      
      assert.equal(intent.action, 'search');
      assert.deepEqual(intent.items, []);
      assert.equal(intent.searchFilters.query, 'tomatoes');
      assert.equal(intent.searchFilters.maxPrice, 5);
      assert.equal(intent.searchFilters.brand, 'Organic Farm');
      assert.equal(intent.searchFilters.isOrganic, true);
      assert.equal(intent.searchFilters.category, 'Produce');
    });

    it('should create valid multi intent', () => {
      const intent = createIntent({
        action: 'multi',
        items: [
          { item: 'milk', quantity: 1, unit: null },
          { item: 'bread', quantity: 2, unit: 'loaves' }
        ],
        originalText: 'Add milk and 2 loaves of bread',
        source: 'hybrid',
        confidence: 0.85
      });
      
      assert.equal(intent.action, 'multi');
      assert.equal(intent.items.length, 2);
      assert.deepEqual(intent.operations.map(op => op.action), ['add', 'add']);
    });

    it('should preserve per-item actions for mixed multi intents', () => {
      const intent = createIntent({
        action: 'multi',
        operations: [
          { action: 'remove', item: 'milk', quantity: 1, unit: null },
          { action: 'add', item: 'bread', quantity: 2, unit: 'loaves' }
        ],
        originalText: 'Remove milk and add 2 loaves of bread',
        source: 'llm',
        confidence: 0.9
      });

      assert.equal(intent.action, 'multi');
      assert.deepEqual(intent.operations.map(op => op.action), ['remove', 'add']);
      assert.equal(intent.items.length, 2);
    });

    it('should throw error for add intent with no items', () => {
      assert.throws(() => createIntent({
        action: 'add',
        items: [],
        originalText: 'Add',
        source: 'rule'
      }), /Intent add requires at least one item/);
    });

    it('should default quantity to 1 when not specified', () => {
      const intent = createIntent({
        action: 'add',
        items: [{ item: 'milk' }],
        originalText: 'Add milk',
        source: 'rule'
      });
      
      assert.equal(intent.items[0].quantity, 1);
    });
  });

  describe('normalizeLegacyParsed', () => {
    it('should normalize add parsed result', () => {
      const parsed = {
        action: 'add',
        item: 'milk',
        quantity: 2,
        unit: 'bottles',
        originalText: 'Add 2 bottles of milk'
      };
      
      const intent = normalizeLegacyParsed(parsed, 'rule');
      
      assert.equal(intent.action, 'add');
      assert.equal(intent.items.length, 1);
      assert.equal(intent.items[0].item, 'milk');
      assert.equal(intent.items[0].quantity, 2);
      assert.equal(intent.items[0].unit, 'bottles');
      assert.equal(intent.source, 'rule');
    });

    it('should normalize search parsed result', () => {
      const parsed = {
        action: 'search',
        item: 'tomatoes',
        maxPrice: 5,
        brand: 'Organic Farm',
        isOrganic: true,
        originalText: 'Find organic tomatoes under $5'
      };
      
      const intent = normalizeLegacyParsed(parsed, 'rule');
      
      assert.equal(intent.action, 'search');
      assert.equal(intent.items.length, 0);
      assert.equal(intent.searchFilters.query, 'tomatoes');
      assert.equal(intent.searchFilters.maxPrice, 5);
      assert.equal(intent.searchFilters.brand, 'Organic Farm');
      assert.equal(intent.searchFilters.isOrganic, true);
    });

    it('should default quantity to 1 when undefined', () => {
      const parsed = {
        action: 'add',
        item: 'bread',
        quantity: undefined,
        unit: null,
        originalText: 'Add bread'
      };
      
      const intent = normalizeLegacyParsed(parsed, 'rule');
      
      assert.equal(intent.items[0].quantity, 1);
    });
  });
});

describe('RuleBasedIntentParser', () => {
  let parser;

  before(() => {
    parser = new RuleBasedIntentParser(mockCatalog);
  });

  it('should parse simple add command', () => {
    const intent = parser.parse('add milk');
    assert.equal(intent.action, 'add');
    assert.equal(intent.items[0].item, 'milk');
    assert.equal(intent.source, 'rule');
  });

  it('should parse add with quantity and unit', () => {
    const intent = parser.parse('add 2 bottles of water');
    assert.equal(intent.action, 'add');
    assert.equal(intent.items[0].item, 'water');
    assert.equal(intent.items[0].quantity, 2);
    assert.equal(intent.items[0].unit, 'bottles');
  });

  it('should parse remove command', () => {
    const intent = parser.parse('remove milk');
    assert.equal(intent.action, 'remove');
    assert.equal(intent.items[0].item, 'milk');
  });

  it('should parse modify command', () => {
    const intent = parser.parse('change quantity of milk to 3');
    assert.equal(intent.action, 'modify');
    assert.equal(intent.items[0].item, 'milk');
    assert.equal(intent.items[0].quantity, 3);
  });

  it('should parse search command', () => {
    const intent = parser.parse('find milk under $5');
    assert.equal(intent.action, 'search');
    assert.equal(intent.searchFilters.query, 'milk');
    assert.equal(intent.searchFilters.maxPrice, 5);
  });

  it('should preserve originalText', () => {
    const intent = parser.parse('Add 2 bottles of water');
    assert.equal(intent.originalText, 'Add 2 bottles of water');
  });
});

describe('HybridIntentParser', () => {
  const cases = [
    ['add candy and bread', [['add', 'candy', 1, null], ['add', 'bread', 1, null]]],
    ['add milk, bread', [['add', 'milk', 1, null], ['add', 'bread', 1, null]]],
    ['buy apples, bananas, and bread', [['add', 'apples', 1, null], ['add', 'bananas', 1, null], ['add', 'bread', 1, null]]],
    ['add 2 apples and 3 bananas', [['add', 'apples', 2, null], ['add', 'bananas', 3, null]]],
    ['get milk and 2 bottles of water', [['add', 'milk', 1, null], ['add', 'water', 2, 'bottles']]],
    ['add milk and remove bread', [['add', 'milk', 1, null], ['remove', 'bread', 1, null]]]
  ];

  for (const [command, expected] of cases) {
    it(`parses "${command}" locally with remote parsing disabled`, async () => {
      const parser = new HybridIntentParser(mockCatalog, { llmEnabled: false });
      const intent = await parser.parse(command);
      assert.equal(intent.source, 'rule');
      assert.equal(intent.action, 'multi');
      assert.deepEqual(intent.operations.map(({ action, item, quantity, unit }) => [action, item, quantity, unit]), expected);
    });
  }

  it('does not let an action word inside an item choose the verb', async () => {
    const parser = new HybridIntentParser(mockCatalog);
    const intent = await parser.parse('add drop biscuits');
    assert.equal(intent.action, 'add');
    assert.equal(intent.items[0].item, 'drop biscuits');
  });

  it('supports multiword brand and filter-only searches', async () => {
    const parser = new HybridIntentParser(mockCatalog);
    const brand = await parser.parse('find rice by India Gate');
    assert.equal(brand.searchFilters.brand, 'india gate');
    assert.equal(brand.searchFilters.query, 'rice');
    const filter = await parser.parse('find organic under $5');
    assert.deepEqual(filter.searchFilters, { query: '', maxPrice: 5, brand: null, isOrganic: true, category: null });
    assert.equal((await parser.parse('find rice $5 or less')).searchFilters.maxPrice, 5);
  });

  it('clarifies ambiguous or invalid recognized commands without forwarding', async t => {
    const parser = new HybridIntentParser(mockCatalog);
    const fetch = t.mock.method(globalThis, 'fetch', () => {});
    for (const command of ['do not remove milk', 'add milk then remove bread', 'add -2 apples', 'add 0 apples', 'remove 2 apples']) {
      await assert.rejects(parser.parse(command));
    }
    assert.equal(fetch.mock.callCount(), 0);
  });

  it('only forwards an unrecognized command when both flags allow it', async t => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({
      intent: { action: 'search', searchFilters: { query: 'milk' } }
    }));
    for (const options of [{ llmEnabled: false }, { fallbackToLLM: false }, { useMockLLM: true }]) {
      await assert.rejects(new HybridIntentParser(mockCatalog, options).parse('shopping ideas'));
    }
    await new HybridIntentParser(mockCatalog).parse('add milk and bread');
    assert.equal(fetch.mock.callCount(), 0);
    const intent = await new HybridIntentParser(mockCatalog).parse('shopping ideas');
    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(intent.source, 'llm');
  });

  it('ships the same deterministic parser in the Functions package', () => {
    const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.equal(read('../public/js/command-parser.js'), read('../functions/command-parser.mjs'));
  });
});

describe('LLMIntentParser transport', () => {
  it('keeps the request deadline active while waiting for the response body', async t => {
    t.mock.method(globalThis, 'fetch', async (_url, { signal }) => ({
      ok: true,
      json: () => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        setTimeout(() => resolve({ action: 'add', items: [{ item: 'milk' }] }), 80).unref();
      })
    }));
    await assert.rejects(new LLMIntentParser({ timeout: 10 }).parse('shopping ideas'), { name: 'AbortError' });
  });
});
