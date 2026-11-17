import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SyncManager } from '../public/js/sync-manager.js';

describe('offline replay acknowledgment', () => {
  it('keeps the in-flight operation and later operations until a successful replay', async t => {
    let stored;
    t.mock.method(console, 'log', () => {});
    const sync = new SyncManager();
    sync.enabled = sync.isOnline = true;
    sync.userId = 'shopper';
    const first = { type: 'delete', deletedId: 'milk' };
    const second = { type: 'delete', deletedId: 'bread' };
    sync.offlineQueue = [first, second];
    sync.saveOfflineQueue = () => { stored = JSON.parse(JSON.stringify(sync.offlineQueue)); };
    sync.saveOfflineQueue();
    let finish;
    const send = t.mock.method(sync, 'syncItems', () => new Promise(resolve => { finish = resolve; }));
    const replay = sync.flushOfflineQueue();
    assert.deepEqual(stored, [first, second], 'a reload before acknowledgment still sees both changes');
    await sync.flushOfflineQueue();
    assert.equal(send.mock.callCount(), 1);
    finish(false);
    await replay;
    assert.deepEqual(sync.offlineQueue, [first, second]);
    assert.deepEqual(stored, [first, second]);
    assert.equal(sync.syncStatus, 'error');

    const sent = [];
    send.mock.mockImplementation(async (_items, ids) => {
      sent.push(...ids);
      return true;
    });
    await sync.flushOfflineQueue();
    assert.deepEqual(sent, ['milk', 'bread']);
    assert.deepEqual(stored, []);
    assert.equal(sync.syncStatus, 'synced');
  });

  it('merges a tombstone into a document that may never have been uploaded', async () => {
    const writes = [];
    const sync = new SyncManager({
      loadFirestore: async () => ({
        collection: () => 'list',
        doc: (_collection, id) => id,
        serverTimestamp: () => 'server-time',
        writeBatch: () => ({
          set: (...args) => writes.push(args),
          commit: async () => {}
        })
      })
    });
    sync.enabled = sync.isOnline = true;
    sync.userId = 'shopper';
    sync.saveSyncState = () => {};
    assert.equal(await sync.syncItems([], ['never-uploaded']), true);
    assert.deepEqual(writes, [['never-uploaded', { deleted: true, updatedAt: 'server-time' }, { merge: true }]]);
  });
});

