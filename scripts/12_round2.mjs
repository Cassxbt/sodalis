// v4.3: settle releases only on outcomes the DAO has recorded. Round 2 shows the
// two cases round 1 could not: the round's budget binding while a seat still has
// allowance, and a rejection released exactly once. Then a member leaves, loses
// the DAO seat, and is refused.
import { actions } from 'near-api-js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, load, call, saveState } from './lib.mjs';

const GUILD = 'sodalis.testnet';
const DAO = 'sodalis-dao.sputnik-v2.testnet';
const NEAR = 10n ** 24n;
const guild = load('guild');
const council = load('council');
const m1 = load('m1');
const m2 = load('m2');
const eve = load('eve');
const read = (contractId, method, args = {}) => guild.provider.callFunction({ contractId, method, args });
const show = (label, r) => console.log(`${label}\n  ${r.tx}\n  ret ${JSON.stringify(r.ret)}${r.failures.length ? `\n  refused ${r.failures[0].slice(0, 160)}` : ''}`);
const refusal = (r, text) => { if (!r.failures.some((f) => f.includes(text))) throw new Error(`expected "${text}", saw ${JSON.stringify(r.failures)}`); };

execFileSync('cargo', ['build', '--release', '--locked', '--target', 'wasm32-unknown-unknown', '--manifest-path', 'contract/Cargo.toml'], {
  stdio: 'inherit',
  env: { ...process.env, RUSTFLAGS: '-C link-arg=-s --cfg near' },
});
const code = readFileSync(join(ROOT, 'contract/target/wasm32-unknown-unknown/release/sodalis.wasm'));
const deployed = await guild.signAndSendTransaction({ receiverId: GUILD, actions: [actions.deployContract(code)], throwOnFailure: true });
console.log(`code upgraded, state kept · ${deployed.transaction.hash}`);
if ((await read(GUILD, 'get_payout_request', { proposal_id: 7 }))?.state !== 'approved') throw new Error('round 1 books did not survive the upgrade');

const round = { budget: String((NEAR * 15n) / 100n), allowance: String(NEAR / 10n) };
const kind = { FunctionCall: { receiver_id: GUILD, actions: [{ method_name: 'open_round', args: Buffer.from(JSON.stringify(round)).toString('base64'), deposit: '0', gas: '30000000000000' }] } };
const filed = await call(council, DAO, 'add_proposal', { proposal: { description: 'Sodalis: open payout round 2 (budget 0.15 NEAR, 0.1 NEAR per seat)', kind } }, { tgas: 100n });
const voted = await call(council, DAO, 'act_proposal', { id: filed.ret, action: 'VoteApprove', proposal: kind }, { tgas: 200n });
const opened = await read(GUILD, 'get_round');
if (opened?.id !== 2 || !opened.open) throw new Error(`round 2 did not open: ${JSON.stringify(opened)}`);
console.log(`round 2 opened by DAO proposal #${filed.ret} · ${filed.tx} · ${voted.tx}`);

const big = await call(m2, GUILD, 'request_payout', { amount: String(NEAR / 10n), category: 'Software' }, { tgas: 60n });
show('m2 asks for its whole 0.1 allowance', big);
if (typeof big.ret !== 'number') throw new Error('request was not filed');

const pot = await call(m1, GUILD, 'request_payout', { amount: String((NEAR * 6n) / 100n), category: 'Equipment' }, { tgas: 60n });
show('m1 asks for 0.06: its allowance allows it, the pot has 0.05 left', pot);
refusal(pot, "exceeds the round's remaining budget");

const transfer = { Transfer: { token_id: '', receiver_id: m2.accountId, amount: String(NEAR / 10n) } };
const rejected = await call(m1, DAO, 'act_proposal', { id: big.ret, action: 'VoteReject', proposal: transfer }, { tgas: 150n });
show(`staff m1 rejects #${big.ret}`, rejected);
const released = await call(eve, GUILD, 'settle', { proposal_id: big.ret }, { tgas: 80n });
show(`anyone settles #${big.ret}`, released);
if (released.ret !== 'released') throw new Error(`settle returned ${released.ret}`);
const again = await call(eve, GUILD, 'settle', { proposal_id: big.ret }, { tgas: 80n });
show(`settling #${big.ret} a second time`, again);
refusal(again, 'this request is already settled');
const books = await read(GUILD, 'get_round');
if (books.committed !== '0') throw new Error(`round 2 still holds ${books.committed}`);

const left = await call(m2, GUILD, 'leave', {}, { tgas: 200n });
show('m2 leaves the guild', left);
const policy = await read(DAO, 'get_policy');
const stillPublic = policy.roles.find((r) => r.name === 'public').kind.Group.includes(m2.accountId);
if (stillPublic || (await read(GUILD, 'get_seat', { account_id: m2.accountId }))) throw new Error('m2 still holds a DAO seat');
const after = await call(m2, GUILD, 'request_payout', { amount: String(NEAR / 20n), category: 'Travel' }, { tgas: 60n });
show('m2 asks again after leaving', after);
refusal(after, 'only seated members may request a payout');

console.log('round 2', books);
saveState({ v43: { upgrade: deployed.transaction.hash, opened: { id: filed.ret, filed: filed.tx, voted: voted.tx }, big: big.tx, bigId: big.ret, pot: pot.tx, rejected: rejected.tx, released: released.tx, again: again.tx, left: left.tx, after: after.tx } });
