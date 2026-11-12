// Makes the guild account the owner of its own TEE secret. OutLayer lets a
// secret's owner replace it, and a new master would mint new nullifiers for old
// mailboxes, so an outside owner could readmit an email. Once the guild's keys
// are deleted, nobody can replace a secret the guild owns.
import { readFileSync } from 'node:fs';
import { resolveTxt } from 'node:dns/promises';
import { join } from 'node:path';
import { ROOT, OUTLAYER, OUTLAYER_API, admin, load, state, saveState, view, call, executionDeposit, actions } from './lib.mjs';

const PROFILE = 'sodalis-v3';
const TGAS = (n) => BigInt(n) * 10n ** 12n;
const ISSUERS = [
  { domain: 'gmail.com', selector: '20260707', role: 'public' },
  { domain: 'proton.me', selector: 'protonmail2', role: 'public' },
  { domain: 'trendtwin.xyz', selector: 'hostingermail-a', role: 'staff' },
];

const owner = admin();
const guild = load('guild');
const { dao, verifier } = state();
const step = async (name, fn) => {
  if (state()[name]) return console.log(`skip ${name}: ${state()[name]}`);
  const tx = await fn();
  saveState({ [name]: tx });
  console.log(`${name}: ${tx}`);
};
const must = (r) => { if (r.failures.length) throw new Error(r.failures.join('; ')); return r.tx; };

for (const m of ['m1', 'm2']) {
  await step(`v3_leave_${m}`, async () => {
    const who = load(m);
    if (!(await view(owner, guild.accountId, 'get_member', { account_id: who.accountId }))) return 'not a member';
    return must(await call(who, guild.accountId, 'leave', {}, { tgas: 150n }));
  });
}

await step('v3_secret_tx', async () => {
  const res = await fetch(`${OUTLAYER_API}/secrets/add_generated_secret`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessor: { type: 'WasmHash', hash: verifier.hash }, owner: guild.accountId, profile: PROFILE, encrypted_secrets_base64: null, new_secrets: [{ name: 'PROTECTED_GUILD_MASTER', generation_type: 'hex32' }] }),
  });
  if (!res.ok) throw new Error(`add_generated_secret ${res.status}: ${await res.text()}`);
  const gen = await res.json();
  const args = { accessor: { WasmHash: { hash: verifier.hash } }, profile: PROFILE, encrypted_secrets_base64: gen.encrypted_data_base64, access: { Predecessor: { condition: { Whitelist: { accounts: [guild.accountId] } } } }, vault_id: null };
  const deposit = BigInt(await view(owner, OUTLAYER, 'estimate_storage_cost', { ...args, owner: guild.accountId }));
  const r = await guild.signAndSendTransaction({ receiverId: OUTLAYER, actions: [actions.functionCall('store_secrets', args, TGAS(50), deposit)], throwOnFailure: true });
  return r.transaction.hash;
});

const init = { owner: owner.accountId, outlayer: OUTLAYER, verifier, secrets_owner: guild.accountId, secrets_profile: PROFILE, dao };
await step('v3_reset_tx', async () => {
  const code = new Uint8Array(readFileSync(join(ROOT, 'contract/target/wasm32-unknown-unknown/release/sodalis.wasm')));
  const r = await guild.signAndSendTransaction({ receiverId: guild.accountId, actions: [actions.deployContract(code), actions.functionCall('reset', init, TGAS(30), 0n)], throwOnFailure: true });
  return r.transaction.hash;
});

for (const { domain, selector, role } of ISSUERS) {
  await step(`v3_pin_${domain}`, async () => {
    const txt = (await resolveTxt(`${selector}._domainkey.${domain}`)).map((p) => p.join('')).join('');
    const keyP = txt.replace(/\s/g, '').match(/p=([A-Za-z0-9+/=]+)/)?.[1];
    if (!keyP) throw new Error(`no DKIM key for ${selector}._domainkey.${domain}`);
    return must(await call(owner, guild.accountId, 'set_domain_key', { domain, selector, key_p: keyP, role }, { tgas: 30n }));
  });
}

await step('v3_inbox_tx', async () => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await call(owner, guild.accountId, 'init_inbox', {}, { deposit: await executionDeposit(owner) });
    if (r.ret?.inbox) return r.tx;
    console.log(`init_inbox attempt ${attempt}: ${JSON.stringify(r.ret)} (${r.tx})`);
  }
  throw new Error('inbox not initialised after 3 attempts');
});

await step('v3_ownership_tx', async () => must(await call(owner, guild.accountId, 'transfer_ownership', { new_owner: dao }, { tgas: 30n })));

const config = await view(owner, guild.accountId, 'get_config');
console.log(JSON.stringify({ owner: config.owner, secrets_owner: config.secrets_owner, profile: config.secrets_profile, inbox: config.inbox, members: config.member_count }));
console.log('DAO tiers:', JSON.stringify((await view(owner, dao, 'get_policy')).roles.filter((r) => ['public', 'staff'].includes(r.name)).map((r) => [r.name, r.kind.Group])));
