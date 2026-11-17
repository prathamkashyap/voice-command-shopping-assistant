const SYNC_STATE_KEY = 'voice_shopping_sync';
const OFFLINE_QUEUE_KEY = 'voice_shopping_offline_queue';

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
  constructor({ loadFirestore = importFirestore, loadAuth = importAuth } = {}) {
    this.loadFirestore = loadFirestore;
    this.loadAuth = loadAuth;
    this.auth = null;
    this.db = null;
    this.userId = null;
    this.enabled = false;
    this.syncInProgress = false;
    this.lastSyncTime = null;
    
    // Real-time sync
    this.listener = null;
    this.listenerFailed = false;
    this.session = null;
    this.isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    this.syncStatusCallbacks = [];
    this.syncStatus = this.isOnline ? 'local-only' : 'offline';
    
    // Offline queue
    this.offlineQueue = [];
    this.queueFlushInProgress = false;
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
      this.enabled = true;
      this.loadOfflineQueue();
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
        // The legacy list and outbox have no owner field. Stop on identity
        // changes instead of delivering the previous user's records.
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
    this._notifySyncStatus(this.isOnline ? 'local-only' : 'offline');
  }

  getUserId() {
    return this.userId;
  }

  isEnabled() {
    return this.enabled;
  }

  getPendingOperationCount() {
    return this.offlineQueue.length;
  }

  async syncItems(localItems, deletedItemIds = []) {
    if (!this.enabled || !this.userId) return false;

    // If offline, queue the operation
    if (!this.isOnline) {
      console.log('[SyncManager] Offline - queueing sync operation');
      if (deletedItemIds && deletedItemIds.length > 0) {
        for (const delId of deletedItemIds) {
          this.queueOfflineOperation({
            type: 'delete',
            deletedId: delId
          });
        }
      }
      if (localItems && localItems.length > 0) {
        for (const item of localItems) {
          this.queueOfflineOperation({
            type: 'update',
            item
          });
        }
      }
      return true; // Return true to indicate operation was queued
    }

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
        batch.update(itemRef, {
          deleted: true,
          updatedAt: serverTimestamp()
        });
      }

      await batch.commit();
      if (!current()) return false;
      this.lastSyncTime = Date.now();
      this.saveSyncState();
      this._notifySyncStatus(this.isOnline ? 'synced' : 'offline');
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

  async fetchRemoteItems() {
    if (!this.enabled || !this.userId) return [];

    const db = this.db;
    const userId = this.userId;
    try {
      const { collection, getDocs, query } = await this.loadFirestore();

      // Use collection reference for shoppingList: users/{userId}/shoppingList (3 segments = valid collection)
      const itemsRef = collection(db, 'users', userId, 'shoppingList');
      // Fetch ALL items (including deleted) to prevent resurrection of deleted items
      const q = query(itemsRef);
      const snapshot = await getDocs(q);

      const remoteItems = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        // Convert Firestore Timestamp to milliseconds for comparison
        const updatedAtMillis = getTimestampMillis(data.updatedAt);
        remoteItems.push({
          id: doc.id,
          ...data,
          // Store both the raw value (for Firestore writes) and millis (for comparison)
          _updatedAtMillis: updatedAtMillis,
          updatedAt: updatedAtMillis !== null ? updatedAtMillis : Date.now()
        });
      });

      return remoteItems;
    } catch (error) {
      console.warn('Fetch remote items failed:', error.message);
      return [];
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

  async initialSync(shoppingList) {
    if (!this.enabled) return false;
    this.shoppingList = shoppingList;

    try {
      const session = this.session;
      const userId = this.userId;
      const remoteItems = await this.fetchRemoteItems();
      if (!this.enabled || this.session !== session || this.userId !== userId) return false;
      if (remoteItems.length === 0) {
        await this.syncItems(shoppingList.items);
        return true;
      }

      const merged = this.mergeItems(shoppingList.items, remoteItems);
      shoppingList.items = merged;
      shoppingList.saveLocal();

      await this.syncItems(merged);
      return true;
    } catch (error) {
      console.warn('Initial sync failed:', error.message);
      this._notifySyncStatus('error');
      return false;
    }
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
    this.syncStatus = this.listenerFailed && (status === 'syncing' || status === 'synced')
      ? 'error'
      : status;
    this.syncStatusCallbacks.forEach(cb => cb(this.syncStatus));
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
      const unsubscribe = onSnapshot(itemsRef, snapshot => {
        if (!current()) return;
        const remoteItems = [];
        snapshot.forEach(doc => {
          const data = doc.data();
          const millis = getTimestampMillis(data.updatedAt);
          remoteItems.push({ ...data, id: doc.id, _updatedAtMillis: millis, updatedAt: millis ?? Date.now() });
        });
        this.handleRemoteChanges(remoteItems);
        if (!snapshot.metadata?.fromCache && !snapshot.metadata?.hasPendingWrites &&
            !this.syncInProgress && !this.offlineQueue.length) {
          this.listenerFailed = false;
          this._notifySyncStatus('synced');
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
    listener?.unsubscribe?.();
  }

  /**
   * Handle remote changes from real-time listener
   */
  async handleRemoteChanges(remoteItems) {
    if (!this.enabled) return;

    try {
      // Get current local items
      const localItems = this.shoppingList ? this.shoppingList.items : [];
      
      // Merge remote changes with local
      const merged = this.mergeItems(localItems, remoteItems);
      
      // Update local state
      if (this.shoppingList) {
        this.shoppingList.items = merged;
        this.shoppingList.saveLocal();
      }

      // Notify UI of changes (if app has a reference)
      if (globalThis.window?.app?.ui) {
        window.app.ui.renderShoppingList();
        window.app.updateSuggestions();
      }

      console.log('[SyncManager] Remote changes merged');
    } catch (error) {
      console.warn('Failed to handle remote changes:', error.message);
    }
  }

  /**
   * Offline queue management
   */
  loadOfflineQueue() {
    try {
      const stored = localStorage.getItem(OFFLINE_QUEUE_KEY);
      if (stored) {
        this.offlineQueue = JSON.parse(stored);
        console.log('[SyncManager] Loaded offline queue:', this.offlineQueue.length, 'operations');
      }
    } catch (e) {
      console.warn('Failed to load offline queue:', e);
      this.offlineQueue = [];
    }
  }

  saveOfflineQueue() {
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(this.offlineQueue));
    } catch (e) {
      console.warn('Failed to save offline queue:', e);
    }
  }

  /**
   * Add operation to offline queue
   */
  queueOfflineOperation(operation) {
    this.offlineQueue.push({
      ...operation,
      timestamp: Date.now(),
      id: crypto.randomUUID()
    });
    this.saveOfflineQueue();
    console.log('[SyncManager] Queued offline operation:', operation.type);
  }

  /**
   * Flush offline queue to Firestore
   */
  async flushOfflineQueue() {
    if (!this.enabled || !this.isOnline || this.queueFlushInProgress || this.offlineQueue.length === 0) {
      return;
    }

    this.queueFlushInProgress = true;
    console.log('[SyncManager] Flushing offline queue:', this.offlineQueue.length, 'operations');

    const queue = [...this.offlineQueue];
    this.offlineQueue = [];
    this.saveOfflineQueue();

    for (const operation of queue) {
      try {
        await this.executeOfflineOperation(operation);
      } catch (error) {
        console.warn('Failed to execute offline operation:', error.message);
        // Re-queue failed operation
        this.offlineQueue.unshift(operation);
        this.saveOfflineQueue();
      }
    }

    this.queueFlushInProgress = false;
    
    // If more operations were added during flush, flush again
    if (this.offlineQueue.length > 0) {
      this.flushOfflineQueue();
    }
  }

  async executeOfflineOperation(operation) {
    const { type, item, deletedId, itemIds } = operation;
    
    switch (type) {
      case 'add':
      case 'update':
        await this.syncItems([item]);
        break;
      case 'delete':
        await this.syncItems([], [deletedId]);
        break;
      case 'clear':
        await this.syncItems([], itemIds);
        break;
    }
  }
}

export const syncManager = new SyncManager();