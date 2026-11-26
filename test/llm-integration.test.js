import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const skip = process.env.SHOPPING_DEMO_INTEGRATION !== '1' && 'Run npm run test:integration';

// The first request also starts the local Functions runtime on a cold machine.
describe('Functions emulator', { skip, timeout: 60000 }, () => {
  const port = Number(process.env.SHOPPING_FUNCTIONS_PORT ?? 5001);
  const parseIntentUrl = `http://127.0.0.1:${port}/demo-voice-shopping/us-central1/parseIntent`;

  describe('parseIntent endpoint', () => {
    it('should parse multi-item add command', async () => {
      const response = await fetch(parseIntentUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'add milk and bread', locale: 'en-US' })
      });

      assert.equal(response.ok, true);
      const data = await response.json();
      assert.ok(data.intent);
      assert.equal(data.intent.action, 'multi');
      assert.deepEqual(data.intent.items.map(item => item.item), ['milk', 'bread']);
      assert.equal(data.intent.source, 'rule');
    });

    it('should parse search command with filters', async () => {
      const response = await fetch(parseIntentUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'find organic tomatoes under $5', locale: 'en-US' })
      });

      assert.equal(response.ok, true);
      const data = await response.json();
      assert.ok(data.intent);
      assert.equal(data.intent.action, 'search');
      assert.equal(data.intent.searchFilters.query, 'tomatoes');
      assert.equal(data.intent.searchFilters.maxPrice, 5);
      assert.equal(data.intent.searchFilters.isOrganic, true);
    });

    it('should parse simple add command', async () => {
      const response = await fetch(parseIntentUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'add 2 bottles of milk', locale: 'en-US' })
      });

      assert.equal(response.ok, true);
      const data = await response.json();
      assert.ok(data.intent);
      assert.equal(data.intent.action, 'add');
      assert.equal(data.intent.items[0].item, 'milk');
      assert.equal(data.intent.items[0].quantity, 2);
      assert.equal(data.intent.items[0].unit, 'bottles');
    });

    it('should return 400 for missing text', async () => {
      const response = await fetch(parseIntentUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: 'en-US' })
      });

      assert.equal(response.status, 400);
      const data = await response.json();
      assert.equal(data.error, 'INVALID_REQUEST');
    });

    it('should return 405 for GET method', async () => {
      const response = await fetch(parseIntentUrl, {
        method: 'GET'
      });

      assert.equal(response.status, 405);
      const data = await response.json();
      assert.equal(data.error, 'METHOD_NOT_ALLOWED');
    });

    it('should handle comma-separated items', async () => {
      const response = await fetch(parseIntentUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'buy apples, bananas, and bread', locale: 'en-US' })
      });

      assert.equal(response.ok, true);
      const data = await response.json();
      assert.ok(data.intent);
      assert.equal(data.intent.action, 'multi');
      assert.deepEqual(data.intent.items.map(item => item.item), ['apples', 'bananas', 'bread']);
    });

    it('should handle modify command', async () => {
      const response = await fetch(parseIntentUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'change milk to 3 liters', locale: 'en-US' })
      });

      assert.equal(response.ok, true);
      const data = await response.json();
      assert.ok(data.intent);
      assert.equal(data.intent.action, 'modify');
      assert.equal(data.intent.items[0].item, 'milk');
      assert.equal(data.intent.items[0].quantity, 3);
      assert.equal(data.intent.items[0].unit, 'liters');
    });
  });

  describe('Error handling and fallbacks', () => {
    it('should return structured error on invalid request', async () => {
      const response = await fetch(parseIntentUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '', locale: 'en-US' })
      });

      assert.equal(response.status, 400);
      const data = await response.json();
      assert.ok(data.error);
      assert.ok(data.message);
    });
  });
});
