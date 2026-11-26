import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInAnonymously, signInWithEmailAndPassword } from 'firebase/auth';
import * as firestore from 'firebase/firestore';
import { SyncManager } from '../public/js/sync-manager.js';

const skip = process.env.SHOPPING_DEMO_INTEGRATION !== '1' && 'Run npm run test:integration';

async function createReceiptSessions(t) {
  const fixtureId = crypto.randomUUID();
  const config = { projectId: 'demo-voice-shopping', apiKey: 'demo-key' };
  const apps = ['owner', 'second-session', 'different-user', 'signed-out'].map(name =>
    initializeApp(config, `${name}-${fixtureId}`)
  );
  const connections = [];
  t.after(async () => {
    await Promise.allSettled(connections.map(db => firestore.terminate(db)));
    await Promise.all(apps.map(deleteApp));
  });
  const auths = apps.map(app => {
    const auth = getAuth(app);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    return auth;
  });
  const email = `receipt-${fixtureId}@example.test`;
  const password = 'emulator-test-password';
  const { user } = await createUserWithEmailAndPassword(auths[0], email, password);
  await signInWithEmailAndPassword(auths[1], email, password);
  await signInAnonymously(auths[2]);
  for (const app of apps) {
    const db = firestore.getFirestore(app);
    firestore.connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connections.push(db);
  }
  return { owner: user.uid, db: connections[0], secondDb: connections[1], otherDb: connections[2], signedOutDb: connections[3] };
}

function retainedOutbox() {
  let queue = [];
  return {
    async append(owner, groups) {
      const entries = structuredClone(groups.map(group => ({ ...group, owner, sequence: group.id })));
      queue.push(...entries);
      return entries;
    },
    async list(owner) { return structuredClone(queue.filter(group => group.owner === owner)); },
    async acknowledge(sequence) { queue = queue.filter(group => group.sequence !== sequence); },
    // Deliberately omit cross-tab locking to exercise the server receipt guard.
    withSender(_owner, send) { return send(); }
  };
}

function receiptSender(t, db, owner, { sdk = firestore, outbox = retainedOutbox() } = {}) {
  const sync = new SyncManager({ loadFirestore: async () => sdk, outbox });
  sync.enabled = true;
  sync.isOnline = true;
  sync.userId = owner;
  sync.db = db;
  sync.session = new AbortController();
  sync.saveSyncState = () => {};
  t.after(() => sync.disconnect());
  return sync;
}

