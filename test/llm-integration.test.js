import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = process.env.FUNCTIONS_EMULATOR_URL || 'http://localhost:5001/voice-shopping-assistant-app/us-central1';

describe('LLM Integration Tests (requires Functions emulator)', () => {
  const parseIntentUrl = `${BASE_URL}/parseIntent`;

  before(() => {
    if (!process.env.FUNCTIONS_EMULATOR_URL) {
      console.log('Skipping integration tests: FUNCTIONS_EMULATOR_URL not set');
    }
  });

  describe('parseIntent endpoint', () => {
    it('should parse multi-item add command', async () => {
      if (!process.env.FUNCTIONS_EMULATOR_URL) return;

      const response = await fetch(parseIntentUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'add milk and bread', locale: 'en-US' })
      });

      assert.equal(response.ok, true);
      const data = await response.json();
      assert.ok(data.intent);
      assert.equal(data.intent.action, 'multi');
      assert.ok(data.intent.items.length >= 2);
      assert.equal(data.intent.source, 'llm');
    });

    it('should parse search command with filters', async () => {
      if (!process.env.FUNCTIONS_EMULATOR_URL) return;

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
      if (!process.env.FUNCTIONS_EMULATOR_URL) return;

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
      if (!process.env.FUNCTIONS_EMULATOR_URL) return;

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
      if (!process.env.FUNCTIONS_EMULATOR_URL) return;

      const response = await fetch(parseIntentUrl, {
        method: 'GET'
      });

      assert.equal(response.status, 405);
      const data = await response.json();
      assert.equal(data.error, 'METHOD_NOT_ALLOWED');
    });

    it('should handle comma-separated items', async () => {
      if (!process.env.FUNCTIONS_EMULATOR_URL) return;

      const response = await fetch(parseIntentUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'buy apples, bananas, and bread', locale: 'en-US' })
      });

      assert.equal(response.ok, true);
      const data = await response.json();
      assert.ok(data.intent);
      assert.equal(data.intent.action, 'multi');
      assert.ok(data.intent.items.length >= 3);
    });

    it('should handle modify command', async () => {
      if (!process.env.FUNCTIONS_EMULATOR_URL) return;

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
      if (!process.env.FUNCTIONS_EMULATOR_URL) return;

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