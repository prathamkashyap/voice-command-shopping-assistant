const DATABASE = 'voice_shopping_sync';
const STORE = 'outbox';

export class SyncOutbox {
  open() {
    if (!this.connection) {
      this.connection = new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore(STORE, { keyPath: 'sequence', autoIncrement: true });
          store.createIndex('owner', 'owner');
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

  async append(owner, groups) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      const requests = groups.map(group => store.add({ ...group, owner }));
      transaction.oncomplete = () => resolve(groups.map((group, index) => ({
        ...group, sequence: requests[index].result
      })));
      transaction.onabort = () => reject(transaction.error);
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

  async acknowledge(sequence) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).delete(sequence);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
  }

  withSender(owner, send) {
    return navigator.locks
      ? navigator.locks.request(`voice-shopping-sync:${owner}`, send)
      : send();
  }
}
