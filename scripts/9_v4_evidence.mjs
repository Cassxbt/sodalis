// Produces the v4 evidence: m2 joins as public, a public payout request is
// refused for its proposer and approved by staff, and seven attacks by an
// outside account are refused. Each tx is saved to .keys/state.json.
import { readFileSync } from 'node:fs';
import { OUTLAYER, admin, load, state, saveState, view, call, executionDeposit } from './lib.mjs';
import { seal } from './seal.mjs';

const council = admin();
const [m1, m2, eve, guild] = ['m1', 'm2', 'eve', 'guild'].map(load);
const { dao, verifier } = state();
const G = guild.accountId;
const step = async (name, fn, settled = () => true) => {
  if (state()[name]) return console.log(`skip ${name}: ${state()[name]}`);
  let out;
  for (let attempt = 1; attempt <= 4; attempt++) {
    out = await fn();
    if (settled(out)) break;
    console.log(`${name} attempt ${attempt}: OutLayer gave no answer (${out.tx}); retrying`);
  }
  if (!settled(out)) throw new Error(`${name}: OutLayer never answered`);
  saveState({ [name]: out.tx });
  console.log(`${name}: ${out.tx} | ${out.note}`);
};
const letter = (name) => JSON.parse(readFileSync(`.keys/real/letter_${name}_v4.json`, 'utf8'));
const deposit = async (who) => (await executionDeposit(who)) + 5n * 10n ** 21n;
const sealedFor = async (l) => seal((await view(council, G, 'get_config')).inbox, { eml: l.eml, salt: l.salt });
const failure = (r) => r.failures.join(' ').match(/"([^"]{8,160})"/)?.[1] ?? r.failures.join(' ').slice(0, 160);

const m2Letter = letter('m2');
const m2Sealed = await sealedFor(m2Letter);
await step('v4_join_m2', async () => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await call(m2, G, 'join', { domain: m2Letter.domain, selector: m2Letter.selector, sealed: m2Sealed }, { deposit: await deposit(m2) });
    if (r.ret?.joined) return { tx: r.tx, note: JSON.stringify(r.ret) };
    console.log(`m2 join attempt ${attempt}: ${JSON.stringify(r.ret)} (${r.tx})`);
  }
  throw new Error('m2 could not join after 3 attempts');
});

const kind = { Transfer: { token_id: '', receiver_id: m2.accountId, amount: '50000000000000000000000' } };
await step('v4_payout_propose', async () => {
  const r = await call(m2, dao, 'add_proposal', { proposal: { description: 'Public member request: 0.05 NEAR to reimburse onboarding-guide translation', kind } }, { tgas: 50n });
  if (typeof r.ret !== 'number') throw new Error(`proposal not created: ${failure(r)}`);
  saveState({ v4_payout_id: r.ret });
  return { tx: r.tx, note: `proposal #${r.ret}` };
});
const id = state().v4_payout_id;
await step('v4_payout_self', async () => {
  const r = await call(m2, dao, 'act_proposal', { id, action: 'VoteApprove', proposal: kind }, { tgas: 100n });
  return { tx: r.tx, note: failure(r) };
});
await step('v4_payout_staff', async () => {
  const r = await call(m1, dao, 'act_proposal', { id, action: 'VoteApprove', proposal: kind }, { tgas: 100n });
  return { tx: r.tx, note: `status ${(await view(council, dao, 'get_proposal', { id })).status}` };
});

const eveLetter = letter('eve');
await step('v4_attack_sybil', async () => {
  const r = await call(eve, G, 'join', { domain: eveLetter.domain, selector: eveLetter.selector, sealed: await sealedFor(eveLetter) }, { deposit: await deposit(eve) });
  return { tx: r.tx, note: JSON.stringify(r.ret) };
}, (o) => !o.note.includes('no output'));
await step('v4_attack_replay', async () => {
  const r = await call(eve, G, 'join', { domain: m2Letter.domain, selector: m2Letter.selector, sealed: m2Sealed }, { deposit: await deposit(eve) });
  return { tx: r.tx, note: JSON.stringify(r.ret) };
}, (o) => !o.note.includes('no output'));
await step('v4_attack_domain', async () => {
  const r = await call(eve, G, 'join', { domain: 'example.com', selector: 's1', sealed: m2Sealed }, { deposit: await deposit(eve), tgas: 50n });
  return { tx: r.tx, note: failure(r) };
});
await step('v4_attack_direct', async () => {
  const args = { source: { WasmUrl: { url: verifier.url, hash: verifier.hash, build_target: 'wasm32-wasip1' } }, resource_limits: { max_instructions: 2000000000, max_memory_mb: 64, max_execution_seconds: 20 }, input_data: JSON.stringify({ action: 'inbox', guild: G }), secrets_ref: { profile: 'sodalis-v3', account_id: G }, response_format: 'Json', payer_account_id: eve.accountId };
  const r = await call(eve, OUTLAYER, 'request_execution', args, { deposit: await executionDeposit(eve) });
  const done = r.logs.find((l) => l.includes('execution_completed'));
  return { tx: r.tx, note: done ? JSON.parse(done.slice(11)).data[0].error_message : 'no output' };
}, (o) => !o.note.includes('no output'));
await step('v4_attack_reset', async () => {
  const r = await call(eve, G, 'reset', { owner: eve.accountId, outlayer: OUTLAYER, verifier, secrets_owner: eve.accountId, secrets_profile: 'x', dao }, { tgas: 30n });
  return { tx: r.tx, note: failure(r) };
});
await step('v4_attack_owner', async () => {
  const r = await call(council, G, 'set_domain_key', { domain: 'evil.example', selector: 's1', key_p: 'MIIB', role: 'staff' }, { tgas: 30n });
  return { tx: r.tx, note: failure(r) };
});
console.log('DAO tiers:', JSON.stringify((await view(council, dao, 'get_policy')).roles.filter((r) => ['public', 'staff'].includes(r.name)).map((r) => [r.name, r.kind.Group])));
