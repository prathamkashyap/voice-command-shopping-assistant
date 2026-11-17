import { SyncOutbox } from './sync-outbox.js';

const SYNC_STATE_KEY = 'voice_shopping_sync';
const MAX_BATCH_SIZE = 400;

const FIREBASE_AUTH_URL = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
const FIREBASE_FIRESTORE_URL = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

async function importAuth() {
  return import(FIREBASE_AUTH_URL);
}

async function importFirestore() {
  return import(FIREBASE_FIRESTORE_URL);
}

/**
 * Timestamp comparison strategy:
 * - Local mutations use client-side Date.now() for immediate LWW comparison
 * - Firestore writes use serverTimestamp() which is a sentinel until resolved
 * - When comparing, prefer resolved timestamps over sentinels
 * - If both are sentinels/unresolved, fall back to client timestamps
 * - LWW: higher timestamp wins (newer = higher value)
 */
function isServerTimestampSentinel(value) {
  // Firestore serverTimestamp() returns a FieldValue sentinel object
  // We can detect it by checking for the protobuf internal structure
  return value && typeof value === 'object' && '_methodName' in value;
}

function getTimestampMillis(value) {
  // Convert various timestamp formats to milliseconds
  if (typeof value === 'number') {
    return value;
  }
  if (value && typeof value === 'object') {
    // Firestore Timestamp object
    if (typeof value.toMillis === 'function') {
      return value.toMillis();
    }
    // Server timestamp sentinel - unresolved
    if (isServerTimestampSentinel(value)) {
      return null; // Unresolved sentinel
    }
    // Plain object with toMillis (e.g., from Firestore SDK)
    if (value._seconds !== undefined) {
      return value._seconds * 1000 + Math.floor(value._nanoseconds / 1e6);
    }
  }
  return null;
}

export class SyncManager {
  constructor({ loadFirestore = importFirestore, loadAuth = importAuth, outbox = new SyncOutbox() } = {}) {
    this.loadFirestore = loadFirestore;
    this.loadAuth = loadAuth;
    this.outbox = outbox;
    this.auth = null;
    this.db = null;
    this.userId = null;
    this.enabled = false;
    this.syncInProgress = false;
    this.lastSyncTime = null;
    
    // Real-time sync
    this.listener = null;
    this.listenerFailed = false;
    this.remoteConfirmed = false;
    this.remoteItemIds = new Set();
    this.session = null;
    this.isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    this.syncStatusCallbacks = [];
    this.syncStatus = this.isOnline ? 'local-only' : 'offline';
    
    // Offline queue
    this.offlineQueue = [];
    this.flushPromise = null;
    this.pendingPersistence = new Set();
    this.retryAfterFlush = false;
    this.outboxFailed = false;
  }

  async init(shoppingList = null) {
    if (shoppingList) {
      this.shoppingList = shoppingList;
    }

    this.disconnect();
    const session = new AbortController();
    this.session = session;

    try {
      this.auth = window.firebaseAuth;
      this.db = window.firebaseDb;
      this.isOnline = navigator.onLine !== false;
      if (!this.auth || !this.db) {
        this._notifySyncStatus(this.isOnline ? 'local-only' : 'offline');
        return false;
      }

      await this.signInAnonymously(session);
      if (session.signal.aborted) return false;
      const { list, queue } = await this.outbox.readAccount(this.userId);
      if (session.signal.aborted) return false;
      this.shoppingList?.enterAccount(this.userId, list);
      this.offlineQueue = queue;
      this.enabled = true;
      this.handleRemoteChanges([]);
      this.setupOnlineOfflineListeners(session.signal);

      if (this.isOnline) {
        this._notifySyncStatus('syncing');
        const attached = await this.startRealtimeListener();
        if (!attached && this.isOnline && !session.signal.aborted) {
          this.disconnect();
          this._notifySyncStatus('error');
          return false;
        }
      } else {
        this._notifySyncStatus('offline');
      }
      if (session.signal.aborted) return false;
      this.flushOfflineQueue();
      return true;
    } catch (error) {
      if (!session.signal.aborted) {
        console.warn('Firebase initialization failed:', error.message);
        this.disconnect();
        this._notifySyncStatus('error');
      }
      return false;
    }
  }

