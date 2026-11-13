// v4.2: payout rounds. Deploys the new guild code (no reset, state kept), then
// the council passes two DAO proposals: only the guild may file transfers, and
// round 1 opens with its budget and per-seat allowance.
import { actions } from 'near-api-js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, load, call, saveState } from './lib.mjs';

const GUILD = 'sodalis.testnet';
const DAO = 'sodalis-dao.sputnik-v2.testnet';
const NEAR = 10n ** 24n;
const ROUND = { budget: String(NEAR / 2n), allowance: String(NEAR / 10n) };

const guild = load('guild');
const council = load('council');
const m1 = load('m1');
const read = (contractId, method, args = {}) => guild.provider.callFunction({ contractId, method, args });

async function pass(kind, description, { before } = {}) {
  const filed = await call(council, DAO, 'add_proposal', { proposal: { description, kind } }, { tgas: 100n });
  if (typeof filed.ret !== 'number') throw new Error(`add_proposal failed: ${JSON.stringify(filed.failures)}`);
  await before?.();
  const voted = await call(council, DAO, 'act_proposal', { id: filed.ret, action: 'VoteApprove', proposal: kind }, { tgas: 200n });
  const { status } = await guild.provider.callFunction({ contractId: DAO, method: 'get_proposal', args: { id: filed.ret } });
  if (status !== 'Approved' || voted.failures.length) throw new Error(`proposal #${filed.ret} is ${status}: ${JSON.stringify(voted.failures)}`);
  console.log(`${description}: proposal #${filed.ret} approved · ${filed.tx} · ${voted.tx}`);
  return { id: filed.ret, filed: filed.tx, voted: voted.tx };
}

execFileSync('cargo', ['build', '--release', '--locked', '--target', 'wasm32-unknown-unknown', '--manifest-path', 'contract/Cargo.toml'], {
  stdio: 'inherit',
  env: { ...process.env, RUSTFLAGS: '-C link-arg=-s --cfg near' },
});
const code = readFileSync(join(ROOT, 'contract/target/wasm32-unknown-unknown/release/sodalis.wasm'));
// Storage is staked at 10^19 yocto per byte, and the larger build needs more than the guild has free.
const acct = await guild.provider.query({ request_type: 'view_account', account_id: GUILD, finality: 'final' });
if (BigInt(acct.amount) - BigInt(acct.storage_usage) * 10n ** 19n < NEAR) {
  const topUp = await council.signAndSendTransaction({ receiverId: GUILD, actions: [actions.transfer(NEAR)], throwOnFailure: true });
  console.log(`council tops the guild up with 1 test NEAR for code storage · ${topUp.transaction.hash}`);
}
const deployed = await guild.signAndSendTransaction({ receiverId: GUILD, actions: [actions.deployContract(code)], throwOnFailure: true });
console.log(`code upgraded, state kept · ${deployed.transaction.hash}`);
const config = await guild.provider.callFunction({ contractId: GUILD, method: 'get_config', args: {} });
if (config.member_count !== 3) throw new Error(`state check failed: ${JSON.stringify(config)}`);

// Transfers filed before rounds would stay payable outside any round.
const last = await read(DAO, 'get_last_proposal_id');
const open = (await read(DAO, 'get_proposals', { from_index: 0, limit: last })).filter((p) => p.kind?.Transfer && p.status === 'InProgress');
for (const p of open) {
  const r = await call(m1, DAO, 'act_proposal', { id: p.id, action: 'VoteReject', proposal: p.kind }, { tgas: 100n });
  console.log(`staff rejects #${p.id}, filed before payout rounds existed · ${r.tx}`);
}

const policy = await read(DAO, 'get_policy');
const names = policy.roles.map((r) => r.name);
for (const name of ['council', 'gatekeeper', 'public', 'staff']) if (!names.includes(name)) throw new Error(`role ${name} is missing`);
const snapshot = JSON.stringify(policy);
for (const role of policy.roles) {
  const perms = new Set(role.permissions);
  if (role.name === 'public' || role.name === 'staff') perms.delete('transfer:AddProposal');
  if (role.name === 'gatekeeper') perms.add('transfer:AddProposal');
  role.permissions = [...perms];
}
// ChangePolicy replaces the whole policy, member lists included: a seat granted
// since the snapshot would be dropped, so stop if anything moved.
const policyChange = await pass({ ChangePolicy: { policy } }, 'Sodalis: only the guild files transfers, inside a payout round', {
  before: async () => { if (JSON.stringify(await read(DAO, 'get_policy')) !== snapshot) throw new Error('the policy changed since the snapshot; rerun'); },
});

const openArgs = Buffer.from(JSON.stringify(ROUND)).toString('base64');
const opened = await pass(
  { FunctionCall: { receiver_id: GUILD, actions: [{ method_name: 'open_round', args: openArgs, deposit: '0', gas: '30000000000000' }] } },
  'Sodalis: open payout round 1 (budget 0.5 NEAR, 0.1 NEAR per seat)',
);
const round = await read(GUILD, 'get_round');
if (!round?.open) throw new Error('the DAO approved the proposal but no round is open');
console.log('round', round);
saveState({ v42: { upgrade: deployed.transaction.hash, policyChange, opened, round } });
