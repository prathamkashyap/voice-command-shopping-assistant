import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { icon } from '../public/js/icons.js';

describe('icon set', () => {
  it('returns accessible inline SVG for known icons', () => {
    const markup = icon('cart', 'ui-icon--sm');
    assert.ok(markup.startsWith('<svg'));
    assert.ok(markup.includes('ui-icon'));
    assert.ok(markup.includes('ui-icon--sm'));
    assert.ok(markup.includes('viewBox="0 0 24 24"'));
    assert.ok(markup.includes('aria-hidden="true"'));
  });

  it('falls back to the info icon for unknown names', () => {
    const known = icon('info');
    const fallback = icon('does-not-exist');
    assert.equal(fallback, known);
  });
});
