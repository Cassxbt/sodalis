// The page's sealing and trimming must be accepted by the real verifier build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WASI } from 'node:wasi';
import { readFileSync, writeFileSync, openSync, closeSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seal, trimEml, commitment, challengeSubject } from '../web/src/core.js';
import { commitment as nodeCommitment } from '../scripts/seal.mjs';

const WASM = new URL('../verifier/target/wasm32-wasip1/release/guild-verifier-v2.wasm', import.meta.url);
const cases = JSON.parse(readFileSync(new URL('../fixtures/cases.json', import.meta.url), 'utf8'));
const valid = cases.find((c) => c.name === 'valid challenge');
const dir = mkdtempSync(join(tmpdir(), 'sodalis-'));
const module = await WebAssembly.compile(readFileSync(WASM));
const env = (guild, extra = {}) => ({
  PROTECTED_GUILD_MASTER: 'aa'.repeat(32),
  OUTLAYER_SECRETS_ROWS: JSON.stringify([{ owner: 'admin.testnet', profile: 'p', keys: ['PROTECTED_GUILD_MASTER'] }]),
  NEAR_PREDECESSOR_ID: guild,
  ...extra,
});

async function run(input, vars) {
  const inPath = join(dir, 'in'), outPath = join(dir, 'out');
  writeFileSync(inPath, JSON.stringify(input));
  const stdin = openSync(inPath, 'r'), stdout = openSync(outPath, 'w');
  const wasi = new WASI({ version: 'preview1', stdin, stdout, env: vars });
  wasi.start(await WebAssembly.instantiate(module, wasi.getImportObject()));
  closeSync(stdin); closeSync(stdout);
  return JSON.parse(readFileSync(outPath, 'utf8'));
}

const verify = async (letter) => {
  const guild = valid.input.guild;
  const { inbox } = await run({ action: 'inbox', guild }, env(guild));
  return run({ ...valid.input, sealed: seal(inbox, letter) },
    env(guild, { NEAR_SENDER_ID: valid.wallet, NEAR_BLOCK_TIMESTAMP: String(BigInt(valid.now) * 1_000_000_000n) }));
};

test('a letter sealed by the page opens in the verifier', async () => {
  assert.equal((await verify(valid.letter)).ok, true);
});

test('trimming unsigned headers keeps the signature valid', async () => {
  const [head, body] = valid.letter.eml.split('\r\n\r\n');
  const noisy = `Received: from relay.example (10.0.0.1)\r\n\tby mx.example; Tue, 10 Nov 2026\r\nARC-Seal: i=1; cv=none\r\n${head}\r\n\r\n${body}`;
  const trimmed = trimEml(noisy);
  assert.ok(!/^Received:/m.test(trimmed) && !/^ARC-Seal:/m.test(trimmed));
  assert.equal((await verify({ ...valid.letter, eml: trimmed })).ok, true);
});

test('an email without DKIM is rejected before anything is sent', () => {
  assert.throws(() => trimEml('From: a@b.c\r\nTo: d@e.f\r\nSubject: x\r\n\r\nhi\r\n'), /no DKIM signature/);
});

test('the page commits to the same challenge as the scripts', () => {
  const salt = 'ab'.repeat(32);
  assert.equal(commitment('g.testnet', 'w.testnet', salt), nodeCommitment('g.testnet', 'w.testnet', salt));
  assert.match(challengeSubject('g.testnet', 'w.testnet', salt, 1794520014), /^bg2 [0-9a-f]{64} 1794520014$/);
});

import { taskHash } from '../web/src/attest.js';

test('any change to the attested task changes the hash the quote must match', () => {
  const a = { task_type: 'execute', task_id: 65740, build_target: 'wasm32-wasip1', wasm_hash: 'dea3', input_hash: 'f47b', output_hash: '3124', block_height: 277279029, caller_account_id: 'm2.testnet', secrets_ref: 'owner/sodalis', timestamp: 1794437512, attached_usd: '0' };
  const base = taskHash(a);
  for (const [k, v] of [['output_hash', '3125'], ['input_hash', 'f47c'], ['wasm_hash', 'dea4'], ['block_height', 277279030], ['caller_account_id', 'eve.testnet']]) {
    assert.notEqual(taskHash({ ...a, [k]: v }), base, k);
  }
});
