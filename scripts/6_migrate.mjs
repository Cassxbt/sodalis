// Moves the live guild to v2 in place: new verifier and secret, reset state,
// tiered issuer keys read from live DNS, DAO roles `public` and `staff`.
// Each step records its tx in .keys/state.json and is skipped on a re-run.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { join } from 'node:path';
import { ROOT, OUTLAYER, OUTLAYER_API, PROFILE, admin, load, state, saveState, view, call, executionDeposit, actions } from './lib.mjs';

const TGAS = (n) => BigInt(n) * 10n ** 12n;
const ISSUERS = [
  { domain: 'gmail.com', selector: '20260707', role: 'public' },
  { domain: 'proton.me', selector: 'protonmail2', role: 'public' },
  { domain: 'trendtwin.xyz', selector: 'hostingermail-a', role: 'staff' },
];

const owner = admin();
const guild = load('guild');
const { dao } = state();
const step = async (name, fn) => {
  if (state()[name]) return console.log(`skip ${name}: ${state()[name]}`);
  const tx = await fn();
  saveState({ [name]: tx });
  console.log(`${name}: ${tx}`);
};

const wasm = new Uint8Array(readFileSync(join(ROOT, 'verifier/target/wasm32-wasip1/release/guild-verifier-v2.wasm')));
const hash = createHash('sha256').update(wasm).digest('hex');
const url = `https://test.fastfs.io/${owner.accountId}/${OUTLAYER}/${hash}.wasm`;
console.log('verifier', hash);

await step('v2_upload_tx', async () => {
  const enc = new TextEncoder();
  const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
  const cat = (ps) => { const o = new Uint8Array(ps.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of ps) { o.set(p, i); i += p.length; } return o; };
  const bytes = (b) => cat([u32(b.length), b]);
  const payload = cat([Uint8Array.of(0), bytes(enc.encode(`${hash}.wasm`)), Uint8Array.of(1), bytes(enc.encode('application/wasm')), bytes(wasm)]);
  // FastFS reads the call arguments; the call itself is meant to fail on gas.
  const r = await owner.signAndSendTransaction({ receiverId: OUTLAYER, actions: [actions.functionCall('__fastdata_fastfs', payload, 1n, 0n)], throwOnFailure: false });
  for (let i = 0; i < 20; i++) {
    const got = await fetch(url).then((x) => (x.ok ? x.arrayBuffer() : null)).catch(() => null);
    if (got && createHash('sha256').update(Buffer.from(got)).digest('hex') === hash) return r.transaction.hash;
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error('FastFS does not serve the uploaded verifier yet');
});

await step('v2_secret_tx', async () => {
  const res = await fetch(`${OUTLAYER_API}/secrets/add_generated_secret`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessor: { type: 'WasmHash', hash }, owner: owner.accountId, profile: PROFILE, encrypted_secrets_base64: null, new_secrets: [{ name: 'PROTECTED_GUILD_MASTER', generation_type: 'hex32' }] }),
  });
  if (!res.ok) throw new Error(`add_generated_secret ${res.status}: ${await res.text()}`);
  const gen = await res.json();
  const args = { accessor: { WasmHash: { hash } }, profile: PROFILE, encrypted_secrets_base64: gen.encrypted_data_base64, access: { Predecessor: { condition: { Whitelist: { accounts: [guild.accountId] } } } }, vault_id: null };
  const deposit = BigInt(await view(owner, OUTLAYER, 'estimate_storage_cost', { ...args, owner: owner.accountId }));
  const r = await owner.signAndSendTransaction({ receiverId: OUTLAYER, actions: [actions.functionCall('store_secrets', args, TGAS(50), deposit)], throwOnFailure: true });
  return r.transaction.hash;
});

const init = { owner: owner.accountId, outlayer: OUTLAYER, verifier: { url, hash }, secrets_owner: owner.accountId, secrets_profile: PROFILE, dao };
await step('v2_deploy_tx', async () => {
  const code = new Uint8Array(readFileSync(join(ROOT, 'contract/target/wasm32-unknown-unknown/release/sodalis.wasm')));
  const r = await guild.signAndSendTransaction({ receiverId: guild.accountId, actions: [actions.deployContract(code), actions.functionCall('reset', init, TGAS(30), 0n)], throwOnFailure: true });
  saveState({ verifier: { url, hash } });
  return r.transaction.hash;
});

