// An outsider calls OutLayer directly, naming the guild's secret row and the
// pinned build, with a letter copied from the chain. The keystore must not
// release the guild master to a run the guild contract did not request.
import { readFileSync } from 'node:fs';
import { OUTLAYER, PROFILE, admin, load, state, call, view, executionDeposit } from './lib.mjs';

const [member, sealedPath, letterPath] = process.argv.slice(2);
const attacker = load(member);
const { guild, verifier } = state();
const letter = JSON.parse(readFileSync(letterPath, 'utf8'));
const [, key_p] = (await view(attacker, guild, 'get_domain_keys')).find(([k]) => k === `${letter.domain}/${letter.selector}`);
const input = { action: 'verify', guild, domain: letter.domain, selector: letter.selector, key_p, sealed: readFileSync(sealedPath, 'utf8') };
const r = await call(attacker, OUTLAYER, 'request_execution', {
  source: { WasmUrl: { url: verifier.url, hash: verifier.hash, build_target: 'wasm32-wasip1' } },
  resource_limits: { max_instructions: 2_000_000_000, max_memory_mb: 64, max_execution_seconds: 20 },
  input_data: JSON.stringify(input),
  secrets_ref: { profile: PROFILE, account_id: admin().accountId },
  response_format: 'Json',
}, { deposit: await executionDeposit(attacker) });
console.log(JSON.stringify({ attacker: attacker.accountId, tx: r.tx, result: r.ret, failures: r.failures, logs: r.logs.slice(-3) }, null, 1));
