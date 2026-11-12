// Runs the verifier under Node's WASI with the env the OutLayer worker sets.
import { WASI } from 'node:wasi';
import { readFileSync, writeFileSync, openSync, closeSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seal } from './seal.mjs';

const [wasmPath, casesPath] = process.argv.slice(2);
const module = await WebAssembly.compile(readFileSync(wasmPath));
const dir = mkdtempSync(join(tmpdir(), 'bg2-'));
const MASTER = 'aa'.repeat(32);
const ROWS = JSON.stringify([{ owner: 'admin.testnet', profile: 'bg2', keys: ['PROTECTED_GUILD_MASTER'] }]);
const worker = (guild, extra = {}) => ({ PROTECTED_GUILD_MASTER: MASTER, OUTLAYER_SECRETS_ROWS: ROWS, NEAR_PREDECESSOR_ID: guild, ...extra });

async function run(input, env) {
  const inPath = join(dir, 'in'), outPath = join(dir, 'out');
  writeFileSync(inPath, JSON.stringify(input));
  const stdin = openSync(inPath, 'r'), stdout = openSync(outPath, 'w');
  const wasi = new WASI({ version: 'preview1', stdin, stdout, env });
  wasi.start(await WebAssembly.instantiate(module, wasi.getImportObject()));
  closeSync(stdin); closeSync(stdout);
  return JSON.parse(readFileSync(outPath, 'utf8'));
}

const cases = JSON.parse(readFileSync(casesPath, 'utf8'));
const inboxes = {};
for (const g of new Set(cases.flatMap((c) => [c.input.guild, c.seal_to]))) {
  inboxes[g] = (await run({ action: 'inbox', guild: g }, worker(g))).inbox;
}

let pass = 0;
const nullifiers = {};
for (const c of cases) {
  const sealed = seal(inboxes[c.seal_to], c.letter);
  const env = worker(c.input.guild, { NEAR_SENDER_ID: c.wallet, NEAR_BLOCK_TIMESTAMP: String(BigInt(c.now) * 1_000_000_000n) });
  const out = await run({ ...c.input, sealed }, env);
  const ok = (c.expect === 'ok' ? out.ok === true : out.ok === false && out.reason.includes(c.expect)) && JSON.stringify(out).length < 600;
  if (out.ok) nullifiers[c.name] = out.nullifier;
  pass += ok;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}  ->  ${out.ok ? 'ok' : out.reason}  (dkimpy valid: ${c.dkimpy_says_valid})`);
}

const extra = [];
const sealedGood = seal(inboxes['bg.guild.testnet'], cases[0].letter);
const G = 'bg.guild.testnet';
const env0 = { NEAR_PREDECESSOR_ID: G, OUTLAYER_SECRETS_ROWS: ROWS, NEAR_SENDER_ID: cases[0].wallet, NEAR_BLOCK_TIMESTAMP: String(BigInt(cases[0].now) * 1_000_000_000n) };
const noMaster = await run({ ...cases[0].input, sealed: sealedGood }, env0);
extra.push(['run without the guild secret is refused', noMaster.ok === false && noMaster.reason.includes('no guild master'), noMaster.reason]);
const wrongMaster = await run({ ...cases[0].input, sealed: sealedGood }, { ...env0, PROTECTED_GUILD_MASTER: 'bb'.repeat(32) });
extra.push(['letter does not open under another master', wrongMaster.ok === false && wrongMaster.reason.includes('does not open'), wrongMaster.reason]);
const { wallet: _w, ...noWalletInput } = cases[0].input;
const noWallet = await run({ ...noWalletInput, sealed: sealedGood }, worker(G, { NEAR_BLOCK_TIMESTAMP: env0.NEAR_BLOCK_TIMESTAMP }));
extra.push(['a request without the joining wallet is refused', noWallet.ok === false && noWallet.reason.includes('wallet'), noWallet.reason]);
const relayed = await run({ ...cases[0].input, sealed: sealedGood }, { ...env0, PROTECTED_GUILD_MASTER: MASTER, NEAR_SENDER_ID: 'relayer.testnet' });
extra.push(['the wallet comes from the guild, not the transaction signer (relayers allowed)', relayed.ok === true, relayed.reason ?? 'ok']);
const sybil = nullifiers['valid challenge'] && nullifiers['valid challenge'] === nullifiers['same person, second wallet (Sybil)'];
extra.push(['same email address on two wallets gives one nullifier', sybil, nullifiers['valid challenge']?.slice(0, 16)]);
const direct = await run({ ...cases[0].input, sealed: sealedGood }, { ...env0, PROTECTED_GUILD_MASTER: MASTER, NEAR_PREDECESSOR_ID: 'admin.testnet' });
extra.push(['run requested by anyone but the guild contract is refused', direct.ok === false && direct.reason.includes('only the guild contract'), direct.reason]);
const shadowRows = JSON.stringify([{ owner: 'admin.testnet', profile: 'bg2', keys: ['NEAR_BLOCK_TIMESTAMP', 'PROTECTED_GUILD_MASTER'] }]);
const shadow = await run({ ...cases[0].input, sealed: sealedGood }, { ...env0, PROTECTED_GUILD_MASTER: MASTER, OUTLAYER_SECRETS_ROWS: shadowRows });
extra.push(['run with an extra secret (could shadow the clock) is refused', shadow.ok === false && shadow.reason.includes('alone'), shadow.reason]);
const tagSybil = nullifiers['valid challenge'] === nullifiers['same mailbox via +tag, third wallet (Sybil)'];
extra.push(['+tag address variant gives the same nullifier', tagSybil, nullifiers['same mailbox via +tag, third wallet (Sybil)']?.slice(0, 16)]);
const otherGuild = await run({ action: 'inbox', guild: 'other.guild.testnet' }, worker('other.guild.testnet'));
extra.push(['inbox key differs per guild', otherGuild.inbox !== inboxes['bg.guild.testnet'], otherGuild.inbox.slice(0, 16)]);
for (const [name, ok, detail] of extra) { pass += ok; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ->  ${detail}`); }
console.log(`\n${pass}/${cases.length + extra.length} passed`);
