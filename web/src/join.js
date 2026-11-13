import { Account, KeyPair } from 'near-api-js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { el, reveal } from './shell.js';
import { view, verifyJoin } from './attest.js';
import { challengeSubject, newSalt, seal, trimEml } from './core.js';
import { GUILD, DAO, EXPLORER } from './receipts.js';

const RPC = 'https://rpc.testnet.fastnear.com';
const STORE = 'sodalis.member.v1';
const STORAGE_FEE = 5n * 10n ** 21n;
const JOIN_GAS = 240n * 10n ** 12n;
const $ = (s) => document.querySelector(s);

const store = {
  get() { try { return JSON.parse(localStorage.getItem(STORE) ?? 'null'); } catch { return null; } },
  set(v) { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* private mode: the key lives for this tab only */ } },
  clear() { try { localStorage.removeItem(STORE); } catch { /* nothing stored */ } },
};

function member() {
  let m = store.get();
  if (!m) {
    const kp = KeyPair.fromRandom('ed25519');
    m = { accountId: bytesToHex(kp.getPublicKey().data), privateKey: kp.toString() };
  }
  if (!m.salt || m.guild !== GUILD || m.expiresAt < Date.now() / 1000 + 3600) {
    m = { ...m, guild: GUILD, salt: newSalt(), expiresAt: Math.floor(Date.now() / 1000) + 23 * 3600 };
  }
  store.set(m);
  return m;
}

let me = member();
const account = () => new Account(me.accountId, RPC, me.privateKey);
const link = (hash, text = `${hash.slice(0, 10)}… ↗`) => { const a = el('a', 'tx', text); a.href = EXPLORER + hash; a.target = '_blank'; a.rel = 'noopener'; return a; };
const state = (id, text, kind = '') => { const s = $(`${id} .jstate`); s.textContent = text; s.className = `jstate ${kind}`; };
const out = (id, ...nodes) => $(id).replaceChildren(...nodes);

async function balance() {
  try { return BigInt((await account().getState()).balance.available); } catch { return null; }
}

async function refresh() {
  out('#account', me.accountId);
  $('#subject').textContent = challengeSubject(GUILD, me.accountId, me.salt, me.expiresAt);
  const [bal, mem, keys] = await Promise.all([balance(), view(GUILD, 'get_member', { account_id: me.accountId }).catch(() => null), view(GUILD, 'get_domain_keys').catch(() => [])]);
  $('#domains').textContent = keys.map(([id, k]) => `${id.split('/')[0]} (${k.role})`).join(', ') || 'unavailable';
  state('#s1', 'ready', 'ok');
  if (bal === null) state('#s2', 'not funded yet'); else state('#s2', `${(Number(bal) / 1e24).toFixed(3)} NEAR available`, 'ok');
  $('#fund').disabled = bal !== null;
  if (mem) {
    state('#s4', `member · ${mem.role}`, 'ok');
    state('#s5', 'you may propose', 'ok');
  }
  $('#ask').disabled = !mem;
}

$('#download').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ account_id: me.accountId, private_key: me.privateKey, network: 'testnet' }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `sodalis-member-${me.accountId.slice(0, 8)}.json`; a.click();
});

$('#forget').addEventListener('click', () => { store.clear(); me = member(); out('#join-out'); out('#ask-out'); $('#join-checks').replaceChildren(); refresh(); });

$('#copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#subject').textContent).catch(() => {});
  $('#copy').textContent = 'Copied'; setTimeout(() => ($('#copy').textContent = 'Copy'), 1400);
});

