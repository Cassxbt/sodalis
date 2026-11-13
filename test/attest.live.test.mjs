// Live: re-verifies every decision the site and README show, from NEAR testnet,
// OutLayer's attestations and Intel's collateral (needs network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyJoin, verifyPayout, verifyRefusal, verifyRefusedVote } from '../web/src/attest.js';
import { GUILD, DAO, JOINS, PAYOUT, ATTACKS } from '../web/src/receipts.js';

const assertAll = (checks) => { for (const c of checks) assert.ok(c.ok, `${c.group}: ${c.name}: ${c.detail}`); };

for (const join of JOINS) {
  test(`admission: ${join.title}`, async () => {
    const { checks, outcome } = await verifyJoin(join.tx, join.signer, GUILD);
    assertAll(checks);
    assert.equal(outcome.joined, true);
    assert.deepEqual([...new Set(checks.map((c) => c.group))], ['execution', 'admission', 'seat']);
  });
}

test('payout: a public member cannot approve their own request; staff can, and exactly 0.05 NEAR moves', async () => {
  const [, refused, approved] = PAYOUT.steps;
  assertAll(await verifyRefusedVote(refused.tx, refused.signer));
  assertAll(await verifyPayout(DAO, PAYOUT.proposalId, approved.tx, approved.signer));
});

for (const attack of ATTACKS) {
  test(`attack refused on chain: ${attack.name}`, async () => {
    const r = await verifyRefusal(attack.tx, attack.signer, attack.expect);
    assert.ok(r.ok, `${attack.id}: expected "${attack.expect}", saw "${r.text}"`);
  });
}

test('a forged enclave output breaks the chain of checks', async () => {
  const join = JOINS[0];
  const { checks } = await verifyJoin(join.tx, join.signer, GUILD, undefined, { tamper: true });
  assert.ok(!checks.find((c) => c.name.includes('output the TEE produced')).ok);
});
