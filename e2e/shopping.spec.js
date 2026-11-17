import { expect, test } from '@playwright/test';

test('the deployed headers permit local shopping and export controls', async ({ context, page }) => {
  const externalRequests = [];
  const violations = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /content security policy/i.test(message.text())) {
      violations.push(message.text());
    }
  });
  await page.exposeFunction('reportShoppingCspViolation', value => violations.push(value));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', event => {
      globalThis.reportShoppingCspViolation(event.violatedDirective);
    });
    localStorage.setItem('voice_shopping_tts', 'false');
  });
  const origin = 'http://127.0.0.1:5055';
  await context.route(url => url.origin !== origin, async route => {
    externalRequests.push(route.request().url());
    await route.abort();
  });
  const response = await page.goto('/');
  expect(response.headers()['content-security-policy']).toMatch(/script-src 'self'/);
  await expect(page.locator('#syncStatus')).toContainText('Local only');
  await expect(page.locator('#ttsToggle')).toHaveAttribute('aria-pressed', 'false');
  const command = page.getByRole('textbox', { name: 'Type command' });
  await command.fill('add 2 apples and 3 bananas');
  await command.press('Enter');
  await expect(page.locator('.list-item')).toHaveCount(2);
  await page.getByRole('button', { name: 'Export list' }).click();
  await expect(page.locator('#exportModal')).toHaveClass(/open/);
  await page.locator('#closeExportModal').click();
  await expect(page.locator('#exportModal')).not.toHaveClass(/open/);
  expect(externalRequests).toEqual([]);
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});

test('saved item punctuation remains literal visible and accessible text', async ({ page }) => {
  const name = 'Farmer\'s "reserve" & <special>';
  await page.addInitScript(value => {
    localStorage.setItem('voice_shopping_list', JSON.stringify([{
      id: 'reserve', name: value, quantity: 1, unit: 'jar', category: 'Other'
    }]));
  }, name);
  await page.goto('/');
  await expect(page.locator('.item-name')).toHaveText(name);
  const remove = page.getByRole('button', { name: `Remove ${name}`, exact: true });
  await expect(remove).toHaveAttribute('aria-label', `Remove ${name}`);
  await expect(page.getByRole('checkbox', { name: `Mark ${name} as completed`, exact: true })).toBeVisible();
  expect(await remove.evaluate(button => button.getAttributeNames().sort())).toEqual(['aria-label', 'class', 'title']);
});

test('the first installed shell reopens offline and retains the local list', async ({ context, page }) => {
  await page.addInitScript(() => localStorage.setItem('voice_shopping_tts', 'false'));
  await page.goto('/');
  const command = page.getByRole('textbox', { name: 'Type command' });
  await command.fill('add milk');
  await command.press('Enter');
  await expect(page.locator('.list-item')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.goto('/?action=add');
  await expect(command).toBeFocused();
  await expect(page.locator('.list-item')).toHaveCount(1);
  await command.fill('add bread');
  await command.press('Enter');
  await expect(page.locator('.list-item')).toHaveCount(2);
});
