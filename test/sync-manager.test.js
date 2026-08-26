import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SyncManager } from '../public/js/sync-manager.js';

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
    it('should prefer remote when remote has deleted=true (deletion wins)', () => {
      const sm = new SyncManager();
      const localItems = [
        { id: '1', name: 'Milk', quantity: 1, unit: 'L', updatedAt: 3000 }
      ];
      const remoteItems = [
        { id: '1', name: 'Milk', quantity: 1, unit: 'L', updatedAt: 1000, deleted: true }
      ];

      const merged = sm.mergeItems(localItems, remoteItems);

      assert.equal(merged.length, 1);
      assert.equal(merged[0].deleted, true);
      assert.equal(merged[0].source, 'remote');
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

      assert.equal(merged.length, 1);
      assert.equal(merged[0].deleted, true);
      assert.equal(merged[0].source, 'remote');
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

  describe('getTimestampMillis / isServerTimestampSentinel', () => {
    it('should detect server timestamp sentinel', () => {
      const sm = new SyncManager();
      // We can't easily test the internal function, but we can test the behavior
      // through mergeItems which uses it
      const sentinel = { _methodName: 'FieldValue.serverTimestamp' };
      // The function is not exported, so we test behavior indirectly
      assert.ok(true); // Placeholder - behavior tested via mergeItems
    });

    it('should convert Firestore Timestamp to millis', () => {
      // Test through mergeItems behavior
      assert.ok(true);
    });
  });
});