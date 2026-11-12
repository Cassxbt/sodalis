import { Account, KeyPair, actions } from 'near-api-js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const RPC = process.env.NEAR_RPC ?? 'https://rpc.testnet.fastnear.com';
export const OUTLAYER = 'outlayer.testnet';
export const OUTLAYER_API = 'https://testnet-api.outlayer.ai';
export const PROFILE = 'sodalis-v2';
export const ADMIN_KEY_FILE = process.env.ADMIN_KEY_FILE;

const keyFile = (name) => join(ROOT, '.keys', `${name}.json`);
export const STATE_FILE = join(ROOT, '.keys', 'state.json');
export const state = () => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {});
export const saveState = (patch) => writeFileSync(STATE_FILE, JSON.stringify({ ...state(), ...patch }, null, 1));

export function admin() {
  const { accountId, privateKey } = JSON.parse(readFileSync(ADMIN_KEY_FILE, 'utf8'));
  return new Account(accountId, RPC, privateKey);
}

export function load(name) {
  const { accountId, privateKey } = JSON.parse(readFileSync(keyFile(name), 'utf8'));
  return new Account(accountId, RPC, privateKey);
}

/** Creates `<prefix>.<admin>` funded with `near`, keeping its key under .keys/. */
export async function createSub(parent, prefix, near) {
  const accountId = `${prefix}.${parent.accountId}`;
  if (existsSync(keyFile(prefix))) return load(prefix);
  const kp = KeyPair.fromRandom('ed25519');
  const r = await parent.signAndSendTransaction({
    receiverId: accountId,
    actions: [actions.createAccount(), actions.transfer(BigInt(Math.round(near * 1000)) * 10n ** 21n), actions.addFullAccessKey(kp.getPublicKey())],
    throwOnFailure: true,
  });
  writeFileSync(keyFile(prefix), JSON.stringify({ accountId, privateKey: kp.toString() }));
  console.log(`created ${accountId} tx ${r.transaction.hash}`);
  return load(prefix);
}

export const view = (account, contractId, method, args = {}) => account.provider.callFunction({ contractId, method, args });

export async function call(account, contractId, method, args, { deposit = 0n, tgas = 300n } = {}) {
  const r = await account.signAndSendTransaction({
    receiverId: contractId,
    actions: [actions.functionCall(method, args, tgas * 10n ** 12n, deposit)],
    throwOnFailure: false,
  });
  const ret = r.status?.SuccessValue !== undefined
    ? (r.status.SuccessValue ? JSON.parse(Buffer.from(r.status.SuccessValue, 'base64').toString()) : null)
    : r.status;
  const logs = r.receipts_outcome.flatMap((o) => o.outcome.logs);
  const failures = r.receipts_outcome.map((o) => o.outcome.status).filter((s) => s.Failure).map((s) => JSON.stringify(s.Failure).slice(0, 300));
  return { tx: r.transaction.hash, ret, logs, failures, burnt: r.receipts_outcome.reduce((n, o) => n + BigInt(o.outcome.tokens_burnt), BigInt(r.transaction_outcome.outcome.tokens_burnt)) };
}

export async function executionDeposit(account) {
  const limits = { max_instructions: 2_000_000_000, max_memory_mb: 64, max_execution_seconds: 20 };
  return BigInt(await view(account, OUTLAYER, 'estimate_execution_cost', { resource_limits: limits }));
}

export { actions };