$('#fund').addEventListener('click', async () => {
  $('#fund').disabled = true;
  state('#s2', 'asking the drip…');
  try {
    const r = await fetch('/api/drip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account_id: me.accountId }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    out('#fund-out', document.createTextNode('funded by the guild drip: '), link(d.tx));
  } catch (e) {
    out('#fund-out', document.createTextNode(`not funded: ${e.message}`));
    $('#fund').disabled = false;
  }
  refresh();
});

let letter = null;
$('#eml').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const raw = await file.text();
    const eml = trimEml(raw);
    const sig = eml.split('\r\n').find((l) => /^dkim-signature:/i.test(l)) ?? '';
    const flat = eml.slice(eml.toLowerCase().indexOf('dkim-signature:')).split('\r\n\r\n')[0].replace(/\r\n[ \t]+/g, ' ');
    const domain = flat.match(/[;\s]d=([^;\s]+)/i)?.[1]?.toLowerCase();
    const selector = flat.match(/[;\s]s=([^;\s]+)/i)?.[1];
    if (!sig || !domain || !selector) throw new Error('no DKIM signature found');
    if (!raw.includes($('#subject').textContent)) throw new Error('this email does not carry your current challenge subject');
    letter = { eml, domain, selector };
    $('#drop-label').textContent = `${file.name} · signed by ${domain} (${selector})`;
    $('#join').disabled = false;
    state('#s3', 'email received', 'ok');
  } catch (err) {
    letter = null;
    $('#join').disabled = true;
    $('#drop-label').textContent = `${file.name}: ${err.message}`;
  }
});

$('#join').addEventListener('click', async () => {
  if (!letter) return;
  $('#join').disabled = true;
  state('#s4', 'sealing and asking the enclave… (up to a minute)');
  $('#join-checks').replaceChildren();
  try {
    const { inbox } = await view(GUILD, 'get_config');
    const sealed = seal(inbox, { eml: letter.eml, salt: me.salt });
    const runDeposit = BigInt(await view('outlayer.testnet', 'estimate_execution_cost', { resource_limits: { max_instructions: 2000000000, max_memory_mb: 64, max_execution_seconds: 20 } }));
    const r = await account().callFunctionRaw({ contractId: GUILD, methodName: 'join', args: { domain: letter.domain, selector: letter.selector, sealed }, deposit: runDeposit + STORAGE_FEE, gas: JOIN_GAS, waitUntil: 'FINAL' });
    const hash = r.transaction.hash;
    const value = r.status?.SuccessValue;
    const result = value ? JSON.parse(atob(value)) : null;
    out('#join-out', document.createTextNode(result?.joined ? `joined as ${result.role} · ` : `${result?.reason ?? 'submitted'} · `), ...(hash ? [link(hash)] : []));
    if (hash) {
      const { checks } = await verifyJoin(hash, me.accountId, GUILD);
      checks.forEach((c, i) => setTimeout(() => {
        const li = el('li', `check ${c.ok ? 'ok' : 'bad'}`);
        li.append(el('span', 'seal', c.ok ? '✓' : '✕'), el('span', 'name', c.name), el('span', 'detail mono', c.detail));
        $('#join-checks').append(li);
      }, i * 110));
    }
  } catch (e) {
    out('#join-out', document.createTextNode(`not joined: ${e.message}`));
    $('#join').disabled = false;
  }
  refresh();
});

$('#ask').addEventListener('click', async () => {
  const amount = Number($('#amount').value);
  const reason = $('#reason').value.trim();
  if (!(amount > 0 && amount <= 1) || !reason) { out('#ask-out', document.createTextNode('enter an amount up to 1 NEAR and a reason')); return; }
  $('#ask').disabled = true;
  try {
    const [whole, frac = ''] = amount.toFixed(4).split('.');
    const yocto = (BigInt(whole) * 10n ** 24n + BigInt(frac.padEnd(24, '0'))).toString();
    const kind = { Transfer: { token_id: '', receiver_id: me.accountId, amount: yocto } };
    const id = await account().callFunction({ contractId: DAO, methodName: 'add_proposal', args: { proposal: { description: `Member request: ${reason}`, kind } }, gas: 50n * 10n ** 12n });
    out('#ask-out', document.createTextNode(`proposal #${id} filed. Staff decide; you cannot approve it yourself.`));
  } catch (e) {
    out('#ask-out', document.createTextNode(`not filed: ${e.message}`));
  }
  $('#ask').disabled = false;
});

reveal();
refresh();
