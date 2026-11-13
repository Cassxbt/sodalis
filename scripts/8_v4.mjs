// v4: a new DAO whose council key lives in .keys/ (the v3 council key was lost),
// and a guild reset onto fresh storage prefixes (v3 reused v2's, which hid the
// issuer list from enumeration). The verifier and its guild-owned secret are unchanged.
import { readFileSync } from 'node:fs';
import { resolveTxt } from 'node:dns/promises';
import { join } from 'node:path';
import { ROOT, OUTLAYER, admin, load, state, saveState, view, call, executionDeposit, actions } from './lib.mjs';

const NEAR = (n) => BigInt(Math.round(n * 1000)) * 10n ** 21n;
const FACTORY = 'sputnik-v2.testnet';
const DAO_NAME = 'sodalis-dao';
const DAO = `${DAO_NAME}.${FACTORY}`;
const PROFILE = 'sodalis-v3';
const ISSUERS = [
  { domain: 'gmail.com', selector: '20260707', role: 'public' },
  { domain: 'proton.me', selector: 'protonmail2', role: 'public' },
  { domain: 'trendtwin.xyz', selector: 'hostingermail-a', role: 'staff' },
];

const council = admin();
const guild = load('guild');
const { verifier } = state();
const step = async (name, fn) => {
  if (state()[name]) return console.log(`skip ${name}: ${state()[name]}`);
  const tx = await fn();
  saveState({ [name]: tx });
  console.log(`${name}: ${tx}`);
};
const must = (r) => { if (r.failures.length) throw new Error(r.failures.join('; ')); return r.tx; };

for (const m of ['m1', 'm2']) {
  await step(`v4_leave_${m}`, async () => {
    const who = load(m);
    if (!(await view(council, guild.accountId, 'get_member', { account_id: who.accountId }))) return 'not a member';
    return must(await call(who, guild.accountId, 'leave', {}, { tgas: 150n }));
  });
}

await step('v4_dao_tx', async () => {
  const kinds = ['config', 'policy', 'remove_member_from_role', 'call', 'upgrade_self', 'upgrade_remote', 'transfer', 'set_vote_token', 'add_bounty', 'bounty_done', 'vote'];
  const policy = {
    roles: [
      { name: 'council', kind: { Group: [council.accountId] }, vote_policy: {}, permissions: kinds.flatMap((k) => ['AddProposal', 'RemoveProposal', 'VoteApprove', 'VoteReject', 'VoteRemove', 'Finalize'].map((a) => `${k}:${a}`)) },
      { name: 'gatekeeper', kind: { Group: [guild.accountId] }, vote_policy: {}, permissions: ['add_member_to_role:AddProposal', 'add_member_to_role:VoteApprove', 'remove_member_from_role:AddProposal', 'remove_member_from_role:VoteApprove'] },
      { name: 'public', kind: { Group: [] }, vote_policy: {}, permissions: ['transfer:AddProposal', 'vote:AddProposal', 'vote:VoteApprove', 'vote:VoteReject'] },
      { name: 'staff', kind: { Group: [] }, vote_policy: {}, permissions: ['transfer:AddProposal', 'transfer:VoteApprove', 'transfer:VoteReject', 'vote:AddProposal', 'vote:VoteApprove', 'vote:VoteReject'] },
    ],
    default_vote_policy: { weight_kind: 'RoleWeight', quorum: '0', threshold: [1, 2] },
    proposal_bond: '0', proposal_period: '604800000000000', bounty_bond: '100000000000000000000000', bounty_forgiveness_period: '86400000000000',
  };
  const config = { name: DAO_NAME, purpose: 'Sodalis: a treasury run by verified, unlinkable members. Seats are granted only by the guild contract after a TEE-checked email.', metadata: '' };
  const args = Buffer.from(JSON.stringify({ config, policy })).toString('base64');
  const r = await council.signAndSendTransaction({ receiverId: FACTORY, actions: [actions.functionCall('create', { name: DAO_NAME, args }, 300n * 10n ** 12n, NEAR(5))], throwOnFailure: true });
  saveState({ dao: DAO });
  return r.transaction.hash;
});

const init = { owner: council.accountId, outlayer: OUTLAYER, verifier, secrets_owner: guild.accountId, secrets_profile: PROFILE, dao: DAO };
await step('v4_reset_tx', async () => {
  const code = new Uint8Array(readFileSync(join(ROOT, 'contract/target/wasm32-unknown-unknown/release/sodalis.wasm')));
  const r = await guild.signAndSendTransaction({ receiverId: guild.accountId, actions: [actions.deployContract(code), actions.functionCall('reset', init, 30n * 10n ** 12n, 0n)], throwOnFailure: true });
  return r.transaction.hash;
});

for (const { domain, selector, role } of ISSUERS) {
  await step(`v4_pin_${domain}`, async () => {
    const txt = (await resolveTxt(`${selector}._domainkey.${domain}`)).map((p) => p.join('')).join('');
    const keyP = txt.replace(/\s/g, '').match(/p=([A-Za-z0-9+/=]+)/)?.[1];
    if (!keyP) throw new Error(`no DKIM key for ${selector}._domainkey.${domain}`);
    return must(await call(council, guild.accountId, 'set_domain_key', { domain, selector, key_p: keyP, role }, { tgas: 30n }));
  });
}

await step('v4_inbox_tx', async () => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await call(council, guild.accountId, 'init_inbox', {}, { deposit: await executionDeposit(council) });
    if (r.ret?.inbox) return r.tx;
    console.log(`init_inbox attempt ${attempt}: ${JSON.stringify(r.ret)} (${r.tx})`);
  }
  throw new Error('inbox not initialised after 3 attempts');
});

await step('v4_ownership_tx', async () => must(await call(council, guild.accountId, 'transfer_ownership', { new_owner: DAO }, { tgas: 30n })));

const config = await view(council, guild.accountId, 'get_config');
console.log(JSON.stringify({ owner: config.owner, dao: config.dao, secrets_owner: config.secrets_owner, inbox: config.inbox, members: config.member_count }));
console.log('issuers listed:', JSON.stringify((await view(council, guild.accountId, 'get_domain_keys')).map(([id, k]) => `${id}:${k.role}`)));
console.log('DAO roles:', JSON.stringify((await view(council, DAO, 'get_policy')).roles.map((r) => [r.name, r.kind.Group])));
