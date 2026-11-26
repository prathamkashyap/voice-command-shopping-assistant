const DATABASE = 'voice_shopping_sync';
const STORE = 'outbox';
const LISTS = 'lists';

function changeProjection(current, groups, listChange) {
  const items = new Map((current?.items ?? []).map(item => [item.id, item]));
  for (const group of groups) {
    for (const item of group.items) items.set(item.id, item);
    for (const id of group.deletedItemIds) items.delete(id);
  }
  return {
    items: [...items.values()],
    lastDeletedItem: Object.hasOwn(listChange, 'lastDeletedItem')
      ? listChange.lastDeletedItem
      : (current?.lastDeletedItem ?? null)
  };
}

export class SyncOutbox {
  open() {
    if (!this.connection) {
      this.connection = new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 2);
        request.onupgradeneeded = event => {
          if (event.oldVersion === 0) {
            const store = request.result.createObjectStore(STORE, { keyPath: 'sequence', autoIncrement: true });
            store.createIndex('owner', 'owner');
          }
          const lists = request.result.createObjectStore(LISTS, { keyPath: 'owner' });
          if (event.oldVersion === 1) {
            const pending = request.transaction.objectStore(STORE).getAll();
            pending.onsuccess = () => {
              const byOwner = new Map();
              for (const group of pending.result) {
                if (!byOwner.has(group.owner)) byOwner.set(group.owner, []);
                byOwner.get(group.owner).push(group);
              }
              for (const [owner, groups] of byOwner) {
                lists.put({ owner, ...changeProjection(undefined, groups, {}) });
              }
            };
          }
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            this.connection = null;
          };
          resolve(db);
        };
      }).catch(error => {
        this.connection = null;
        throw error;
      });
    }
    return this.connection;
  }

  async append(owner, groups, listChange) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(listChange ? [STORE, LISTS] : STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      const requests = [];
      let writeError;
      const abort = error => {
        writeError = error;
        transaction.abort();
      };
      transaction.oncomplete = () => resolve(groups.map((group, index) => ({
        ...group, sequence: requests[index].result
      })));
      transaction.onabort = () => reject(writeError ?? transaction.error);
      try {
        for (const group of groups) requests.push(store.add({ ...group, owner }));
        if (listChange) {
          const lists = transaction.objectStore(LISTS);
          const request = lists.get(owner);
          request.onsuccess = () => {
            try {
              lists.put({ owner, ...changeProjection(request.result, groups, listChange) });
            } catch (error) {
              abort(error);
            }
          };
        }
      } catch (error) {
        abort(error);
      }
    });
  }

  async readAccount(owner) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE, LISTS], 'readonly');
      const list = transaction.objectStore(LISTS).get(owner);
      const queue = transaction.objectStore(STORE).index('owner').getAll(owner);
      transaction.oncomplete = () => resolve({ list: list.result, queue: queue.result });
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async mergeRemote(owner, mergeItems) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE, LISTS], 'readwrite');
      const lists = transaction.objectStore(LISTS);
      const cached = lists.get(owner);
      const queue = transaction.objectStore(STORE).index('owner').getAll(owner);
      let projectionError;
      queue.onsuccess = () => {
        try {
          const items = mergeItems(cached.result?.items ?? [], queue.result);
          lists.put({ owner, items, lastDeletedItem: cached.result?.lastDeletedItem ?? null });
        } catch (error) {
          projectionError = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(projectionError ?? transaction.error);
    });
  }

  async list(owner) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly');
      const request = transaction.objectStore(STORE).index('owner').getAll(owner);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async acknowledge(sequence, reconciliation) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(reconciliation ? [STORE, LISTS] : STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      let result;
      let reconciliationError;
      const abort = error => {
        reconciliationError = error;
        transaction.abort();
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(reconciliationError ?? transaction.error);
      try {
        if (!reconciliation) {
          store.delete(sequence);
          return;
        }
        const { owner, mergeItems } = reconciliation;
        const record = store.get(sequence);
        const lists = transaction.objectStore(LISTS);
        const cached = lists.get(owner);
        const queue = store.index('owner').getAll(owner);
        queue.onsuccess = () => {
          try {
            // A different sender may have already reconciled and acknowledged it.
            // Returning that durable view avoids applying a stale response twice.
            if (!record.result) {
              result = { acknowledged: false, list: cached.result, queue: queue.result };
              return;
            }
            if (record.result.owner !== owner) throw new Error('Cannot acknowledge another account\'s operation');
            const remaining = queue.result.filter(group => group.sequence !== sequence);
            store.delete(sequence);
            const list = {
              owner,
              items: mergeItems(cached.result?.items ?? [], remaining),
              lastDeletedItem: cached.result?.lastDeletedItem ?? null
            };
            lists.put(list);
            result = { acknowledged: true, list, queue: remaining };
          } catch (error) {
            abort(error);
          }
        };
      } catch (error) {
        abort(error);
      }
    });
  }

  withSender(owner, send) {
    return navigator.locks
      ? navigator.locks.request(`voice-shopping-sync:${owner}`, send)
      : send();
  }
}
