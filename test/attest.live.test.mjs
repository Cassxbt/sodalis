// Live: re-verifies every decision the site and README show, from NEAR testnet,
// OutLayer's attestations and Intel's collateral (needs network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyFiled, verifyJoin, verifyLeft, verifyPayout, verifyRefusal, verifyRefusedVote, verifyRejected, verifyRevoked, verifySettle } from '../web/src/attest.js';
import { GUILD, DAO, JOINS, PAYOUT, ROUND, ROUND2, ATTACKS, CASES } from '../web/src/receipts.js';

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
  const [proposed, refused, approved] = PAYOUT.steps;
  assertAll(await verifyRefusedVote(refused.tx, refused.signer));
  const checks = await verifyPayout(DAO, PAYOUT.proposalId, proposed.tx, approved.tx, approved.signer);
  assert.deepEqual(checks.map((c) => c.step), [0, 2, 2]);
  assertAll(checks);
});

test('round: the guild files a request within the allowance, staff approve, the DAO pays, the round records it', async () => {
  const [asked, , , approved, settled] = ROUND.steps;
  const checks = await verifyPayout(DAO, ROUND.proposalId, asked.tx, approved.tx, approved.signer, { member: ROUND.member, guild: GUILD });
  assert.deepEqual(checks.map((c) => c.step), [0, 2, 2]);
  assertAll(checks);
  assertAll(await verifySettle(settled.tx, settled.signer, GUILD, ROUND.proposalId, 'approved'));
});

test('round 2: the pot binds, a rejection is returned once, and leaving ends authority', async () => {
  const [filed, , rejected, released, left] = ROUND2.steps;
  assertAll(await verifyFiled(filed.tx, ROUND2.member, GUILD, DAO, ROUND2.proposalId));
  assertAll(await verifyRejected(rejected.tx, rejected.signer, DAO, ROUND2.proposalId));
  assertAll(await verifySettle(released.tx, released.signer, GUILD, ROUND2.proposalId, 'rejected', 'released'));
  assertAll(await verifyLeft(left.tx, left.signer, GUILD, DAO));
  for (const step of ROUND2.steps.filter((s) => s.kind === 'refused')) {
    const r = await verifyRefusal(step.tx, step.signer, step.expect);
    assert.ok(r.ok, `${step.label}: expected "${step.expect}", saw "${r.text}"`);
  }
});

test('a first-time user joined from their own browser and was paid from round 2', async () => {
  const user = CASES.find((c) => c.id === 'first-user');
  const [join, paid] = user.steps;
  assertAll((await verifyJoin(join.tx, join.signer, GUILD)).checks);
  assertAll(await verifyPayout(DAO, paid.proposalId, paid.ask, paid.approve, paid.approver, { member: user.member, guild: GUILD }));
  assertAll(await verifySettle(paid.settle, paid.settler, GUILD, paid.proposalId, 'approved'));
});

test('a member is paid, refused past its allowance, removed by a DAO vote, and refused after', async () => {
  const c = CASES.find((x) => x.id === 'removed');
  const [, paid, over, revoked, after] = c.steps;
  assertAll(await verifyPayout(DAO, paid.proposalId, paid.ask, paid.approve, paid.approver, { member: c.member, guild: GUILD }));
  assertAll(await verifySettle(paid.settle, paid.settler, GUILD, paid.proposalId, 'approved'));
  assertAll(await verifyRevoked(revoked.tx, revoked.signer, GUILD, DAO, revoked.proposalId, c.member));
  for (const step of [over, after]) {
    const r = await verifyRefusal(step.tx, step.signer, step.expect);
    assert.ok(r.ok, `${step.label}: expected "${step.expect}", saw "${r.text}"`);
  }
});

test('payout: a transaction that did not file the request cannot stand in for it', async () => {
  const [, refused, approved] = PAYOUT.steps;
  const checks = await verifyPayout(DAO, PAYOUT.proposalId, refused.tx, approved.tx, approved.signer);
  assert.equal(checks.find((c) => c.step === 0).ok, false);
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
