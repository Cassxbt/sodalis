// Live: re-verifies every recorded Sodalis decision on NEAR testnet (needs network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync } from '@phala/dcap-qvl-web';
import { verifyJoin, verifyPayout, verifyRefusedVote } from '../web/src/attest.js';

const require = createRequire(import.meta.url);
initSync({ module: readFileSync(require.resolve('@phala/dcap-qvl-web/dcap-qvl-web_bg.wasm')) });
const GUILD = 'sodalis.testnet';
const DAO = 'sodalis.sputnik-v2.testnet';
const assertAll = (checks) => { for (const c of checks) assert.ok(c.ok, `${c.group}: ${c.name}: ${c.detail}`); };

for (const [name, tx, signer, role] of [
  ['v1 join, real Proton email (verifier since upgraded)', '4UtpbLqmxWyn8h3hVJDA5JmUxCSaEJ8E3BN7QAJPE13e', 'm2.kibble-pf-03c8a9.testnet', 'members'],
  ['v2 public join, real Proton email', '4H9kBLGsHU7vdcmcRnXZZ8FJJxy1Ju1MY5BGE8pJRwUG', 'm2.kibble-pf-03c8a9.testnet', 'public'],
  ['v2 staff join, real trendtwin.xyz email', 'CEz4RhEu4AbDzpJ2teg7b9p9pMdvUJUbyxQV1YtzBWu4', 'm1.kibble-pf-03c8a9.testnet', 'staff'],
]) {
  test(name, async () => {
    const { checks, outcome } = await verifyJoin(tx, signer, GUILD);
    assertAll(checks);
    assert.equal(outcome.joined, true);
    assert.deepEqual([...new Set(checks.map((c) => c.group))], ['execution', 'admission', 'seat']);
    assert.ok(checks.some((c) => c.group === 'seat' && c.detail.endsWith(role)), `seated as ${role}`);
  });
}

test('a public member cannot approve their own payout; staff can, and exactly 0.05 NEAR moves', async () => {
  assertAll(await verifyRefusedVote('7gn39aaYTFSUHMyYN9R3H6LFrJmUHftPdY1rr7xu5H7h', 'm2.kibble-pf-03c8a9.testnet'));
  assertAll(await verifyPayout(DAO, 7, 'EX4gMjGkXKiufBnuXEKKEasDAELedhb1CXgs96Rjef4Q', 'm1.kibble-pf-03c8a9.testnet'));
});

import { verifyRefusal } from '../web/src/attest.js';
import { ATTACKS } from '../web/src/receipts.js';

for (const attack of ATTACKS) {
  test(`attack refused on chain: ${attack.name}`, async () => {
    const r = await verifyRefusal(attack.tx, attack.signer, attack.expect);
    assert.ok(r.ok, `${attack.id}: expected "${attack.expect}", saw "${r.text}"`);
  });
}

test('a forged TEE output breaks the chain of checks', async () => {
  const { checks } = await verifyJoin('85pPVVqYoymT4GJSiqi1Rzne81EihdWschTPtueyrTmJ', 'm2.kibble-pf-03c8a9.testnet', GUILD, undefined, { tamper: true });
  assert.ok(checks.some((c) => !c.ok), 'tampering must fail at least one check');
  assert.ok(!checks.find((c) => c.name.includes('output the TEE produced')).ok);
});
