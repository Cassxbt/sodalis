// Creates the Sodalis guild (a top-level testnet account) and its Sputnik DAO,
// uploads the verifier to FastFS, and initialises the guild against both.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { KeyPair } from 'near-api-js';
import { ROOT, OUTLAYER, PROFILE, admin, load, saveState, view, actions } from './lib.mjs';

const GUILD = process.env.GUILD ?? 'sodalis.testnet';
const DAO_NAME = process.env.DAO_NAME ?? 'sodalis';
const FACTORY = 'sputnik-v2.testnet';
const DAO = `${DAO_NAME}.${FACTORY}`;
const ROLE = 'members';
const NEAR = (n) => BigInt(Math.round(n * 1000)) * 10n ** 21n;
const TGAS = (n) => BigInt(n) * 10n ** 12n;

const owner = admin();

const wasm = new Uint8Array(readFileSync(join(ROOT, 'verifier/target/wasm32-wasip1/release/guild-verifier-v2.wasm')));
const hash = createHash('sha256').update(wasm).digest('hex');
const path = `${hash}.wasm`;
const enc = new TextEncoder();
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const cat = (ps) => { const o = new Uint8Array(ps.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of ps) { o.set(p, i); i += p.length; } return o; };
const bytes = (b) => cat([u32(b.length), b]);
const payload = cat([Uint8Array.of(0), bytes(enc.encode(path)), Uint8Array.of(1), bytes(enc.encode('application/wasm')), bytes(wasm)]);
const up = await owner.signAndSendTransaction({ receiverId: OUTLAYER, actions: [actions.functionCall('__fastdata_fastfs', payload, 1n, 0n)], throwOnFailure: false });
const url = `https://test.fastfs.io/${owner.accountId}/${OUTLAYER}/${path}`;
console.log('verifier', hash, 'upload tx', up.transaction.hash);

const guildKeyFile = join(ROOT, '.keys', 'guild.json');
if (!existsSync(guildKeyFile)) {
  const kp = KeyPair.fromRandom('ed25519');
  const r = await owner.signAndSendTransaction({
    receiverId: 'testnet',
    actions: [actions.functionCall('create_account', { new_account_id: GUILD, new_public_key: kp.getPublicKey().toString() }, TGAS(100), NEAR(Number(process.env.GUILD_NEAR ?? 2.75)))],
    throwOnFailure: true,
  });
  writeFileSync(guildKeyFile, JSON.stringify({ accountId: GUILD, privateKey: kp.toString() }));
  console.log('created', GUILD, 'tx', r.transaction.hash);
  saveState({ guild_create_tx: r.transaction.hash });
}
const guild = load('guild');
if (guild.accountId !== GUILD) throw new Error(`.keys/guild.json holds ${guild.accountId}, expected ${GUILD}`);

const council = { name: 'council', kind: { Group: [owner.accountId] }, vote_policy: {},
  permissions: ['config', 'policy', 'remove_member_from_role', 'call', 'upgrade_self', 'upgrade_remote', 'transfer', 'set_vote_token', 'add_bounty', 'bounty_done', 'vote']
    .flatMap((k) => ['AddProposal', 'RemoveProposal', 'VoteApprove', 'VoteReject', 'VoteRemove', 'Finalize'].map((a) => `${k}:${a}`)) };
const gatekeeper = { name: 'gatekeeper', kind: { Group: [GUILD] }, vote_policy: {},
  permissions: ['add_member_to_role:AddProposal', 'add_member_to_role:VoteApprove', 'remove_member_from_role:AddProposal', 'remove_member_from_role:VoteApprove'] };
const members = { name: ROLE, kind: { Group: [] }, vote_policy: {},
  permissions: ['transfer:AddProposal', 'vote:AddProposal', 'vote:VoteApprove', 'vote:VoteReject'] };
const policy = {
  roles: [council, gatekeeper, members],
  default_vote_policy: { weight_kind: 'RoleWeight', quorum: '0', threshold: [1, 2] },
  proposal_bond: '0',
  proposal_period: '604800000000000',
  bounty_bond: '100000000000000000000000',
  bounty_forgiveness_period: '86400000000000',
};
const config = { name: DAO_NAME, purpose: 'Sodalis: a treasury run by verified, unlinkable members. Seats are granted only by the guild contract after a TEE-checked work email.', metadata: '' };

let daoExists = true;
try { await view(owner, DAO, 'get_policy'); } catch { daoExists = false; }
if (!daoExists) {
  const args = Buffer.from(JSON.stringify({ config, policy })).toString('base64');
  const r = await owner.signAndSendTransaction({
    receiverId: FACTORY,
    actions: [actions.functionCall('create', { name: DAO_NAME, args }, TGAS(300), NEAR(Number(process.env.DAO_NEAR ?? 5)))],
    throwOnFailure: true,
  });
  console.log('created DAO', DAO, 'tx', r.transaction.hash);
  saveState({ dao_create_tx: r.transaction.hash });
}

const code = new Uint8Array(readFileSync(join(ROOT, 'contract/target/wasm32-unknown-unknown/release/sodalis.wasm')));
const dep = await guild.signAndSendTransaction({
  receiverId: GUILD,
  actions: [
    actions.deployContract(code),
    actions.functionCall('new', { owner: owner.accountId, outlayer: OUTLAYER, verifier: { url, hash }, secrets_owner: owner.accountId, secrets_profile: PROFILE, dao: DAO, dao_role: ROLE }, TGAS(30), 0n),
  ],
  throwOnFailure: true,
});
console.log('guild deploy+init tx', dep.transaction.hash);
saveState({ guild: GUILD, dao: DAO, verifier: { url, hash, upload_tx: up.transaction.hash }, deploy_tx: dep.transaction.hash });
await new Promise((r) => setTimeout(r, 3000));
console.log(JSON.stringify(await view(owner, GUILD, 'get_config'), null, 1));
console.log(JSON.stringify((await view(owner, DAO, 'get_policy')).roles.map((r) => [r.name, r.kind])));
