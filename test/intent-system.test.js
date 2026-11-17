import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { 
  createIntent, 
  normalizeLegacyParsed, 
  IntentSchema 
} from '../public/js/intent-schema.js';
import { RuleBasedIntentParser } from '../public/js/rule-based-parser.js';
import { MockLLMIntentParser } from '../public/js/llm-parser.js';
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

describe('MockLLMIntentParser', () => {
  let parser;

  before(() => {
    parser = new MockLLMIntentParser();
  });

  it('should parse multi-item add command', async () => {
    const intent = await parser.parse('add milk and bread');
    assert.equal(intent.action, 'multi');
    assert.equal(intent.items.length, 2);
    assert.equal(intent.items[0].item, 'milk');
    assert.equal(intent.items[1].item, 'bread');
    assert.equal(intent.source, 'llm');
  });

  it('should parse comma-separated items', async () => {
    const intent = await parser.parse('add milk, bread, and apples');
    assert.equal(intent.action, 'multi');
    assert.equal(intent.items.length, 3);
  });

  it('should throw for single item commands', async () => {
    await assert.rejects(
      parser.parse('add milk'),
      /Mock LLM could not parse/
    );
  });
});

describe('HybridIntentParser', () => {
  let parser;

  before(() => {
    parser = new HybridIntentParser(mockCatalog, {
      useMockLLM: true,
      llmEnabled: true,
      fallbackToLLM: true
    });
  });

  it('should use rule-based parser for simple commands', async () => {
    const intent = await parser.parse('add milk');
    assert.equal(intent.action, 'add');
    assert.equal(intent.items[0].item, 'milk');
    assert.equal(intent.source, 'rule');
  });

  it('should use LLM fallback for multi-item commands', async () => {
    const intent = await parser.parse('add milk and bread');
    assert.equal(intent.action, 'multi');
    assert.equal(intent.items.length, 2);
    assert.equal(intent.source, 'hybrid');
  });

  it('should use LLM fallback for comma-separated items', async () => {
    const intent = await parser.parse('add milk, bread, and apples');
    assert.equal(intent.action, 'multi');
    assert.equal(intent.items.length, 3);
  });

  it('should handle rule-based parser errors with LLM fallback', async () => {
    const intent = await parser.parse('add milk and bread');
    assert.equal(intent.action, 'multi');
  });

  it('should return rule-based result when LLM disabled', async () => {
    parser.setLLMEnabled(false);
    const intent = await parser.parse('add milk and bread');
    // When LLM disabled, falls back to rule-based which parses as single item
    assert.equal(intent.action, 'add');
    assert.equal(intent.source, 'rule');
  });
});

describe('Multi-item command support', () => {
  let parser;

  before(() => {
    parser = new HybridIntentParser(mockCatalog, {
      useMockLLM: true,
      llmEnabled: true
    });
  });

  it('should handle "add milk and bread"', async () => {
    const intent = await parser.parse('add milk and bread');
    assert.equal(intent.action, 'multi');
    assert.equal(intent.items.length, 2);
    const itemNames = intent.items.map(i => i.item).sort();
    assert.deepEqual(itemNames, ['bread', 'milk']);
  });

  it('should handle "buy apples, bananas, and bread"', async () => {
    const intent = await parser.parse('buy apples, bananas, and bread');
    assert.equal(intent.action, 'multi');
    // "apples", "bananas", "bread" = 3 items
    assert.equal(intent.items.length, 3);
  });

  it('should handle "get milk and 2 bottles of water"', async () => {
    const intent = await parser.parse('get milk and 2 bottles of water');
    assert.equal(intent.action, 'multi');
    assert.equal(intent.items.length, 2);
  });

  it('should handle "I need milk and bread"', async () => {
    const intent = await parser.parse('I need milk and bread');
    assert.equal(intent.action, 'multi');
    assert.equal(intent.items.length, 2);
  });
});