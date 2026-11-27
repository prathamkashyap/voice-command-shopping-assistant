import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SyncManager } from '../public/js/sync-manager.js';

function setup(t, errors) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(Math, 'random', () => 0);
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'log', () => {});

  let queue = [];
  let sequence = 0;
  let locked = false;
  const attempts = [];
  const sync = new SyncManager({
    outbox: {
      async append(owner, groups) {
        const entries = groups.map(group => ({ ...group, owner, sequence: ++sequence }));
        queue.push(...entries);
        return entries;
      },
      async list(owner) { return queue.filter(group => group.owner === owner); },
      async acknowledge(id) { queue = queue.filter(group => group.sequence !== id); },
      async withSender(_owner, send) {
        assert.equal(locked, false, 'senders for this tab must not overlap');
        locked = true;
        try { return await send(); } finally { locked = false; }
      }
    },
    loadFirestore: async () => ({
      collection: (_db, ...path) => path.join('/'),
      doc: (collection, id) => `${collection}/${id}`,
      serverTimestamp: () => 'server-time',
      async runTransaction(_db, callback) {
        return callback({
          async get(receipt) {
            assert.equal(locked, true);
            attempts.push(receipt.split('/').at(-1));
            const code = errors.shift();
            if (code) throw Object.assign(new Error(code), { code });
            return { exists: () => false };
          },
          set() {}
        });
      }
    })
  });
  sync.userId = 'shopper';
  sync.db = {};
  sync.session = new AbortController();
  sync.enabled = sync.isOnline = sync.remoteConfirmed = true;
  t.mock.method(sync, 'saveSyncState', () => {});
  t.mock.method(sync, 'startRealtimeListener', async () => true);
  t.after(() => sync.disconnect());
  return { sync, attempts, get queue() { return queue; }, get locked() { return locked; } };
}

test('a delayed retry keeps the original ID and queue order without holding the sender lock', async t => {
  const state = setup(t, ['unavailable']);
  const { sync, attempts } = state;
  const statuses = [];
  sync.onSyncStatusChange(status => statuses.push(status));
  assert.equal(await sync.syncItems([{ id: 'milk' }]), true);
  const [first] = state.queue;
  assert.equal(sync.syncStatus, 'retrying');
  assert.equal(state.locked, false);

  assert.equal(await sync.syncItems([{ id: 'bread' }]), true);
  const secondId = state.queue[1].id;
  t.mock.timers.tick(499);
  assert.deepEqual(attempts, [first.id]);
  assert.equal(sync.syncStatus, 'retrying');
  assert.equal(statuses.includes('synced'), false);

  t.mock.timers.tick(1);
  assert.ok(sync.flushPromise, 'the timer should start a new drain');
  await sync.flushPromise;
  assert.deepEqual(attempts, [first.id, first.id, secondId]);
  assert.deepEqual(state.queue, []);
  assert.equal(sync.syncStatus, 'synced');
});

test('transient failures stop after four retries and a later edit stays behind the failed group', async t => {
  const state = setup(t, Array(5).fill('deadline-exceeded'));
  const { sync, attempts } = state;
  await sync.syncItems([{ id: 'milk' }]);
  const [{ id }] = state.queue;

  for (const [index, delay] of [500, 1000, 2000, 4000].entries()) {
    t.mock.timers.tick(delay - 1);
    assert.equal(attempts.length, index + 1);
    assert.equal(sync.syncStatus, 'retrying');
    t.mock.timers.tick(1);
    await sync.flushPromise;
  }
  assert.deepEqual(attempts, Array(5).fill(id));
  assert.equal(sync.syncStatus, 'error');
  await sync.syncItems([{ id: 'bread' }]);
  sync.handleOffline();
  sync.handleOnline();
  await sync.flushPromise;
  t.mock.timers.tick(60000);
  assert.equal(attempts.length, 5);
  assert.equal(state.queue.length, 2);
  assert.equal(sync.syncStatus, 'error');
});

test('a retry that becomes due during sender cleanup still runs when the lock is released', async t => {
  const state = setup(t, ['unavailable']);
  const { sync, attempts } = state;
  const withSender = sync.outbox.withSender.bind(sync.outbox);
  let release;
  const finished = new Promise(resolve => { release = resolve; });
  let drainFinished;
  const waitingForRelease = new Promise(resolve => { drainFinished = resolve; });
  let first = true;
  sync.outbox.withSender = (owner, send) => withSender(owner, async () => {
    const result = await send();
    if (first) {
      first = false;
      drainFinished();
      await finished;
    }
    return result;
  });

  const edit = sync.syncItems([{ id: 'milk' }]);
  await waitingForRelease;
  const [{ id }] = state.queue;
  assert.equal(state.locked, true);
  t.mock.timers.tick(500);
  assert.deepEqual(attempts, [id]);
  release();
  await edit;
  assert.ok(sync.flushPromise, 'the retry should wake after cleanup');
  await sync.flushPromise;
  assert.deepEqual(attempts, [id, id]);
  assert.deepEqual(state.queue, []);
});

test('permission failures leave the outbox intact and schedule no retry', async t => {
  const state = setup(t, ['permission-denied']);
  await state.sync.syncItems([{ id: 'milk' }]);
  assert.equal(state.sync.syncStatus, 'error');
  t.mock.timers.tick(60000);
  assert.equal(await state.sync.flushOfflineQueue(), false);
  assert.equal(state.attempts.length, 1);
  assert.equal(state.queue.length, 1);
});

test('going offline cancels timers and reconnect resumes within the same retry budget', async t => {
  const state = setup(t, ['unavailable', 'aborted']);
  const { sync, attempts } = state;
  await sync.syncItems([{ id: 'milk' }]);
  const [{ id }] = state.queue;
  sync.handleOffline();
  t.mock.timers.tick(60000);
  assert.deepEqual(attempts, [id]);
  assert.equal(sync.syncStatus, 'offline');

  sync.handleOnline();
  await sync.flushPromise;
  assert.deepEqual(attempts, [id, id]);
  assert.equal(sync.syncStatus, 'retrying');
  t.mock.timers.tick(999);
  assert.deepEqual(attempts, [id, id]);
  t.mock.timers.tick(1);
  await sync.flushPromise;
  assert.deepEqual(attempts, [id, id, id]);
  assert.deepEqual(state.queue, []);
});

test('disconnect retires a scheduled retry without discarding the prior account queue', async t => {
  const state = setup(t, ['unavailable']);
  const { sync, attempts } = state;
  await sync.syncItems([{ id: 'milk' }]);
  const [{ id }] = state.queue;
  sync.disconnect();
  sync.session = new AbortController();
  sync.userId = 'replacement';
  sync.enabled = true;
  t.mock.timers.tick(60000);
  assert.equal(await sync.flushOfflineQueue(), true);
  assert.deepEqual(attempts, [id]);
  assert.deepEqual(state.queue.map(group => group.owner), ['shopper']);
});
