import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import * as firestore from 'firebase/firestore';
import { SyncManager } from '../public/js/sync-manager.js';

const skip = process.env.SHOPPING_DEMO_INTEGRATION !== '1' && 'Run npm run test:integration';

test('Firestore listener receives changes across two sessions with the same identity', { skip, timeout: 15000 }, async () => {
  const { collection, connectFirestoreEmulator, doc, getFirestore, setDoc, terminate } = firestore;
  const config = { projectId: 'demo-voice-shopping', apiKey: 'demo-key' };
  const writer = initializeApp(config, 'writer');
  const reader = initializeApp(config, 'reader');
  const outsider = initializeApp(config, 'outsider');
  const connections = [];
  let queue = [];
  const sync = new SyncManager({
    loadFirestore: async () => firestore,
    outbox: {
      async append(_owner, groups) {
        const entries = groups.map(group => ({ ...group, sequence: group.id }));
        queue.push(...entries);
        return entries;
      },
      async list() { return [...queue]; },
      async acknowledge(sequence) { queue = queue.filter(group => group.sequence !== sequence); },
      withSender(_owner, send) { return send(); }
    }
  });
  let timer;
  try {
    const email = 'shopper@example.test';
    const password = 'emulator-test-password';
    const writerAuth = getAuth(writer);
    const readerAuth = getAuth(reader);
    for (const auth of [writerAuth, readerAuth]) {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    }
    const { user } = await createUserWithEmailAndPassword(writerAuth, email, password);
    await signInWithEmailAndPassword(readerAuth, email, password);
    for (const app of [writer, reader, outsider]) {
      const db = getFirestore(app);
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
      connections.push(db);
    }
    const [writerDb, readerDb, outsiderDb] = connections;
    sync.enabled = true;
    sync.userId = user.uid;
    sync.db = readerDb;
    const observed = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('The listener did not observe the committed item')), 6000);
      sync.handleRemoteChanges = items => {
        const item = items.find(row => row.id === 'milk');
        if (item) resolve(item);
      };
    });
    // A failed write or listener attachment must not leave an unhandled rejection.
    observed.catch(() => {});
    assert.equal(await sync.startRealtimeListener(), true);
    const item = doc(collection(writerDb, 'users', user.uid, 'shoppingList'), 'milk');
    await setDoc(item, { name: 'Milk', quantity: 2, updatedAt: firestore.serverTimestamp() });
    assert.equal((await observed).quantity, 2);
    const tombstone = doc(collection(readerDb, 'users', user.uid, 'shoppingList'), 'never-uploaded');
    sync.saveSyncState = () => {};
    assert.equal(await sync.syncItems([], [tombstone.id]), true);
    assert.equal((await firestore.getDocFromServer(tombstone)).data().deleted, true);
    await assert.rejects(
      firestore.getDocFromServer(doc(outsiderDb, item.path)),
      { code: 'permission-denied' }
    );
  } finally {
    clearTimeout(timer);
    sync.disconnect();
    await Promise.allSettled(connections.map(terminate));
    await Promise.all([writer, reader, outsider].map(deleteApp));
  }
});
