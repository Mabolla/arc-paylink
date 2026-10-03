import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startCheckoutPolling } from '../src/lib/commerce/checkout-polling.ts';
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function clock(t) { t.mock.timers.enable({ apis: ['setTimeout'] }); return async () => { t.mock.timers.tick(15000); await flush(); }; }
test('paid and cancelled responses end all future polling', async t => {
  const tick = clock(t);
  for (const status of ['paid', 'cancelled']) {
    let reads = 0;
    startCheckoutPolling(async () => { reads++; return { status }; }, () => true);
    await tick(); await tick(); await tick();
    assert.equal(reads, 1);
  }
});
test('hidden tab does not read; processing reads stop at the budget', async t => {
  const tick = clock(t); let reads = 0; let visible = false;
  startCheckoutPolling(async () => { reads++; return { status: 'processing' }; }, () => visible);
  await tick(); assert.equal(reads, 0); visible = true;
  for (let i = 0; i < 25; i++) await tick();
  assert.equal(reads, 20);
});
test('quota or transport error stops automatic retries', async t => {
  const tick = clock(t); let reads = 0;
  startCheckoutPolling(async () => { reads++; throw Error('unavailable'); }, () => true);
  await tick(); await tick(); assert.equal(reads, 1);
});
test('slow request never overlaps and unmount prevents scheduling another', async t => {
  const tick = clock(t); let reads = 0; let resolve;
  const stop = startCheckoutPolling(() => { reads++; return new Promise(r => { resolve = r; }); }, () => true);
  await tick(); await tick(); assert.equal(reads, 1);
  stop(); resolve({ status: 'processing' }); await flush(); await tick();
  assert.equal(reads, 1);
});
test('unmount before first tick makes zero requests', async t => {
  const tick = clock(t); let reads = 0;
  const stop = startCheckoutPolling(async () => { reads++; return { status: 'processing' }; }, () => true);
  stop(); await tick(); assert.equal(reads, 0);
});
