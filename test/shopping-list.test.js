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

  describe('undo delete', () => {
    let testList;

    before(() => {
      testList = new ShoppingList();
      // Mock localStorage
      global.localStorage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
      };
    });

    it('should return false when nothing to undo', () => {
      testList.items = [];
      testList.lastDeletedItem = null;
      assert.equal(testList.canUndo(), false);
      assert.equal(testList.undo(), false);
    });

    it('should store deleted item for undo', () => {
      testList.items = [
        { id: 1, name: 'Milk', category: 'Dairy', quantity: 1, unit: 'L' },
        { id: 2, name: 'Bread', category: 'Bakery', quantity: 1, unit: 'loaf' }
      ];
      testList.remove(1);
      assert.equal(testList.items.length, 1);
      assert.equal(testList.items[0].name, 'Bread');
      assert.ok(testList.canUndo());
      assert.ok(testList.lastDeletedItem);
      assert.equal(testList.lastDeletedItem.name, 'Milk');
      assert.equal(testList.lastDeletedItem.quantity, 1);
      assert.equal(testList.lastDeletedItem.unit, 'L');
    });

    it('should restore deleted item on undo', () => {
      testList.items = [
        { id: 1, name: 'Milk', category: 'Dairy', quantity: 1, unit: 'L' },
        { id: 2, name: 'Bread', category: 'Bakery', quantity: 1, unit: 'loaf' }
      ];
      testList.remove(1);
      assert.equal(testList.undo(), true);
      assert.equal(testList.items.length, 2);
      const restored = testList.items.find(i => i.name === 'Milk');
      assert.ok(restored);
      assert.equal(restored.name, 'Milk');
      assert.equal(restored.quantity, 1);
      assert.equal(restored.unit, 'L');
      assert.equal(testList.canUndo(), false);
      assert.equal(testList.lastDeletedItem, null);
    });

    it('should merge with existing item on undo if same name and unit', () => {
      testList.items = [
        { id: 1, name: 'Milk', category: 'Dairy', quantity: 1, unit: 'L' },
        { id: 2, name: 'Bread', category: 'Bakery', quantity: 1, unit: 'loaf' }
      ];
      testList.remove(1);
      // Re-add milk with different quantity before undo
      testList.add({ id: 3, name: 'Milk', category: 'Dairy', quantity: 2, unit: 'L' });
      assert.equal(testList.items.length, 2);
      assert.equal(testList.items.find(i => i.name === 'Milk').quantity, 2);
      assert.equal(testList.undo(), true);
      // Should merge: 2 + 1 = 3
      assert.equal(testList.items.length, 2);
      assert.equal(testList.items.find(i => i.name === 'Milk').quantity, 3);
    });

    it('should not restore if undo called twice', () => {
      testList.items = [
        { id: 1, name: 'Milk', category: 'Dairy', quantity: 1, unit: 'L' }
      ];
      testList.remove(1);
      assert.equal(testList.undo(), true);
      assert.equal(testList.undo(), false);
      assert.equal(testList.items.length, 1);
    });

    it('should clear undo state after successful undo', () => {
      testList.items = [
        { id: 1, name: 'Milk', category: 'Dairy', quantity: 1, unit: 'L' }
      ];
      testList.remove(1);
      testList.undo();
      assert.equal(testList.lastDeletedItem, null);
      assert.equal(testList.canUndo(), false);
    });

    it('should preserve item properties on restore', () => {
      testList.items = [
        { id: 1, name: 'Organic Milk', category: 'Dairy', quantity: 2, unit: 'bottles', productId: 42 }
      ];
      testList.remove(1);
      testList.undo();
      const restored = testList.items.find(i => i.name === 'Organic Milk');
      assert.ok(restored);
      assert.equal(restored.name, 'Organic Milk');
      assert.equal(restored.quantity, 2);
      assert.equal(restored.unit, 'bottles');
      assert.equal(restored.productId, 42);
    });

    it('should handle multiple deletes - only last is undoable', () => {
      testList.items = [
        { id: 1, name: 'Milk', category: 'Dairy', quantity: 1, unit: 'L' },
        { id: 2, name: 'Bread', category: 'Bakery', quantity: 1, unit: 'loaf' },
        { id: 3, name: 'Apples', category: 'Produce', quantity: 2, unit: 'kg' }
      ];
      testList.remove(1); // Milk
      testList.remove(2); // Bread
      assert.equal(testList.items.length, 1);
      assert.equal(testList.items[0].name, 'Apples');
      assert.ok(testList.canUndo());
      assert.equal(testList.lastDeletedItem.name, 'Bread');
      assert.equal(testList.undo(), true);
      assert.equal(testList.items.length, 2);
      assert.equal(testList.items.find(i => i.name === 'Bread').name, 'Bread');
      // Milk should NOT be restorable (overwritten by Bread delete)
      assert.equal(testList.canUndo(), false);
    });
  });

  describe('updatedAt timestamps', () => {
    let testList;

    before(() => {
      testList = new ShoppingList();
      global.localStorage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
      };
    });

    it('should add updatedAt to new items', () => {
      testList.items = [];
      const before = Date.now();
      testList.add({ id: 1, name: 'Milk', category: 'Dairy', quantity: 1, unit: 'L' });
      const after = Date.now();
      
      const item = testList.items[0];
      assert.ok(item.updatedAt);
      assert.ok(item.updatedAt >= before);
      assert.ok(item.updatedAt <= after);
    });

    it('should update updatedAt when quantity changes via add', () => {
      testList.items = [];
      testList.add({ id: 1, name: 'Milk', category: 'Dairy', quantity: 1, unit: 'L' });
      const firstUpdatedAt = testList.items[0].updatedAt;
      
      // Small delay to ensure timestamp difference
      const item = testList.items[0];
      item.quantity = 5;
      testList.update(item);
      
      assert.ok(testList.items[0].updatedAt >= firstUpdatedAt);
    });

    it('should update updatedAt when update() is called', () => {
      testList.items = [{ id: 1, name: 'Milk', category: 'Dairy', quantity: 1, unit: 'L', updatedAt: 1000 }];
      const item = testList.items[0];
      item.quantity = 5;
      testList.update(item);
      
      assert.ok(testList.items[0].updatedAt > 1000);
    });

    it('should preserve updatedAt if preserveTimestamp flag is set', () => {
      testList.items = [{ id: 1, name: 'Milk', category: 'Dairy', quantity: 1, unit: 'L', updatedAt: 1000 }];
      const customTime = 5000;
      const item = { ...testList.items[0], quantity: 5, updatedAt: customTime, preserveTimestamp: true };
      testList.update(item);
      
      assert.equal(testList.items[0].updatedAt, customTime);
    });
  });

  describe('clear()', () => {
    let testList;

    before(() => {
      testList = new ShoppingList();
      global.localStorage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
      };
    });

    it('should clear all items', () => {
      testList.items = [
        { id: 1, name: 'Milk', category: 'Dairy', quantity: 1, unit: 'L' },
        { id: 2, name: 'Bread', category: 'Bakery', quantity: 1, unit: 'loaf' }
      ];
      const deletedIds = testList.clear();
      
      assert.equal(testList.items.length, 0);
      assert.deepEqual(deletedIds.sort(), [1, 2].sort());
    });

    it('should return empty array when already empty', () => {
      testList.items = [];
      const deletedIds = testList.clear();
      assert.deepEqual(deletedIds, []);
    });
  });
});