describe('SyncManager', () => {
  let syncManager;

  before(() => {
    // Mock localStorage for Node.js environment
    global.localStorage = {
      getItem: (key) => {
        if (key === 'voice_shopping_sync') {
          return syncManagerTestStorage[key] || null;
        }
        return null;
      },
      setItem: (key, value) => {
        if (key === 'voice_shopping_sync') {
          syncManagerTestStorage[key] = value;
        }
      },
      removeItem: (key) => {
        delete syncManagerTestStorage[key];
      }
    };
    const syncManagerTestStorage = {};
    global.syncManagerTestStorage = syncManagerTestStorage;

    syncManager = new SyncManager();
  });

  after(() => {
    syncManager.enabled = false;
    syncManager.userId = null;
    syncManager.auth = null;
    syncManager.db = null;
    delete global.localStorage;
    delete global.syncManagerTestStorage;
  });

  describe('constructor', () => {
    it('should initialize with disabled state', () => {
      const sm = new SyncManager();
      assert.equal(sm.enabled, false);
      assert.equal(sm.userId, null);
      assert.equal(sm.auth, null);
      assert.equal(sm.db, null);
      assert.equal(sm.syncInProgress, false);
    });

    it('should have default sync state', () => {
      const sm = new SyncManager();
      assert.equal(sm.lastSyncTime, null);
    });
  });

  describe('isEnabled', () => {
    it('should return false initially', () => {
      const sm = new SyncManager();
      assert.equal(sm.isEnabled(), false);
    });

    it('should return true after successful init (mocked)', () => {
      const sm = new SyncManager();
      sm.enabled = true;
      assert.equal(sm.isEnabled(), true);
    });
  });

  describe('getUserId', () => {
    it('should return null before auth', () => {
      const sm = new SyncManager();
      assert.equal(sm.getUserId(), null);
    });
  });

  describe('mergeItems', () => {
    it('should return local items when no remote items', () => {
      const sm = new SyncManager();
      const localItems = [
        { id: '1', name: 'Milk', quantity: 1, unit: 'L', updatedAt: 1000 }
      ];
      const remoteItems = [];

      const merged = sm.mergeItems(localItems, remoteItems);

      assert.equal(merged.length, 1);
      assert.equal(merged[0].name, 'Milk');
    });

    it('should add remote items not in local', () => {
      const sm = new SyncManager();
      const localItems = [
        { id: '1', name: 'Milk', quantity: 1, unit: 'L', updatedAt: 1000 }
      ];
      const remoteItems = [
        { id: '2', name: 'Bread', quantity: 1, unit: 'loaf', updatedAt: 2000 }
      ];

      const merged = sm.mergeItems(localItems, remoteItems);

      assert.equal(merged.length, 2);
      const names = merged.map(i => i.name).sort();
      assert.deepEqual(names, ['Bread', 'Milk']);
    });

    it('should prefer newer remote item over older local', () => {
      const sm = new SyncManager();
      const localItems = [
        { id: '1', name: 'Milk', quantity: 1, unit: 'L', updatedAt: 1000 }
      ];
      const remoteItems = [
        { id: '1', name: 'Milk', quantity: 2, unit: 'L', updatedAt: 3000 }
      ];

      const merged = sm.mergeItems(localItems, remoteItems);

      assert.equal(merged.length, 1);
      assert.equal(merged[0].quantity, 2);
      assert.equal(merged[0].source, 'remote');
    });

    it('should prefer newer local item over older remote', () => {
      const sm = new SyncManager();
      const localItems = [
        { id: '1', name: 'Milk', quantity: 3, unit: 'L', updatedAt: 3000 }
      ];
      const remoteItems = [
        { id: '1', name: 'Milk', quantity: 1, unit: 'L', updatedAt: 1000 }
      ];

      const merged = sm.mergeItems(localItems, remoteItems);

      assert.equal(merged.length, 1);
      assert.equal(merged[0].quantity, 3);
      assert.equal(merged[0].source, 'local');
    });

    it('should handle multiple items with mixed sources', () => {
      const sm = new SyncManager();
      const localItems = [
        { id: '1', name: 'Milk', quantity: 1, unit: 'L', updatedAt: 1000 },
        { id: '2', name: 'Bread', quantity: 1, unit: 'loaf', updatedAt: 2000 }
      ];
      const remoteItems = [
        { id: '1', name: 'Milk', quantity: 2, unit: 'L', updatedAt: 3000 },
        { id: '3', name: 'Apples', quantity: 3, unit: 'kg', updatedAt: 4000 }
      ];

      const merged = sm.mergeItems(localItems, remoteItems);

      assert.equal(merged.length, 3);
      const names = merged.map(i => i.name).sort();
      assert.deepEqual(names, ['Apples', 'Bread', 'Milk']);
      
      const milk = merged.find(i => i.id === '1');
      assert.equal(milk.quantity, 2);
      assert.equal(milk.source, 'remote');
      
      const bread = merged.find(i => i.id === '2');
      assert.equal(bread.source, 'local');
      
      const apples = merged.find(i => i.id === '3');
      assert.equal(apples.source, 'remote');
    });
  });

  describe('sync state persistence', () => {
    it('should save and load sync state', () => {
      const sm = new SyncManager();
      sm.lastSyncTime = 1234567890;
      sm.saveSyncState();

      const sm2 = new SyncManager();
      sm2.loadSyncState();
      assert.equal(sm2.lastSyncTime, 1234567890);
    });

    it('should handle missing sync state gracefully', () => {
      const sm = new SyncManager();
      sm.lastSyncTime = null;
      sm.saveSyncState();

      const sm2 = new SyncManager();
      sm2.loadSyncState();
      assert.equal(sm2.lastSyncTime, null);
    });
  });

  describe('mergeItems - soft delete and LWW edge cases', () => {
    it('should keep newer local item when remote delete is older', () => {
      const sm = new SyncManager();
      const localItems = [
        { id: '1', name: 'Milk', quantity: 1, unit: 'L', updatedAt: 3000 }
      ];
      const remoteItems = [
        { id: '1', name: 'Milk', quantity: 1, unit: 'L', updatedAt: 1000, deleted: true }
      ];

      const merged = sm.mergeItems(localItems, remoteItems);

      assert.equal(merged.length, 1);
      assert.equal(merged[0].deleted, undefined);
      assert.equal(merged[0].source, 'local');
    });

    it('should remove local item when remote delete is newer', () => {
      const sm = new SyncManager();
      const localItems = [
        { id: '1', name: 'Milk', quantity: 1, unit: 'L', updatedAt: 1000 }
      ];
      const remoteItems = [
        { id: '1', name: 'Milk', quantity: 1, unit: 'L', updatedAt: 3000, deleted: true }
      ];

      const merged = sm.mergeItems(localItems, remoteItems);

      assert.equal(merged.length, 0);
    });

    it('should prefer local when remote timestamp is null (unresolved sentinel)', () => {
      const sm = new SyncManager();
      const localItems = [
        { id: '1', name: 'Milk', quantity: 1, unit: 'L', updatedAt: 3000 }
      ];
      // Remote has unresolved server timestamp (null _updatedAtMillis)
      const remoteItems = [
        { id: '1', name: 'Milk', quantity: 2, unit: 'L', updatedAt: 1000, _updatedAtMillis: null }
      ];

      const merged = sm.mergeItems(localItems, remoteItems);

      assert.equal(merged.length, 1);
      // Local wins (has reliable timestamp 3000 vs remote's null)
      // Local's quantity is 1, so merged quantity should be 1
      assert.equal(merged[0].quantity, 1);
      assert.equal(merged[0].source, 'local');
    });

    it('should prefer remote when local timestamp is missing and remote is valid', () => {
      const sm = new SyncManager();
      const localItems = [
        { id: '1', name: 'Milk', quantity: 1, unit: 'L' } // no updatedAt
      ];
      const remoteItems = [
        { id: '1', name: 'Milk', quantity: 2, unit: 'L', updatedAt: 3000 }
      ];

      const merged = sm.mergeItems(localItems, remoteItems);

      assert.equal(merged.length, 1);
      assert.equal(merged[0].quantity, 2);
      assert.equal(merged[0].source, 'remote');
    });

    it('should prefer local when both timestamps are unreliable', () => {
      const sm = new SyncManager();
      const localItems = [
        { id: '1', name: 'Milk', quantity: 1, unit: 'L' } // no updatedAt
      ];
      const remoteItems = [
        { id: '1', name: 'Milk', quantity: 2, unit: 'L', _updatedAtMillis: null } // unresolved sentinel
      ];

      const merged = sm.mergeItems(localItems, remoteItems);

      assert.equal(merged.length, 1);
      assert.equal(merged[0].quantity, 1);
      assert.equal(merged[0].source, 'local');
    });

    it('should not resurrect deleted remote items when local is missing', () => {
      const sm = new SyncManager();
      const localItems = [];
      const remoteItems = [
        { id: '1', name: 'Milk', quantity: 1, unit: 'L', updatedAt: 1000, deleted: true }
      ];

      const merged = sm.mergeItems(localItems, remoteItems);

      assert.equal(merged.length, 0);
    });

    it('should preserve local-only items during merge', () => {
      const sm = new SyncManager();
      const localItems = [
        { id: '1', name: 'LocalOnly', quantity: 1, unit: 'L', updatedAt: 1000 }
      ];
      const remoteItems = [
        { id: '2', name: 'RemoteOnly', quantity: 2, unit: 'L', updatedAt: 2000 }
      ];

      const merged = sm.mergeItems(localItems, remoteItems);

      assert.equal(merged.length, 2);
      const names = merged.map(i => i.name).sort();
      assert.deepEqual(names, ['LocalOnly', 'RemoteOnly']);
    });
  });

  describe('Firestore listener lifecycle', () => {
    function harness(load) {
      const subscriptions = [];
      const sdk = {
        collection: (db, ...path) => ({ db, path }),
        onSnapshot(ref, next, error) {
          const entry = { ref, next, error, stops: 0 };
          subscriptions.push(entry);
          return () => { entry.stops++; };
        }
      };
      const sm = new SyncManager({ loadFirestore: load ? () => load(sdk) : async () => sdk });
      sm.db = {};
      sm.userId = 'shopper';
      sm.enabled = sm.isOnline = true;
      sm.shoppingList = { items: [], saves: 0, saveLocal() { this.saves++; } };
      return { sm, subscriptions };
    }

    function snapshot(...documents) {
      return {
        metadata: { fromCache: false, hasPendingWrites: false },
        forEach(visit) { documents.forEach(([id, fields]) => visit({ id, data: () => fields })); }
      };
    }

    it('shares one attachment, merges server timestamps, and ignores callbacks after stop', async () => {
      const { sm, subscriptions } = harness();
      const results = await Promise.all([sm.startRealtimeListener(), sm.startRealtimeListener()]);
      assert.deepEqual(results, [true, true]);
      assert.equal(subscriptions.length, 1);
      const sub = subscriptions[0];
      assert.deepEqual(sub.ref, { db: sm.db, path: ['users', 'shopper', 'shoppingList'] });
      sub.next(snapshot(['milk', { name: 'Milk', quantity: 1, updatedAt: { toMillis: () => 1234 } }]));
      assert.equal(sm.shoppingList.items[0].updatedAt, 1234);
      assert.equal(sm.shoppingList.saves, 1);
      sm.stopRealtimeListener();
      sm.stopRealtimeListener();
      sub.next(snapshot(['late', { updatedAt: 2000 }]));
      assert.equal(sub.stops, 1);
      assert.equal(sm.shoppingList.saves, 1);
    });

    it('keeps a reliable local edit over an unresolved server timestamp', async () => {
      const { sm, subscriptions } = harness();
      sm.shoppingList.items = [{ id: 'milk', quantity: 3, updatedAt: 1200 }];
      await sm.startRealtimeListener();
      const sub = subscriptions[0];
      sub.next(snapshot(['milk', { quantity: 2, updatedAt: { _methodName: 'serverTimestamp' } }]));
      assert.equal(sm.shoppingList.items[0].quantity, 3);
      sub.next(snapshot(['milk', { quantity: 4, updatedAt: { toMillis: () => 1201 } }]));
      assert.equal(sm.shoppingList.items[0].quantity, 4);
    });

    it('cancels an attachment awaiting the SDK when stopped and restarted', async () => {
      let resume;
      let loads = 0;
      const { sm, subscriptions } = harness(sdk => {
        if (++loads === 1) return new Promise(resolve => { resume = () => resolve(sdk); });
        return sdk;
      });
      const oldStart = sm.startRealtimeListener();
      sm.stopRealtimeListener();
      sm.userId = 'replacement';
      const newStart = sm.startRealtimeListener();
      resume();
      assert.deepEqual(await Promise.all([oldStart, newStart]), [false, true]);
      assert.equal(subscriptions.length, 1);
      assert.deepEqual(subscriptions[0].ref.path, ['users', 'replacement', 'shoppingList']);
    });

    it('publishes load and listener failures to late observers and permits a fresh subscription', async () => {
      let attempts = 0;
      const { sm, subscriptions } = harness(sdk => {
        if (++attempts === 1) throw new Error('SDK unavailable');
        return sdk;
      });
      assert.equal(await sm.startRealtimeListener(), false);
      const statuses = [];
      sm.onSyncStatusChange(status => statuses.push(status));
      assert.deepEqual(statuses, ['error']);
      assert.equal(await sm.startRealtimeListener(), true);
      subscriptions[0].error(new Error('Permission denied'));
      subscriptions[0].next(snapshot(['stale', { updatedAt: 1 }]));
      assert.equal(subscriptions[0].stops, 1);
      assert.equal(sm.shoppingList.saves, 0);
      assert.equal(statuses.at(-1), 'error');
      assert.equal(await sm.startRealtimeListener(), true);
      subscriptions[1].next(snapshot(['bread', { updatedAt: 1000 }]));
      assert.equal(sm.shoppingList.saves, 1);
      assert.equal(statuses.at(-1), 'synced');
    });

    it('stops delivery when authentication changes and unsubscribes on disconnect', async () => {
      const { sm, subscriptions } = harness();
      const session = new AbortController();
      let authChanged;
      let authStops = 0;
      sm.session = session;
      sm.userId = null;
      sm.loadAuth = async () => ({
        onAuthStateChanged(auth, next) {
          authChanged = next;
          queueMicrotask(() => next({ uid: 'shopper' }));
          return () => { authStops++; };
        }
      });
      await sm.signInAnonymously(session);
      await sm.startRealtimeListener();
      authChanged({ uid: 'other' });
      assert.equal(sm.enabled, false);
      assert.equal(sm.userId, null);
      assert.equal(sm.syncStatus, 'error');
      assert.equal(authStops, 1);
      const sub = subscriptions[0];
      sub.next(snapshot(['stale', { updatedAt: 1 }]));
      assert.equal(sm.shoppingList.saves, 0);
      sm.disconnect();
      assert.equal(sub.stops, 1);
      assert.equal(authStops, 1);
    });
  });
});
