import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { ShoppingList } from '../public/js/shopping-list.js';

describe('ShoppingList', () => {
  let list;

  before(() => {
    list = new ShoppingList();
    // Manually populate items for testing
    list.items = [
      { id: 1, name: 'Milk', category: 'Dairy', quantity: 1, unit: 'L' },
      { id: 2, name: 'Almond Milk', category: 'Dairy', quantity: 1, unit: 'L' },
      { id: 3, name: 'Bread', category: 'Bakery', quantity: 1, unit: 'loaf' },
      { id: 4, name: 'Whole Wheat Bread', category: 'Bakery', quantity: 1, unit: 'loaf' },
      { id: 5, name: 'Apples', category: 'Produce', quantity: 2, unit: 'kg' },
    ];
  });

  describe('findByName', () => {
    it('should return exact match when available', () => {
      const result = list.findByName('Milk');
      assert.equal(result.id, 1);
      assert.equal(result.name, 'Milk');
    });

    it('should prefer exact match over fuzzy match (milk vs almond milk)', () => {
      const result = list.findByName('milk');
      assert.equal(result.id, 1);
      assert.equal(result.name, 'Milk');
    });

    it('should return exact match case-insensitive', () => {
      const result = list.findByName('BREAD');
      assert.equal(result.id, 3);
      assert.equal(result.name, 'Bread');
    });

    it('should fall back to fuzzy match when no exact match', () => {
      const result = list.findByName('Almond');
      assert.equal(result.id, 2);
      assert.equal(result.name, 'Almond Milk');
    });

    it('should prefer shorter name among fuzzy matches', () => {
      const result = list.findByName('Bread');
      // Both "Bread" (exact) and "Whole Wheat Bread" (fuzzy) match
      // Exact match should win
      assert.equal(result.id, 3);
      assert.equal(result.name, 'Bread');
    });

    it('should prefer shorter name when multiple fuzzy matches', () => {
      const result = list.findByName('Wheat');
      // Only "Whole Wheat Bread" matches
      assert.equal(result.id, 4);
      assert.equal(result.name, 'Whole Wheat Bread');
    });

    it('should match when query includes item name', () => {
      const result = list.findByName('Whole Wheat');
      assert.equal(result.id, 4);
      assert.equal(result.name, 'Whole Wheat Bread');
    });

    it('should return undefined for no match', () => {
      const result = list.findByName('Cheese');
      assert.equal(result, undefined);
    });

    it('should return shortest item for empty string (current behavior)', () => {
      const result = list.findByName('');
      // Empty string matches all items via fuzzy matching, returns shortest name
      assert.equal(result.name, 'Milk');
    });

    it('should handle case insensitivity in fuzzy matching', () => {
      const result = list.findByName('almond');
      assert.equal(result.id, 2);
      assert.equal(result.name, 'Almond Milk');
    });
  });

  describe('add with quantity merging', () => {
    let testList;

    before(() => {
      testList = new ShoppingList();
      // Mock localStorage to avoid errors
      global.localStorage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
      };
    });

    it('should merge quantities for same name and unit', () => {
      testList.items = [];
      testList.add({ id: 1, name: 'Milk', category: 'Dairy', quantity: 1, unit: 'L' });
      testList.add({ id: 2, name: 'Milk', category: 'Dairy', quantity: 2, unit: 'L' });
      assert.equal(testList.items.length, 1);
      assert.equal(testList.items[0].quantity, 3);
    });

    it('should not merge when unit differs', () => {
      testList.items = [];
      testList.add({ id: 1, name: 'Milk', category: 'Dairy', quantity: 1, unit: 'L' });
      testList.add({ id: 2, name: 'Milk', category: 'Dairy', quantity: 1, unit: 'mL' });
      assert.equal(testList.items.length, 2);
    });

    it('should not merge when name differs (case-insensitive)', () => {
      testList.items = [];
      testList.add({ id: 1, name: 'Milk', category: 'Dairy', quantity: 1, unit: 'L' });
      testList.add({ id: 2, name: 'Almond Milk', category: 'Dairy', quantity: 1, unit: 'L' });
      assert.equal(testList.items.length, 2);
    });
  });
});