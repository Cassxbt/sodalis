// Publishes the verifier to FastFS and the guild contract to its own account.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ROOT, OUTLAYER, PROFILE, admin, createSub, saveState, view, actions } from './lib.mjs';

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
console.log('verifier upload tx', up.transaction.hash, '\n', url);

const guild = await createSub(owner, process.env.GUILD_PREFIX ?? 'bg3', Number(process.env.GUILD_NEAR ?? 2.6));
const code = new Uint8Array(readFileSync(join(ROOT, 'contract/target/wasm32-unknown-unknown/release/blind_guild.wasm')));
const dep = await guild.signAndSendTransaction({
  receiverId: guild.accountId,
  actions: [
    actions.deployContract(code),
    actions.functionCall('new', { owner: owner.accountId, outlayer: OUTLAYER, verifier: { url, hash }, secrets_owner: owner.accountId, secrets_profile: PROFILE }, 30n * 10n ** 12n, 0n),
  ],
  throwOnFailure: true,
});
console.log('guild deploy+init tx', dep.transaction.hash);
saveState({ guild: guild.accountId, verifier: { url, hash, upload_tx: up.transaction.hash }, deploy_tx: dep.transaction.hash });
console.log(JSON.stringify(await view(owner, guild.accountId, 'get_config'), null, 1));
