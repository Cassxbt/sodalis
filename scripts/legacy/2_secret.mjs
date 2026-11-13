// Has the OutLayer keystore generate the guild master (nobody sees it) and
// stores it so only runs of the pinned build requested by the guild contract get it.
import { OUTLAYER, OUTLAYER_API, PROFILE, admin, state, saveState, view, actions } from './lib.mjs';

const owner = admin();
const { guild, verifier } = state();
const res = await fetch(`${OUTLAYER_API}/secrets/add_generated_secret`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    accessor: { type: 'WasmHash', hash: verifier.hash }, owner: owner.accountId, profile: PROFILE,
    encrypted_secrets_base64: null, new_secrets: [{ name: 'PROTECTED_GUILD_MASTER', generation_type: 'hex32' }],
  }),
});
if (!res.ok) throw new Error(`add_generated_secret ${res.status}: ${await res.text()}`);
const gen = await res.json();
console.log('generated keys', gen.all_keys, 'ciphertext bytes', Buffer.from(gen.encrypted_data_base64, 'base64').length);

const args = {
  accessor: { WasmHash: { hash: verifier.hash } }, profile: PROFILE, encrypted_secrets_base64: gen.encrypted_data_base64,
  access: { Predecessor: { condition: { Whitelist: { accounts: [guild] } } } }, vault_id: null,
};
const estimate = await view(owner, OUTLAYER, 'estimate_storage_cost', { ...args, owner: owner.accountId });
const r = await owner.signAndSendTransaction({ receiverId: OUTLAYER, actions: [actions.functionCall('store_secrets', args, 50n * 10n ** 12n, BigInt(estimate))], throwOnFailure: true });
console.log('store_secrets tx', r.transaction.hash, 'deposit yocto', estimate);
saveState({ secret_tx: r.transaction.hash, secret_access: args.access });
