import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ProductCatalog } from '../public/js/product-catalog.js';

describe('ProductCatalog', () => {
  let catalog;

  beforeEach(() => {
    catalog = new ProductCatalog();
    catalog.products = [
      { id: 1, name: 'Milk', category: 'Dairy', brand: 'Amul', size: '1L', price: 3.49, keywords: ['milk', 'dairy'], substitutes: ['Almond Milk'] },
      { id: 2, name: 'Almond Milk', category: 'Dairy', brand: 'Silk', size: '1L', price: 4.99, keywords: ['almond milk', 'organic'], substitutes: ['Milk'] },
      { id: 3, name: 'Apples', category: 'Produce', brand: 'Local', size: '1kg', price: 2.99, keywords: ['apples', 'fruit'], substitutes: ['Pears'] },
      { id: 4, name: 'Organic Apples', category: 'Produce', brand: 'Organic India', size: '1kg', price: 4.99, keywords: ['organic apples', 'fruit'], substitutes: ['Apples'] },
      { id: 5, name: 'Bread', category: 'Bakery', brand: 'Britannia', size: '400g', price: 2.49, keywords: ['bread'], substitutes: [] }
    ];
  });

  it('finds exact matches before fuzzy matches', () => {
    assert.equal(catalog.findBestMatch('milk').name, 'Milk');
    assert.equal(catalog.findBestMatch('apples').name, 'Apples');
  });

  it('matches keywords and returns null-safe best match', () => {
    assert.equal(catalog.findBestMatch('dairy').name, 'Milk');
    assert.equal(catalog.findBestMatch('zzz'), null);
  });

  it('filters search by query, brand, category, price, and organic', () => {
    const results = catalog.search({ query: 'apples', isOrganic: true, maxPrice: 5 });
    assert.deepEqual(results.map(p => p.name), ['Organic Apples']);

    const dairy = catalog.search({ category: 'Dairy', brand: 'silk' });
    assert.deepEqual(dairy.map(p => p.name), ['Almond Milk']);
  });

  it('returns substitutes and seasonal products that exist', () => {
    assert.deepEqual(catalog.getSubstitutes('Milk').map(p => p.name), ['Almond Milk']);
    const seasonal = catalog.getSeasonal(1);
    assert.ok(seasonal.length > 0);
    assert.ok(seasonal.every(p => catalog.products.includes(p)));
  });
});
