import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RecommendationEngine } from '../public/js/recommendation-engine.js';

describe('RecommendationEngine', () => {
  let storage;
  let engine;

  beforeEach(() => {
    storage = {};
    global.localStorage = {
      getItem: key => storage[key] ?? null,
      setItem: (key, value) => { storage[key] = String(value); },
      removeItem: key => { delete storage[key]; }
    };

    const shoppingList = {
      getAll: () => [{ id: '1', name: 'Bread', category: 'Bakery', quantity: 1, unit: 'loaf' }]
    };
    const productCatalog = {
      products: [
        { id: 1, name: 'Milk', category: 'Dairy', price: 3.49, keywords: ['milk'] },
        { id: 2, name: 'Almond Milk', category: 'Dairy', price: 4.99, keywords: ['almond milk'] }
      ],
      getById(id) { return this.products.find(p => p.id === id); },
      findBestMatch(name) { return this.products.find(p => p.name.toLowerCase() === name.toLowerCase()) || null; },
      getSeasonal() { return []; },
      getSubstitutes(name) { return name.toLowerCase() === 'bread' ? [] : []; }
    };

    engine = new RecommendationEngine(shoppingList, productCatalog);
  });

  it('suggests frequently purchased items that are not already on the list', () => {
    engine.recordPurchase([{ name: 'Milk', category: 'Dairy', productId: 1 }]);
    engine.recordPurchase([{ name: 'Milk', category: 'Dairy', productId: 1 }]);

    const suggestions = engine.getSuggestions();
    const milk = suggestions.find(s => s.product?.name === 'Milk');

    assert.ok(milk);
    assert.equal(milk.type, 'history');
    assert.equal(milk.reason, 'You buy this often');
  });

  it('does not suggest items already on the shopping list', () => {
    engine.recordPurchase([{ name: 'Bread', category: 'Bakery' }]);
    const names = engine.getSuggestions().map(s => s.product?.name);
    assert.ok(!names.includes('Bread'));
  });

  it('persists only the most recent history entries', () => {
    for (let i = 0; i < 55; i += 1) {
      engine.recordPurchase([{ name: `Item ${i}`, category: 'Pantry' }]);
    }

    const saved = JSON.parse(storage.voice_shopping_history);
    assert.equal(saved.length, 50);
    assert.equal(saved[0].name, 'Item 5');
    assert.equal(saved.at(-1).name, 'Item 54');
  });
});
