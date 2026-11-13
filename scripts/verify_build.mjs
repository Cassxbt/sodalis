// Rebuilds both binaries from source and checks them against the chain:
// the verifier against the build the guild pins and FastFS serves, and the
// guild contract against the code deployed at sodalis.testnet. Exits 1 on any mismatch.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const RPC = 'https://rpc.testnet.fastnear.com';
const GUILD = 'sodalis.testnet';
const sha = (b) => createHash('sha256').update(b).digest();
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const base58 = (bytes) => {
  let n = BigInt(`0x${bytes.toString('hex')}`), s = '';
  for (; n > 0n; n /= 58n) s = B58[Number(n % 58n)] + s;
  for (const b of bytes) { if (b) break; s = `1${s}`; }
  return s;
};
const query = async (params) => {
  const r = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { finality: 'final', ...params } }) })).json();
  if (!r.result) throw new Error(r.error?.message ?? 'RPC error');
  return r.result;
};

execFileSync('cargo', ['build', '--release', '--target', 'wasm32-wasip1', '--manifest-path', 'verifier/Cargo.toml'], { stdio: 'inherit' });
execFileSync('cargo', ['build', '--release', '--locked', '--target', 'wasm32-unknown-unknown', '--manifest-path', 'contract/Cargo.toml'], {
  stdio: 'inherit',
  env: { ...process.env, RUSTFLAGS: '-C link-arg=-s --cfg near' },
});

const verifierLocal = sha(readFileSync('verifier/target/wasm32-wasip1/release/guild-verifier-v2.wasm')).toString('hex');
const config = await query({ request_type: 'call_function', account_id: GUILD, method_name: 'get_config', args_base64: Buffer.from('{}').toString('base64') });
const { verifier } = JSON.parse(Buffer.from(config.result).toString());
const served = sha(Buffer.from(await (await fetch(verifier.url)).arrayBuffer())).toString('hex');

const contractLocal = base58(sha(readFileSync('contract/target/wasm32-unknown-unknown/release/sodalis.wasm')));
const { code_hash: deployed } = await query({ request_type: 'view_account', account_id: GUILD });

console.log('verifier (runs in the enclave)');
console.log(`  rebuilt from source    ${verifierLocal}`);
console.log(`  pinned by ${GUILD}  ${verifier.hash}`);
console.log(`  served by FastFS       ${served}`);
console.log('guild contract');
console.log(`  rebuilt from source    ${contractLocal}`);
console.log(`  deployed at ${GUILD} ${deployed}`);
const ok = verifierLocal === verifier.hash && served === verifier.hash && contractLocal === deployed;
console.log(ok ? 'MATCH: the guild runs exactly this source, on chain and in the enclave.' : 'MISMATCH');
process.exit(ok ? 0 : 1);
