import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ProductCatalog } from '../public/js/product-catalog.js';

function validateCatalog(products) {
  assert.ok(Array.isArray(products) && products.length > 0, 'catalog must be a nonempty array');
  const ids = new Set();
  const names = new Set();
  const normalizedNames = new Set();
  for (const [index, product] of products.entries()) {
    const at = `products[${index}]`;
    assert.ok(product && typeof product === 'object', `${at}: expected a product`);
    assert.ok(Number.isSafeInteger(product.id) && product.id > 0 && !ids.has(product.id), `${at}.id: expected a unique positive integer`);
    ids.add(product.id);
    for (const field of ['name', 'category', 'brand', 'size']) {
      assert.ok(typeof product[field] === 'string' && product[field].trim() === product[field] && product[field], `${at}.${field}: expected a trimmed nonempty string`);
    }
    const normalized = product.name.toLowerCase();
    assert.ok(!normalizedNames.has(normalized), `${at}.name: duplicate product name`);
    names.add(product.name);
    normalizedNames.add(normalized);
    assert.ok(Number.isFinite(product.price) && product.price >= 0, `${at}.price: expected a nonnegative finite price`);
    for (const field of ['keywords', 'substitutes']) {
      const values = product[field];
      assert.ok(Array.isArray(values) && values.every(value => typeof value === 'string' && value.trim() === value && value), `${at}.${field}: expected an array of nonempty strings`);
      assert.equal(new Set(values.map(value => value.toLowerCase())).size, values.length, `${at}.${field}: duplicate entry`);
    }
  }
  for (const [index, product] of products.entries()) {
    for (const name of product.substitutes) {
      assert.ok(name !== product.name && names.has(name), `products[${index}].substitutes: invalid reference "${name}"`);
    }
  }
}

describe('shipped product catalog', () => {
  const products = JSON.parse(readFileSync(new URL('../public/data/products.json', import.meta.url), 'utf8'));

  it('validates the complete dataset used by the browser', () => {
    validateCatalog(products);
  });

  it('identifies a malformed price and an unresolved substitute by field and row', () => {
    assert.throws(() => validateCatalog([{ ...products[0], price: -1 }]), /products\[0\]\.price/);
    assert.throws(() => validateCatalog([{ ...products[0], substitutes: ['Unknown'] }]), /products\[0\]\.substitutes: invalid reference "Unknown"/);
  });
});

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
