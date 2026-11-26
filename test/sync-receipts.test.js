import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SyncManager } from '../public/js/sync-manager.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function sender(sdk = {}, outbox = {}) {
  const sync = new SyncManager({ loadFirestore: async () => sdk, outbox });
  sync.enabled = sync.isOnline = true;
  sync.userId = 'shopper';
  sync.db = {};
  sync.session = new AbortController();
  sync.saveSyncState = () => {};
  return sync;
}

function transactionSdk(runTransaction) {
  return {
    collection: (_db, ...path) => path.join('/'),
    doc: (collection, id) => `${collection}/${id}`,
    serverTimestamp: () => 'server-time',
    runTransaction
  };
}

test('receipt replay reads affected rows without rewriting items or the receipt', async () => {
  const reads = [];
  const writes = [];
  const sync = sender(transactionSdk(async (_db, update) => update({
    async get(path) {
      reads.push(path);
      return path.includes('/syncReceipts/') ? { exists: () => true } : {
        id: path.split('/').at(-1),
        data: () => path.endsWith('/milk') ? { quantity: 9, updatedAt: { toMillis: () => 2000 } } : undefined
      };
    },
    set: (...args) => writes.push(args)
  })));
  const result = await sync.publishItems([{ id: 'milk', quantity: 1 }], ['bread'], 'original-id');
  assert.deepEqual(reads, [
    'users/shopper/syncReceipts/original-id', 'users/shopper/shoppingList/milk', 'users/shopper/shoppingList/bread'
  ]);
  assert.deepEqual(writes, []);
  assert.deepEqual(result.replayedItems, [
    { id: 'milk', quantity: 9, updatedAt: 2000, _updatedAtMillis: 2000 },
    { id: 'bread', deleted: true, updatedAt: null, _updatedAtMillis: null }
  ]);
});

for (const boundary of ['sdk-load', 'receipt-read', 'transaction-retry']) {
  test(`retiring an account at ${boundary} prevents new transaction writes`, { timeout: 2000 }, async t => {
    t.mock.method(console, 'warn', () => {});
    const entered = deferred();
    const resume = deferred();
    const writes = [];
    const sync = sender();
    const transaction = {
      async get() {
        if (boundary === 'receipt-read') {
          entered.resolve();
          await resume.promise;
        }
        return { exists: () => false };
      },
      set: (...args) => writes.push(args)
    };
    const sdk = transactionSdk(async (_db, update) => {
      if (boundary === 'transaction-retry') {
        await update(transaction);
        writes.length = 0; // First attempt was rejected by the server for contention.
        entered.resolve();
        await resume.promise;
      }
      return update(transaction);
    });
    sync.loadFirestore = async () => {
      if (boundary === 'sdk-load') {
        entered.resolve();
        await resume.promise;
      }
      return sdk;
    };
    const result = sync.publishItems([{ id: 'milk', quantity: 1 }], [], 'original-id');
    await entered.promise;
    sync.disconnect();
    sync.enabled = true;
    sync.userId = 'replacement';
    sync.session = new AbortController();
    resume.resolve();
    assert.equal(await result, false);
    assert.deepEqual(writes, []);
  });
}

test('a database replacement during a receipt read also retires the write', { timeout: 2000 }, async () => {
  const entered = deferred();
  const resume = deferred();
  const writes = [];
  const sync = sender(transactionSdk(async (_db, update) => update({
    async get() {
      entered.resolve();
      await resume.promise;
      return { exists: () => false };
    },
    set: (...args) => writes.push(args)
  })));
  const result = sync.publishItems([{ id: 'milk' }], [], 'original-id');
  await entered.promise;
  sync.db = {};
  resume.resolve();
  assert.equal(await result, false);
  assert.deepEqual(writes, []);
});

test('a missing durable ID leaves an invalid group queued without sending it', async t => {
  t.mock.method(console, 'warn', () => {});
  const queue = [{ sequence: 1, items: [{ id: 'milk' }], deletedItemIds: [] }];
  const sync = sender({}, {
    list: async () => queue,
    acknowledge: async () => assert.fail('Cannot acknowledge an unsent group'),
    withSender: (_owner, send) => send()
  });
  const load = t.mock.method(sync, 'loadFirestore', async () => assert.fail('Cannot send without an ID'));
  assert.equal(await sync.flushOfflineQueue(), false);
  assert.equal(load.mock.callCount(), 0);
  assert.equal(queue.length, 1);
});