await step('v2_reset_refused_tx', async () => {
  const r = await call(owner, guild.accountId, 'reset', init, { tgas: 30n });
  if (!r.failures.some((f) => f.includes('is private'))) throw new Error(`reset by an outsider was not refused: ${JSON.stringify(r.failures)}`);
  return r.tx;
});

await step('v2_dao_policy_tx', async () => {
  const policy = await view(owner, dao, 'get_policy');
  const roles = policy.roles.filter((r) => !['members', 'public', 'staff'].includes(r.name));
  roles.push(
    { name: 'public', kind: { Group: [] }, vote_policy: {}, permissions: ['transfer:AddProposal', 'vote:AddProposal', 'vote:VoteApprove', 'vote:VoteReject'] },
    { name: 'staff', kind: { Group: [] }, vote_policy: {}, permissions: ['transfer:AddProposal', 'transfer:VoteApprove', 'transfer:VoteReject', 'vote:AddProposal', 'vote:VoteApprove', 'vote:VoteReject'] },
  );
  const kind = { ChangePolicy: { policy: { ...policy, roles } } };
  const p = await call(owner, dao, 'add_proposal', { proposal: { description: 'Sodalis v2: tier roles public (propose) and staff (approve payouts); retire members', kind } }, { tgas: 50n });
  if (p.failures.length) throw new Error(p.failures.join('; '));
  const v = await call(owner, dao, 'act_proposal', { id: p.ret, action: 'VoteApprove', proposal: kind }, { tgas: 150n });
  if (v.failures.length) throw new Error(v.failures.join('; '));
  const status = (await view(owner, dao, 'get_proposal', { id: p.ret })).status;
  if (status !== 'Approved') throw new Error(`policy proposal ${p.ret} is ${status}`);
  return v.tx;
});

for (const { domain, selector, role } of ISSUERS) {
  await step(`v2_pin_${domain}`, async () => {
    // Sputnik approves AddMemberToRole for an unknown role as a no-op, so check first.
    const daoRoles = (await view(owner, dao, 'get_policy')).roles.filter((r) => r.kind?.Group).map((r) => r.name);
    if (!daoRoles.includes(role)) throw new Error(`DAO has no group role "${role}"`);
    const txt = (await resolveTxt(`${selector}._domainkey.${domain}`)).map((parts) => parts.join('')).join('');
    const keyP = txt.replace(/\s/g, '').match(/p=([A-Za-z0-9+/=]+)/)?.[1];
    if (!keyP) throw new Error(`no DKIM key published for ${selector}._domainkey.${domain}`);
    const r = await call(owner, guild.accountId, 'set_domain_key', { domain, selector, key_p: keyP, role }, { tgas: 30n });
    if (r.failures.length) throw new Error(r.failures.join('; '));
    return r.tx;
  });
}

await step('v2_inbox_tx', async () => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await call(owner, guild.accountId, 'init_inbox', {}, { deposit: await executionDeposit(owner) });
    if (r.ret?.inbox) return r.tx;
    console.log(`init_inbox attempt ${attempt} returned ${JSON.stringify(r.ret)} (${r.tx})`);
  }
  throw new Error('inbox not initialised after 3 attempts');
});

await step('v2_ownership_tx', async () => {
  const r = await call(owner, guild.accountId, 'transfer_ownership', { new_owner: dao }, { tgas: 30n });
  if (r.failures.length) throw new Error(r.failures.join('; '));
  return r.tx;
});

const config = await view(owner, guild.accountId, 'get_config');
console.log(JSON.stringify({ owner: config.owner, verifier: config.verifier.hash, inbox: config.inbox, sealed: config.issuers_sealed, keys: (await view(owner, guild.accountId, 'get_domain_keys')).map(([id, k]) => `${id}:${k.role}`) }, null, 1));
console.log('DAO roles:', JSON.stringify((await view(owner, dao, 'get_policy')).roles.map((r) => [r.name, r.kind])));
