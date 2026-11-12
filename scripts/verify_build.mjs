// Rebuilds the verifier from source and checks it is byte-identical to the
// build the live guild pins and FastFS serves. Exits 1 on any mismatch.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const RPC = 'https://rpc.testnet.fastnear.com';
const GUILD = 'sodalis.testnet';
const sha = (b) => createHash('sha256').update(b).digest('hex');

execFileSync('cargo', ['build', '--release', '--target', 'wasm32-wasip1', '--manifest-path', 'verifier/Cargo.toml'], { stdio: 'inherit' });
const local = sha(readFileSync('verifier/target/wasm32-wasip1/release/guild-verifier-v2.wasm'));

const body = { jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: GUILD, method_name: 'get_config', args_base64: Buffer.from('{}').toString('base64') } };
const res = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const { verifier } = JSON.parse(Buffer.from(res.result.result).toString());
const served = sha(Buffer.from(await (await fetch(verifier.url)).arrayBuffer()));

console.log(`rebuilt from source   ${local}`);
console.log(`pinned by ${GUILD}  ${verifier.hash}`);
console.log(`served by FastFS       ${served}`);
const ok = local === verifier.hash && served === verifier.hash;
console.log(ok ? 'MATCH: the guild runs exactly this source.' : 'MISMATCH');
process.exit(ok ? 0 : 1);