  async signInAnonymously(session) {
    const { signInAnonymously, onAuthStateChanged } = await this.loadAuth();
    const { signal } = session;
    if (signal.aborted) throw new Error('Sync session closed');

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Auth timeout')), 10000);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Sync session closed'));
      }, { once: true });

      let signingIn = false;
      const onError = error => {
        clearTimeout(timer);
        if (signal.aborted) return;
        this.disconnect();
        this._notifySyncStatus('error');
        reject(error);
      };
      const unsubscribe = onAuthStateChanged(this.auth, user => {
        if (signal.aborted) return;
        // Retire this sender before exposing another identity's list.
        if (this.userId && user?.uid !== this.userId) {
          onError(new Error('Sync identity changed'));
          return;
        }
        if (user) {
          clearTimeout(timer);
          this.userId = user.uid;
          resolve(user);
        } else if (!signingIn) {
          signingIn = true;
          signInAnonymously(this.auth).catch(onError);
        }
      }, onError);
      if (signal.aborted) unsubscribe();
      else signal.addEventListener('abort', unsubscribe, { once: true });
    });
  }

  disconnect() {
    this.session?.abort();
    this.session = null;
    this.stopRealtimeListener();
    this.enabled = false;
    this.userId = null;
    this.listenerFailed = false;
    this.outboxFailed = false;
    this.remoteConfirmed = false;
    this.remoteItemIds.clear();
    this.offlineQueue = [];
    this.pendingPersistence.clear();
    if (this.shoppingList?.leaveAccount?.()) this.renderList();
    this._notifySyncStatus(this.isOnline ? 'local-only' : 'offline');
  }

  getUserId() {
    return this.userId;
  }

  isEnabled() {
    return this.enabled;
  }

  getPendingOperationCount() {
    return this.offlineQueue.length + this.pendingPersistence.size;
  }

  async syncItems(items = [], deletedItemIds = [], undoChanged = false) {
    if (!this.enabled || !this.userId) return false;
    if (!items.length && !deletedItemIds.length) return true;

    const userId = this.userId;
    const session = this.session;
    const current = () => this.enabled && this.session === session && this.userId === userId;
    const changes = [
      ...items.map(item => ({ item })),
      ...deletedItemIds.map(deletedId => ({ deletedId }))
    ];
    const groups = [];
    for (let i = 0; i < changes.length; i += MAX_BATCH_SIZE) {
      const chunk = changes.slice(i, i + MAX_BATCH_SIZE);
      groups.push({
        id: crypto.randomUUID(),
        items: structuredClone(chunk.flatMap(change => change.item ? [change.item] : [])),
        deletedItemIds: chunk.flatMap(change => change.deletedId == null ? [] : [change.deletedId])
      });
    }

    let listChange;
    if (this.shoppingList?.accountOwner === userId) {
      listChange = undoChanged ? { lastDeletedItem: structuredClone(this.shoppingList.lastDeletedItem) } : {};
    }

    this.pendingPersistence.add(groups);
    this._notifySyncStatus(this.isOnline ? 'syncing' : 'offline');
    try {
      const entries = await this.outbox.append(userId, groups, listChange);
      if (!current()) return false;
      for (const entry of entries) {
        if (!this.offlineQueue.some(group => group.sequence === entry.sequence)) this.offlineQueue.push(entry);
      }
    } catch (error) {
      if (current()) {
        this.outboxFailed = true;
        this._notifySyncStatus('storage-error');
        console.warn('Could not store changes for sync:', error.message);
      }
      return false;
    } finally {
      this.pendingPersistence.delete(groups);
    }

    if (this.isOnline) await this.flushOfflineQueue();
    return true;
  }

  async publishItems(localItems, deletedItemIds) {
    if (this.syncInProgress) return false;
    this.syncInProgress = true;
    const session = this.session;
    const userId = this.userId;
    const current = () => this.enabled && this.session === session && this.userId === userId;
    this._notifySyncStatus('syncing');

    try {
      const { collection, doc, writeBatch, serverTimestamp } = await this.loadFirestore();
      if (!current()) return false;

      // Use collection reference for shoppingList: users/{userId}/shoppingList (3 segments = valid collection)
      const itemsRef = collection(this.db, 'users', this.userId, 'shoppingList');
      const batch = writeBatch(this.db);

      // Write/update existing items
      for (const item of (localItems || [])) {
        const itemRef = doc(itemsRef, item.id);
        
        // Prepare item data for Firestore
        const itemData = {
          ...item,
          // Always use serverTimestamp for the authoritative write
          updatedAt: serverTimestamp(),
          // Keep deleted flag if present (for soft deletes)
          deleted: item.deleted === true,
        };
        
        // Remove client-only fields and undefined values that Firestore doesn't accept
        const { source, _updatedAtMillis, ...firestoreData } = itemData;
        
        // Filter out undefined values (Firestore doesn't accept undefined)
        Object.keys(firestoreData).forEach(key => {
          if (firestoreData[key] === undefined) {
            delete firestoreData[key];
          }
        });
        
        batch.set(itemRef, firestoreData);
      }

      // Handle deletions: mark items as deleted in Firestore
      for (const deletedId of deletedItemIds) {
        const itemRef = doc(itemsRef, deletedId);
        batch.set(itemRef, {
          deleted: true,
          updatedAt: serverTimestamp()
        }, { merge: true });
      }

      await batch.commit();
      if (current()) {
        this.lastSyncTime = Date.now();
        this.saveSyncState();
      }
      return true;
    } catch (error) {
      if (!current()) return false;
      console.warn('Firestore sync failed:', error.message);
      this._notifySyncStatus('error');
      return false;
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Merge local and remote items using Last-Write-Wins (LWW) by timestamp.
   * Strategy:
   * - Each item has a client-side updatedAt (millis) and/or server resolved timestamp
   * - Higher timestamp wins (newer = more recent)
   * - Unresolved server timestamps (sentinels) are treated as "unknown" and don't win
   * - Deleted items in remote are preserved in merge to prevent resurrection
   * - Local items not in remote are preserved (new local additions)
   */
  mergeItems(localItems, remoteItems) {
    function getReliableTime(item) {
      if (item._updatedAtMillis !== undefined && item._updatedAtMillis !== null) {
        return item._updatedAtMillis > 0 ? item._updatedAtMillis : null;
      }
      if (item._updatedAtMillis === null) {
        return null;
      }
      if (item.updatedAt !== undefined && typeof item.updatedAt === 'number' && item.updatedAt > 0) {
        return item.updatedAt;
      }
      return null;
    }

    function cleanItem(item, source) {
      const { _updatedAtMillis, ...rest } = item;
      return { ...rest, source };
    }

    const merged = new Map();

    for (const item of localItems) {
      if (!item.deleted) {
        merged.set(item.id, cleanItem(item, 'local'));
      }
    }

    for (const remote of remoteItems) {
      const local = merged.get(remote.id);
      const remoteDeleted = remote.deleted === true;
      const localTime = getReliableTime(local || {});
      const remoteTime = getReliableTime(remote);
      const localReliable = localTime !== null && localTime > 0;
      const remoteReliable = remoteTime !== null && remoteTime > 0;

      if (remoteDeleted) {
        const localWins = Boolean(local) && localReliable && remoteReliable && localTime > remoteTime;
        if (!localWins) {
          merged.delete(remote.id);
        }
        continue;
      }

      if (!local) {
        merged.set(remote.id, cleanItem(remote, 'remote'));
        continue;
      }

      const remoteWins = remoteReliable && (!localReliable || remoteTime >= localTime);
      if (remoteWins) {
        merged.set(remote.id, cleanItem(remote, 'remote'));
      }
    }

    return Array.from(merged.values());
  }

  loadSyncState() {
    try {
      const stored = localStorage.getItem(SYNC_STATE_KEY);
      if (stored) {
        const state = JSON.parse(stored);
        this.lastSyncTime = state.lastSyncTime ?? null;
      }
    } catch (e) {
      console.warn('Failed to load sync state:', e);
    }
  }

  saveSyncState() {
    try {
      localStorage.setItem(SYNC_STATE_KEY, JSON.stringify({
        lastSyncTime: this.lastSyncTime
      }));
    } catch (e) {
      console.warn('Failed to save sync state:', e);
    }
  }

  // ========== Phase 3b: Real-time Sync & Offline Queue ==========

  /**
   * Register a callback for sync status changes
   * @param {Function} callback - Called with status: 'synced' | 'syncing' | 'offline' | 'error'
   * @returns {Function} Unsubscribe function
   */
  onSyncStatusChange(callback) {
    this.syncStatusCallbacks.push(callback);
    // Immediately notify with current status
    callback(this.syncStatus);
    return () => {
      const idx = this.syncStatusCallbacks.indexOf(callback);
      if (idx > -1) this.syncStatusCallbacks.splice(idx, 1);
    };
  }

  /**
   * Notify all registered callbacks of sync status change
   */
  _notifySyncStatus(status) {
    this.syncStatus = this.outboxFailed ? 'storage-error'
      : this.listenerFailed && ['syncing', 'synced', 'local-items'].includes(status) ? 'error'
      : status;
    this.syncStatusCallbacks.forEach(cb => cb(this.syncStatus));
  }

  reportConfirmedStatus() {
    const hasLocalItems = this.shoppingList?.items.some(item => !this.remoteItemIds.has(item.id));
    this._notifySyncStatus(hasLocalItems ? 'local-items' : 'synced');
  }

  /**
   * Set up online/offline event listeners
   */
  setupOnlineOfflineListeners(signal) {
    window.addEventListener('online', () => this.handleOnline(), { signal });
    window.addEventListener('offline', () => this.handleOffline(), { signal });
  }

  handleOnline() {
    if (this.isOnline) return; // Already online
    this.isOnline = true;
    console.log('[SyncManager] Online - flushing offline queue');
    this._notifySyncStatus('syncing');
    this.flushOfflineQueue();
    // Re-start real-time listener if it was stopped
    this.startRealtimeListener();
  }

  handleOffline() {
    if (!this.isOnline) return; // Already offline
    this.isOnline = false;
    this.remoteConfirmed = false;
    console.log('[SyncManager] Offline - queuing writes locally');
    this._notifySyncStatus('offline');
    this.stopRealtimeListener();
  }

  /**
   * Start real-time Firestore listener for remote changes
   */
  startRealtimeListener() {
    if (!this.enabled || !this.db || !this.userId || !this.isOnline) return Promise.resolve(false);
    if (this.listener?.uid === this.userId && this.listener.db === this.db) {
      return this.listener.ready;
    }
    this.stopRealtimeListener();
    const listener = { uid: this.userId, db: this.db, unsubscribe: null };
    this.listener = listener;
    listener.ready = this.attachRealtimeListener(listener);
    return listener.ready;
  }

  async attachRealtimeListener(listener) {
    const current = () => this.listener === listener && this.userId === listener.uid &&
      this.db === listener.db && this.enabled && this.isOnline;
    const onError = error => {
      if (!current()) return;
      console.warn('Real-time listener error:', error.message);
      this.stopRealtimeListener();
      this.listenerFailed = true;
      this._notifySyncStatus('error');
    };
    try {
      const { collection, onSnapshot } = await this.loadFirestore();
      if (!current()) return false;
      const itemsRef = collection(listener.db, 'users', listener.uid, 'shoppingList');
      const unsubscribe = onSnapshot(itemsRef, { includeMetadataChanges: true }, snapshot => {
        if (!current()) return;
        const remoteItems = [];
        snapshot.forEach(doc => {
          const data = doc.data();
          const millis = getTimestampMillis(data.updatedAt);
          remoteItems.push({ ...data, id: doc.id, _updatedAtMillis: millis, updatedAt: millis ?? Date.now() });
        });
        this.remoteConfirmed = !snapshot.metadata?.fromCache && !snapshot.metadata?.hasPendingWrites;
        this.handleRemoteChanges(remoteItems, this.remoteConfirmed);
        if (this.remoteConfirmed) {
          this.remoteItemIds = new Set(remoteItems.filter(item => !item.deleted).map(item => item.id));
          if (!this.syncInProgress && this.getPendingOperationCount() === 0) {
            this.listenerFailed = false;
            this.reportConfirmedStatus();
          }
        }
      }, onError);
      if (!current()) {
        unsubscribe();
        return false;
      }
      listener.unsubscribe = unsubscribe;
      this.listenerFailed = false;
      return true;
    } catch (error) {
      onError(error);
      return false;
    }
  }

  stopRealtimeListener() {
    const listener = this.listener;
    this.listener = null;
    this.remoteConfirmed = false;
    listener?.unsubscribe?.();
  }

  /**
   * Handle remote changes from real-time listener
   */
  mergeProjection(localItems, remoteItems, pending) {
    const items = new Map(this.mergeItems(localItems, remoteItems).map(item => [item.id, item]));
    for (const group of pending) {
      for (const item of group.items) items.set(item.id, { ...item });
      for (const id of group.deletedItemIds) items.delete(id);
    }
    return [...items.values()];
  }

  renderList() {
    const app = globalThis.window?.app;
    if (app?.ui) {
      app.ui.renderShoppingList();
      app.updateSuggestions();
    }
  }

  async handleRemoteChanges(remoteItems, confirmed = false) {
    if (!this.enabled || !this.shoppingList) return;

    const pending = [...this.offlineQueue, ...Array.from(this.pendingPersistence).flat()];
    this.shoppingList.items = this.mergeProjection(this.shoppingList.items, remoteItems, pending);
    this.renderList();
    if (!confirmed || this.shoppingList.accountOwner !== this.userId) return;

    const { userId, session } = this;
    try {
      await this.outbox.mergeRemote(userId, (items, persisted) =>
        this.mergeProjection(items, remoteItems, persisted)
      );
    } catch (error) {
      if (this.enabled && this.userId === userId && this.session === session) {
        this.outboxFailed = true;
        this._notifySyncStatus('storage-error');
        console.warn('Could not save the synced list on this device:', error.message);
      }
    }
  }

  async flushOfflineQueue() {
    if (!this.enabled || !this.userId || !this.isOnline) return false;
    if (this.flushPromise) {
      this.retryAfterFlush = true;
      return this.flushPromise;
    }

    const userId = this.userId;
    const session = this.session;
    const current = () => this.enabled && this.session === session && this.userId === userId && this.isOnline;
    this.flushPromise = Promise.resolve()
      .then(() => this.outbox.withSender(userId, () => this.drainOutbox(userId, current)))
      .catch(error => {
        if (current()) {
          console.warn('Could not replay pending changes:', error.message);
          this._notifySyncStatus('error');
        }
        return false;
      });
    let drained = false;
    try {
      drained = await this.flushPromise;
      return drained;
    } finally {
      this.flushPromise = null;
      const retry = this.retryAfterFlush;
      this.retryAfterFlush = false;
      if (retry && (drained || !current())) this.flushOfflineQueue();
    }
  }

  async drainOutbox(userId, current) {
    while (current()) {
      const queue = await this.outbox.list(userId);
      if (!current()) return false;
      this.offlineQueue = [...queue];
      if (!queue.length) {
        if (!this.pendingPersistence.size && this.remoteConfirmed) this.reportConfirmedStatus();
        return true;
      }
      for (const group of queue) {
        if (!current() || !await this.publishItems(group.items, group.deletedItemIds)) return false;
        // The ID is unique within this database. Record an acknowledgment even if auth changed during the write.
        await this.outbox.acknowledge(group.sequence);
        if (current()) this.offlineQueue = this.offlineQueue.filter(entry => entry.sequence !== group.sequence);
      }
    }
    return false;
  }
}

export const syncManager = new SyncManager();