test('Firestore listener receives changes across two sessions with the same identity', { skip, timeout: 45000 }, async () => {
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
    let rejectObservation;
    const observed = new Promise((resolve, reject) => {
      rejectObservation = reject;
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
    // Measure listener delivery after the write, not emulator cold-start setup.
    timer = setTimeout(() => rejectObservation(new Error('The listener did not observe the committed item')), 6000);
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

test('a committed operation survives a lost acknowledgment and replay cannot overwrite a newer edit', { skip, timeout: 20000 }, async t => {
  const { owner, db, secondDb } = await createReceiptSessions(t);
  const outbox = retainedOutbox();
  let loseResponse = true;
  const sdk = {
    ...firestore,
    async runTransaction(...args) {
      const result = await firestore.runTransaction(...args);
      if (loseResponse) {
        loseResponse = false;
        throw new Error('Simulated connection loss after the server committed');
      }
      return result;
    }
  };
  const firstSender = receiptSender(t, db, owner, { sdk, outbox });
  const item = firestore.doc(db, 'users', owner, 'shoppingList', 'milk');
  assert.equal(await firstSender.syncItems([{ id: 'milk', name: 'Milk', quantity: 2 }]), true);
  const pending = await outbox.list(owner);
  assert.equal(pending.length, 1, 'a lost response must leave the durable group queued');
  const receipt = firestore.doc(db, 'users', owner, 'syncReceipts', pending[0].id);
  const originalReceipt = (await firestore.getDocFromServer(receipt)).data();
  const originalItem = (await firestore.getDocFromServer(item)).data();
  assert.equal(originalReceipt.version, 1);
  assert.equal(originalItem.quantity, 2);
  assert.ok(originalItem.updatedAt.isEqual(originalReceipt.committedAt), 'item and receipt commit atomically');

  await firestore.setDoc(firestore.doc(secondDb, item.path), {
    id: 'milk', name: 'Milk', quantity: 9, deleted: false, updatedAt: firestore.serverTimestamp()
  });
  const newerItem = (await firestore.getDocFromServer(item)).data();
  firstSender.disconnect();
  const restartedSender = receiptSender(t, db, owner, { outbox });
  assert.equal(await restartedSender.flushOfflineQueue(), true);
  assert.deepEqual(await outbox.list(owner), []);
  assert.deepEqual((await firestore.getDocFromServer(item)).data(), newerItem);
  assert.deepEqual((await firestore.getDocFromServer(receipt)).data(), originalReceipt);

  assert.equal(await restartedSender.syncItems([{ id: 'milk', name: 'Milk', quantity: 10 }]), true);
  assert.equal((await firestore.getDocFromServer(item)).data().quantity, 10, 'a fresh operation still applies');
  const receipts = await firestore.getDocs(firestore.collection(db, 'users', owner, 'syncReceipts'));
  assert.equal(receipts.size, 2, 'retry reuses its receipt and a new edit gets a distinct receipt');
});

test('replaying a committed deletion does not delete an item restored by a newer operation', { skip, timeout: 20000 }, async t => {
  const { owner, db, secondDb } = await createReceiptSessions(t);
  const firstSender = receiptSender(t, db, owner);
  const secondSender = receiptSender(t, secondDb, owner);
  const deletionId = crypto.randomUUID();
  assert.deepEqual(await firstSender.publishItems([], ['milk'], deletionId), { replayedItems: null });
  const item = firestore.doc(db, 'users', owner, 'shoppingList', 'milk');
  assert.equal((await firestore.getDocFromServer(item)).data().deleted, true);
  assert.deepEqual(await secondSender.publishItems([{ id: 'milk', name: 'Milk', quantity: 3 }], [], crypto.randomUUID()), { replayedItems: null });
  const restoredItem = (await firestore.getDocFromServer(item)).data();
  const replay = await firstSender.publishItems([], ['milk'], deletionId);
  assert.equal(replay.replayedItems[0].quantity, 3);
  assert.deepEqual((await firestore.getDocFromServer(item)).data(), restoredItem);
});

test('concurrent sessions submit the same operation with one receipt and no duplicate rewrite', { skip, timeout: 20000 }, async t => {
  const { owner, db, secondDb } = await createReceiptSessions(t);
  let arrivals = 0;
  let release;
  let timer;
  const bothRead = new Promise((resolve, reject) => {
    release = resolve;
    timer = setTimeout(() => reject(new Error('Both senders must read the missing receipt')), 8000);
  });
  bothRead.catch(() => {});
  t.after(() => clearTimeout(timer));
  const snapshots = [];
  const sdk = {
    ...firestore,
    runTransaction(connection, update) {
      let initialRead = true;
      return firestore.runTransaction(connection, transaction => update({
        async get(reference) {
          const snapshot = await transaction.get(reference);
          snapshots.push(snapshot.exists());
          if (initialRead) {
            initialRead = false;
            assert.equal(snapshot.exists(), false, 'the first attempt reads no receipt');
            if (++arrivals === 2) release();
            await bothRead;
          }
          return snapshot;
        },
        set(...args) { return transaction.set(...args); }
      }));
    }
  };
  const firstSender = receiptSender(t, db, owner, { sdk });
  const secondSender = receiptSender(t, secondDb, owner, { sdk });
  const operationId = crypto.randomUUID();
  const change = [{ id: 'milk', name: 'Milk', quantity: 4 }];
  const results = await Promise.all([
    firstSender.publishItems(change, [], operationId),
    secondSender.publishItems(change, [], operationId)
  ]);
  assert.equal(results.filter(result => result.replayedItems === null).length, 1);
  assert.equal(results.filter(result => Array.isArray(result.replayedItems)).length, 1);
  assert.ok(snapshots.includes(true), 'the contending transaction retries and sees the committed receipt');
  const item = firestore.doc(db, 'users', owner, 'shoppingList', 'milk');
  const receipt = firestore.doc(db, 'users', owner, 'syncReceipts', operationId);
  const itemData = (await firestore.getDocFromServer(item)).data();
  const receiptData = (await firestore.getDocFromServer(receipt)).data();
  assert.ok(itemData.updatedAt.isEqual(receiptData.committedAt));
  assert.equal((await firestore.getDocs(firestore.collection(db, 'users', owner, 'syncReceipts'))).size, 1);
});

test('receipts are owner-scoped, immutable and schema-validated, including atomic rejection', { skip, timeout: 20000 }, async t => {
  const { owner, db, otherDb, signedOutDb } = await createReceiptSessions(t);
  const receipt = firestore.doc(db, 'users', owner, 'syncReceipts', crypto.randomUUID());
  const receiptData = () => ({ version: 1, committedAt: firestore.serverTimestamp() });
  await firestore.setDoc(receipt, receiptData());
  assert.equal((await firestore.getDocFromServer(receipt)).data().version, 1);
  for (const connection of [otherDb, signedOutDb]) {
    await assert.rejects(firestore.getDocFromServer(firestore.doc(connection, receipt.path)), { code: 'permission-denied' });
    await assert.rejects(firestore.setDoc(
      firestore.doc(connection, 'users', owner, 'syncReceipts', crypto.randomUUID()), receiptData()
    ), { code: 'permission-denied' });
  }
  await assert.rejects(firestore.setDoc(receipt, receiptData()), { code: 'permission-denied' });
  await assert.rejects(firestore.deleteDoc(receipt), { code: 'permission-denied' });
  for (const invalid of [
    { version: 2, committedAt: firestore.serverTimestamp() },
    { version: 1 },
    { version: 1, committedAt: 'not-a-timestamp' },
    { version: 1, committedAt: firestore.Timestamp.fromMillis(1) },
    { ...receiptData(), unexpected: true }
  ]) {
    await assert.rejects(firestore.setDoc(
      firestore.doc(db, 'users', owner, 'syncReceipts', crypto.randomUUID()), invalid
    ), { code: 'permission-denied' });
  }
  const item = firestore.doc(db, 'users', owner, 'shoppingList', 'atomic-rejection');
  const invalidReceipt = firestore.doc(db, 'users', owner, 'syncReceipts', crypto.randomUUID());
  await assert.rejects(firestore.runTransaction(db, async transaction => {
    transaction.set(item, { name: 'Milk', quantity: 2 });
    transaction.set(invalidReceipt, { version: 2, committedAt: firestore.serverTimestamp() });
  }), { code: 'permission-denied' });
  assert.equal((await firestore.getDocFromServer(item)).exists(), false, 'a rejected receipt must roll back its item write');
});
