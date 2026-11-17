import { expect, test } from '@playwright/test';

test('authenticated list edits and undo commit to the same durable state as their queue', async ({ page }) => {
  await page.goto('/');
  const state = await page.evaluate(async () => {
    const { ShoppingList } = await import('/js/shopping-list.js');
    const { SyncManager } = await import('/js/sync-manager.js');
    const sync = new SyncManager();
    sync.enabled = true;
    sync.isOnline = false;
    sync.userId = 'shopper';
    const list = new ShoppingList(sync);

    list.add({ id: 'guest-bread', name: 'Bread', quantity: 1, category: 'Bakery' });
    list.enterAccount(sync.userId);
    sync.shoppingList = list;
    list.add({ id: 'milk', name: 'Milk', quantity: 2, category: 'Dairy' });
    list.add({ id: 'apples', name: 'Apples', quantity: 1, category: 'Produce' });
    list.remove('milk');
    const removed = await sync.outbox.readAccount('shopper');
    list.undo();
    const restored = await sync.outbox.readAccount('shopper');

    sync.disconnect();
    return { removed, restored, device: list.items.map(item => item.id) };
  });
  expect(state.removed.list.items.map(item => item.id)).toEqual(['apples']);
  expect(state.removed.list.lastDeletedItem.id).toBe('milk');
  expect(state.removed.queue.map(group => group.deletedItemIds)).toEqual([[], [], ['milk']]);
  expect(state.restored.list.items.map(item => item.id)).toEqual(['apples', 'milk']);
  expect(state.restored.list.lastDeletedItem).toBeNull();
  expect(state.restored.queue.at(-1).items[0].id).toBe('milk');
  expect(state.device).toEqual(['guest-bread']);
  await page.reload();
  await expect(page.locator('#syncStatus')).toContainText('Local only');
  const reloaded = await page.evaluate(async () => {
    const { SyncOutbox } = await import('/js/sync-outbox.js');
    const { SyncManager } = await import('/js/sync-manager.js');
    const outbox = new SyncOutbox();
    const sync = new SyncManager({
      outbox,
      loadAuth: async () => ({
        onAuthStateChanged(_auth, next) {
          queueMicrotask(() => next({ uid: 'shopper' }));
          return () => {};
        }
      })
    });
    globalThis.firebaseAuth = {};
    globalThis.firebaseDb = {};
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const list = globalThis.app.shoppingList;
    list.syncManager = sync;
    const ready = await sync.init(list);
    return {
      ready,
      projectedIds: list.items.map(item => item.id),
      account: await outbox.readAccount('shopper'),
      other: await outbox.readAccount('other-shopper')
    };
  });
  expect(reloaded.ready).toBe(true);
  expect(reloaded.projectedIds).toEqual(['apples', 'milk']);
  expect(reloaded.account).toEqual(state.restored);
  expect(reloaded.other).toEqual({ list: undefined, queue: [] });
  await expect(page.getByRole('link', { name: 'Device list' })).toBeVisible();
});

test('a failed projection write rolls back the related queued operation', async ({ page }) => {
  await page.goto('/');
  const state = await page.evaluate(async () => {
    const { SyncOutbox } = await import('/js/sync-outbox.js');
    const outbox = new SyncOutbox();
    const owner = 'shopper';
    await outbox.append(owner, [{
      id: 'initial', items: [{ id: 'milk', quantity: 2 }], deletedItemIds: []
    }], {});
    const before = await outbox.readAccount(owner);
    let failure;
    try {
      await outbox.append(owner, [{
        id: 'delete', items: [], deletedItemIds: ['milk']
      }], { lastDeletedItem: () => {} });
    } catch (error) {
      failure = error.name;
    }
    const afterProjectionFailure = await outbox.readAccount(owner);
    let queueFailure;
    try {
      await outbox.append(owner, [
        { id: 'valid-first-group', items: [], deletedItemIds: ['milk'] },
        { id: 'invalid-second-group', items: [{ id: 'bread', quantity: () => {} }], deletedItemIds: [] }
      ], {});
    } catch (error) {
      queueFailure = error.name;
    }
    return { failure, queueFailure, before, afterProjectionFailure, afterQueueFailure: await outbox.readAccount(owner) };
  });
  expect(state.failure).toBe('DataCloneError');
  expect(state.queueFailure).toBe('DataCloneError');
  expect(state.afterProjectionFailure).toEqual(state.before);
  expect(state.afterQueueFailure).toEqual(state.before);
});

test('upgrading the previous outbox builds an account projection without discarding pending edits', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const legacy = await new Promise((resolve, reject) => {
      const request = indexedDB.open('voice_shopping_sync', 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('outbox', { keyPath: 'sequence', autoIncrement: true });
        store.createIndex('owner', 'owner');
        store.add({ owner: 'shopper', id: 'add', items: [{ id: 'milk', quantity: 1 }], deletedItemIds: [] });
        store.add({ owner: 'shopper', id: 'remove', items: [], deletedItemIds: ['milk'] });
        store.add({ owner: 'other', id: 'other-add', items: [{ id: 'bread', quantity: 1 }], deletedItemIds: [] });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    legacy.close();

    const { SyncOutbox } = await import('/js/sync-outbox.js');
    const upgraded = new SyncOutbox();
    return [await upgraded.readAccount('shopper'), await upgraded.readAccount('other')];
  });
  expect(result[0].list.items).toEqual([]);
  expect(result[0].queue.map(group => group.id)).toEqual(['add', 'remove']);
  expect(result[1].list.items).toEqual([{ id: 'bread', quantity: 1 }]);
  expect(result[1].queue.map(group => group.id)).toEqual(['other-add']);
});