test('replay acknowledgment replaces optimistic clocks, uses newer confirmed data and preserves later edits', async t => {
  const old = { id: 'original-id', sequence: 1, items: [{ id: 'milk', quantity: 1, updatedAt: 999999 }], deletedItemIds: ['bread'] };
  const newer = { id: 'new-id', sequence: 2, items: [{ id: 'eggs', quantity: 7 }], deletedItemIds: [] };
  let queue = [old, newer];
  let list = { items: [...old.items, ...newer.items], lastDeletedItem: { id: 'bread' } };
  const sync = sender({}, {
    list: async () => queue,
    async acknowledge(sequence, { owner, mergeItems }) {
      assert.equal(owner, 'shopper');
      queue = queue.filter(group => group.sequence !== sequence);
      list = { ...list, items: mergeItems(list.items, queue) };
      return { acknowledged: true, list, queue };
    },
    withSender: (_owner, send) => send()
  });
  sync.shoppingList = { accountOwner: 'shopper', items: list.items };
  sync.confirmedRemoteItems.set('milk', { id: 'milk', quantity: 9, updatedAt: 2000, _updatedAtMillis: 2000 });
  const ids = [];
  t.mock.method(sync, 'publishItems', async (_items, _deleted, operationId) => {
    ids.push(operationId);
    return operationId === old.id ? { replayedItems: [
      { id: 'milk', quantity: 3, updatedAt: 1500, _updatedAtMillis: 1500 },
      { id: 'bread', quantity: 4, updatedAt: 1500, _updatedAtMillis: 1500 }
    ] } : false;
  });
  assert.equal(await sync.flushOfflineQueue(), false);
  assert.deepEqual(ids, ['original-id', 'new-id']);
  const quantities = items => Object.fromEntries(items.map(item => [item.id, item.quantity]));
  assert.deepEqual(quantities(list.items), { milk: 9, bread: 4, eggs: 7 });
  assert.deepEqual(quantities(sync.shoppingList.items), quantities(list.items));
  assert.deepEqual(queue, [newer]);
  assert.deepEqual(list.lastDeletedItem, { id: 'bread' });
});

test('an acknowledgment already handled by another sender keeps its newer cached projection', async t => {
  const old = { id: 'original-id', sequence: 1, items: [{ id: 'milk', quantity: 1 }], deletedItemIds: [] };
  let queue = [old];
  const sync = sender({}, {
    list: async () => queue,
    async acknowledge() {
      queue = [];
      return { acknowledged: false, list: { items: [{ id: 'milk', quantity: 11 }] }, queue };
    },
    withSender: (_owner, send) => send()
  });
  sync.shoppingList = { accountOwner: 'shopper', items: old.items };
  t.mock.method(sync, 'publishItems', async () => ({
    replayedItems: [{ id: 'milk', quantity: 3, updatedAt: 1500, _updatedAtMillis: 1500 }]
  }));
  assert.equal(await sync.flushOfflineQueue(), true);
  assert.equal(sync.shoppingList.items[0].quantity, 11);
});

test('an atomic acknowledgment does not restore in-memory edits already drained by another tab', async t => {
  const old = { id: 'original-id', sequence: 1, items: [{ id: 'milk', quantity: 1 }], deletedItemIds: [] };
  const alsoAcknowledged = { id: 'other-id', sequence: 2, items: [{ id: 'milk', quantity: 7 }], deletedItemIds: [] };
  let queue = [old];
  const sync = sender({}, {
    list: async () => queue,
    async acknowledge() {
      // This tab appended while awaiting its send. Another tab has now drained both.
      sync.offlineQueue.push(alsoAcknowledged);
      queue = [];
      return { acknowledged: false, list: { items: [{ id: 'milk', quantity: 11 }] }, queue };
    },
    withSender: (_owner, send) => send()
  });
  sync.shoppingList = { accountOwner: 'shopper', items: old.items };
  sync.remoteConfirmed = true;
  sync.remoteItemIds.add('milk');
  t.mock.method(sync, 'publishItems', async () => ({
    replayedItems: [{ id: 'milk', quantity: 3, updatedAt: 1500, _updatedAtMillis: 1500 }]
  }));
  assert.equal(await sync.flushOfflineQueue(), true);
  assert.deepEqual(sync.offlineQueue, []);
  assert.equal(sync.shoppingList.items[0].quantity, 11);
  assert.equal(sync.syncStatus, 'synced');
});

for (const acknowledged of [true, false]) {
  test(`an acknowledgment (${acknowledged}) preserves a newer listener update during the local transaction`, async t => {
    const old = { id: 'original-id', sequence: 1, items: [{ id: 'milk', quantity: 1 }], deletedItemIds: [] };
    let queue = [old];
    const sync = sender({}, {
      list: async () => queue,
      async acknowledge() {
        const cached = [{ id: 'milk', quantity: 3, updatedAt: 1500 }, { id: 'eggs', quantity: 7, updatedAt: 1000 }];
        // Listener received an unrelated newer row after the cache read, before completion.
        const latest = { id: 'eggs', quantity: 11, updatedAt: 2000, _updatedAtMillis: 2000 };
        sync.confirmedRemoteItems.set('eggs', latest);
        sync.shoppingList.items = [...old.items, latest];
        queue = [];
        return { acknowledged, list: { items: cached }, queue };
      },
      withSender: (_owner, send) => send()
    });
    sync.shoppingList = { accountOwner: 'shopper', items: old.items };
    t.mock.method(sync, 'publishItems', async () => ({
      replayedItems: [{ id: 'milk', quantity: 3, updatedAt: 1500, _updatedAtMillis: 1500 }]
    }));
    assert.equal(await sync.flushOfflineQueue(), true);
    assert.equal(sync.shoppingList.items.find(item => item.id === 'eggs').quantity, 11);
  });
}
