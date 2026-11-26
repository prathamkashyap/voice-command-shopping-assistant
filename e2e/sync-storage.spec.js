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

test('receipt acknowledgment reconciles the list and retains newer queued edits and undo together', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { SyncOutbox } = await import('/js/sync-outbox.js');
    const outbox = new SyncOutbox();
    const owner = 'shopper';
    const undo = { id: 'bread', name: 'Bread', quantity: 1 };
    const entries = await outbox.append(owner, [
      { id: 'already-committed', items: [{ id: 'milk', quantity: 2 }, { id: 'eggs', quantity: 1 }], deletedItemIds: [] },
      { id: 'newer-edit', items: [{ id: 'milk', quantity: 7 }], deletedItemIds: [] }
    ], { lastDeletedItem: undo });
    await outbox.append('other-shopper', [{ id: 'other-edit', items: [{ id: 'rice', quantity: 2 }], deletedItemIds: [] }], {});
    const otherBefore = await outbox.readAccount('other-shopper');
    let observed;
    const acknowledged = await outbox.acknowledge(entries[0].sequence, {
      owner,
      mergeItems(localItems, remaining) {
        observed = { localItems, remainingIds: remaining.map(group => group.id) };
        const items = new Map([{ id: 'milk', quantity: 3 }, { id: 'eggs', quantity: 5 }].map(item => [item.id, item]));
        for (const group of remaining) {
          for (const item of group.items) items.set(item.id, item);
          for (const id of group.deletedItemIds) items.delete(id);
        }
        return [...items.values()];
      }
    });
    return { acknowledged, observed, persisted: await outbox.readAccount(owner), otherBefore, otherAfter: await outbox.readAccount('other-shopper') };
  });
  expect(result.observed.localItems).toEqual([{ id: 'milk', quantity: 7 }, { id: 'eggs', quantity: 1 }]);
  expect(result.observed.remainingIds).toEqual(['newer-edit']);
  expect(result.acknowledged.list.items).toEqual([{ id: 'milk', quantity: 7 }, { id: 'eggs', quantity: 5 }]);
  expect(result.acknowledged.list.lastDeletedItem).toEqual({ id: 'bread', name: 'Bread', quantity: 1 });
  expect(result.acknowledged.queue.map(group => group.id)).toEqual(['newer-edit']);
  expect(result.acknowledged.acknowledged).toBe(true);
  expect(result.persisted).toEqual({ list: result.acknowledged.list, queue: result.acknowledged.queue });
  expect(result.otherAfter).toEqual(result.otherBefore);
});

test('failed receipt reconciliation preserves its queue and projection and cannot acknowledge another account', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { SyncOutbox } = await import('/js/sync-outbox.js');
    const outbox = new SyncOutbox();
    const owner = 'shopper';
    const [entry] = await outbox.append(owner, [
      { id: 'already-committed', items: [{ id: 'milk', quantity: 2 }], deletedItemIds: [] }
    ], { lastDeletedItem: { id: 'bread', quantity: 1 } });
    const before = await outbox.readAccount(owner);
    let callbackFailure;
    try {
      await outbox.acknowledge(entry.sequence, {
        owner,
        mergeItems() { throw new Error('Reconciliation failed'); }
      });
    } catch (error) {
      callbackFailure = error.message;
    }
    const afterCallbackFailure = await outbox.readAccount(owner);
    let storageFailure;
    try {
      await outbox.acknowledge(entry.sequence, {
        owner,
        mergeItems() { return [{ id: 'milk', quantity: () => {} }]; }
      });
    } catch (error) {
      storageFailure = error.name;
    }
    const afterStorageFailure = await outbox.readAccount(owner);
    let ownerFailure;
    let wrongOwnerCallbackCalled = false;
    try {
      await outbox.acknowledge(entry.sequence, {
        owner: 'other-shopper',
        mergeItems() { wrongOwnerCallbackCalled = true; return []; }
      });
    } catch (error) {
      ownerFailure = error.message;
    }
    return {
      before, callbackFailure, afterCallbackFailure, storageFailure, afterStorageFailure,
      ownerFailure, wrongOwnerCallbackCalled, afterOwnerFailure: await outbox.readAccount(owner),
      otherAccount: await outbox.readAccount('other-shopper')
    };
  });
  expect(result.callbackFailure).toBe('Reconciliation failed');
  expect(result.storageFailure).toBe('DataCloneError');
  expect(result.afterCallbackFailure).toEqual(result.before);
  expect(result.afterStorageFailure).toEqual(result.before);
  expect(result.ownerFailure).toBe("Cannot acknowledge another account's operation");
  expect(result.wrongOwnerCallbackCalled).toBe(false);
  expect(result.afterOwnerFailure).toEqual(result.before);
  expect(result.otherAccount).toEqual({ list: undefined, queue: [] });
});

test('a duplicate acknowledgment returns current durable state without applying an old reconciliation', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { SyncOutbox } = await import('/js/sync-outbox.js');
    const outbox = new SyncOutbox();
    const owner = 'shopper';
    const [entry] = await outbox.append(owner, [
      { id: 'already-committed', items: [{ id: 'milk', quantity: 2 }], deletedItemIds: [] }
    ], {});
    await outbox.acknowledge(entry.sequence, { owner, mergeItems: () => [{ id: 'milk', quantity: 3 }] });
    await outbox.append(owner, [
      { id: 'later-edit', items: [{ id: 'milk', quantity: 11 }], deletedItemIds: [] }
    ], { lastDeletedItem: { id: 'bread', quantity: 1 } });
    const before = await outbox.readAccount(owner);
    let callbackCalled = false;
    const duplicate = await outbox.acknowledge(entry.sequence, {
      owner,
      mergeItems() { callbackCalled = true; throw new Error('Stale reconciliation must not run'); }
    });
    return { callbackCalled, before, duplicate, after: await outbox.readAccount(owner) };
  });
  expect(result.callbackCalled).toBe(false);
  expect(result.duplicate).toEqual({ ...result.before, acknowledged: false });
  expect(result.after).toEqual(result.before);
  expect(result.duplicate.list.items).toEqual([{ id: 'milk', quantity: 11 }]);
  expect(result.duplicate.queue.map(group => group.id)).toEqual(['later-edit']);
});
