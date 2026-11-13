import { Account, KeyPair } from 'near-api-js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { el, reveal } from './shell.js';
import { NETWORK, near, view, verifyJoin } from './attest.js';
import { challengeSubject, newSalt, seal, trimEml } from './core.js';
import { GUILD, DAO, EXPLORER } from './receipts.js';

const STORE = 'sodalis.member.v1';
const STORAGE_FEE = 5n * 10n ** 21n;
const JOIN_GAS = 240n * 10n ** 12n;
const GAS_RESERVE = 30n * 10n ** 21n;
const MAX_SEALED = 24_000;
const YOCTO = 10n ** 24n;
const HISTORY = 'https://testnet.nearblocks.io/address/';
const $ = (s) => document.querySelector(s);

const store = {
  get() { try { return JSON.parse(localStorage.getItem(STORE) ?? 'null'); } catch { return null; } },
  set(v) { try { localStorage.setItem(STORE, JSON.stringify(v)); return true; } catch { return false; } },
  clear() { try { localStorage.removeItem(STORE); } catch { /* nothing stored */ } },
};

function member(base = store.get()) {
  let m = base;
  if (!m) {
    const kp = KeyPair.fromRandom('ed25519');
    m = { accountId: bytesToHex(kp.getPublicKey().data), privateKey: kp.toString() };
  }
  if (!m.salt || m.guild !== GUILD || m.expiresAt < Date.now() / 1000 + 3600) {
    m = { ...m, guild: GUILD, salt: newSalt(), expiresAt: Math.floor(Date.now() / 1000) + 23 * 3600 };
  }
  $('#key-note').textContent = store.set(m) ? '' : 'This browser will not keep your key after this tab closes. Save it now.';
  return m;
}

// Bumped whenever the identity changes, so answers for the old key are dropped.
let generation = 0;
let me = member();
let letter = null;
let status = { balance: undefined, role: undefined, pinned: new Set() };
let armed = null;

const account = () => new Account(me.accountId, NETWORK.rpc, me.privateKey);
const text = (t) => document.createTextNode(t);
const link = (href, label) => { const a = el('a', 'tx', label); a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; };
const txLink = (hash) => link(EXPLORER + hash, `${hash.slice(0, 10)}… ↗`);
const historyLink = () => link(HISTORY + me.accountId, 'your key\'s history ↗');
const state = (id, t, kind = '') => { const s = $(`${id} .jstate`); s.textContent = t; s.className = `jstate ${kind}`; };
const out = (id, ...nodes) => $(id).replaceChildren(...nodes);

/** Spendable balance, null when the account does not exist; throws when the network cannot say. Optimistic, so a fresh drip shows at once. */
async function balanceOf(accountId) {
  const r = await fetch(NETWORK.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'view_account', finality: 'optimistic', account_id: accountId } }) });
  const d = await r.json();
  if (d.result) return BigInt(d.result.amount) - BigInt(d.result.storage_usage) * 10n ** 19n;
  if (d.error?.cause?.name === 'UNKNOWN_ACCOUNT') return null;
  throw new Error(d.error?.message ?? `RPC ${r.status}`);
}

async function daoRole(accountId) {
  const { roles } = await view(DAO, 'get_policy');
  return roles.find((r) => ['staff', 'public'].includes(r.name) && r.kind?.Group?.includes(accountId))?.name ?? null;
}

async function refresh() {
  const g = generation;
  out('#account', text(me.accountId));
  $('#subject').textContent = challengeSubject(GUILD, me.accountId, me.salt, me.expiresAt);
  const [bal, role, keys] = await Promise.allSettled([balanceOf(me.accountId), daoRole(me.accountId), view(GUILD, 'get_domain_keys')]);
  if (g !== generation) return;

  state('#s1', 'ready', 'ok');
  if (bal.status === 'rejected') state('#s2', 'network unavailable; try again shortly');
  else if (bal.value === null) state('#s2', 'not funded yet');
  else state('#s2', `${near(bal.value - (bal.value % 10n ** 21n))} NEAR available`, 'ok');
  status.balance = bal.status === 'fulfilled' ? bal.value : undefined;
  $('#fund').disabled = status.balance !== null;

  if (keys.status === 'fulfilled') {
    status.pinned = new Set(keys.value.map(([id]) => id));
    $('#domains').textContent = keys.value.map(([id, k]) => `${id.split('/')[0]} (${k.role})`).join(', ') || 'none yet';
  } else $('#domains').textContent = 'could not be read right now';

  status.role = role.status === 'fulfilled' ? role.value : undefined;
  if (status.role) {
    state('#s4', `seated · ${status.role}`, 'ok');
    state('#s5', 'you may propose', 'ok');
    $('#join').disabled = true;
    if (me.joinTx && !$('#join-out').textContent) {
      out('#join-out', text(`seated as ${status.role} · `), txLink(me.joinTx));
      $('#reverify').hidden = false;
    }
  } else if (role.status === 'rejected') state('#s5', 'could not read the DAO roster');
  $('#ask').disabled = !status.role;
  preview();
  requests();
}

$('#download').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ account_id: me.accountId, private_key: me.privateKey, network: 'testnet', join_tx: me.joinTx ?? null }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `sodalis-member-${me.accountId.slice(0, 8)}.json`; a.click();
  me.saved = true; store.set(me);
});

function switchTo(next) {
  generation++;
  clearTimeout(armed); armed = null;
  $('#forget').textContent = 'Start over';
  me = member(next);
  status = { balance: undefined, role: undefined, pinned: status.pinned };
  $('#ask').disabled = true;
  $('#fund').disabled = true;
  letter = null;
  $('#eml').value = '';
  $('#drop-label').textContent = 'Choose the saved email (.eml)';
  $('#join').disabled = true;
  $('#reverify').hidden = true;
  for (const id of ['#fund-out', '#join-out', '#verify-note', '#ask-out', '#join-checks', '#requests']) out(id);
  for (const id of ['#s2', '#s3', '#s4', '#s5']) state(id, '');
  refresh();
}

// Unknown (still loading, or the network failed) counts as holding something.
const holds = () => status.balance !== null || status.role !== null;

$('#forget').addEventListener('click', () => {
  if (holds() && !armed) {
    $('#forget').textContent = 'Discard it for good';
    const what = status.balance === undefined || status.role === undefined ? 'may hold test NEAR or a seat' : `holds test NEAR${status.role ? ' and a DAO seat' : ''}`;
    $('#key-note').textContent = `This key ${what}.${me.saved ? '' : ' You have not saved it.'} Discarding cannot be undone.`;
    armed = setTimeout(() => { armed = null; $('#forget').textContent = 'Start over'; $('#key-note').textContent = ''; }, 5000);
    return;
  }
  store.clear();
  switchTo(null);
});

$('#restore').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (holds() && !me.saved) { $('#key-note').textContent = 'Save the current key first, or start over, before restoring another.'; return; }
  try {
    const saved = JSON.parse(await file.text());
    const id = bytesToHex(KeyPair.fromString(saved.private_key).getPublicKey().data);
    if (id !== saved.account_id) throw new Error('the key does not match its account');
    switchTo({ accountId: id, privateKey: saved.private_key, joinTx: saved.join_tx ?? undefined, saved: true });
    $('#key-note').textContent = 'Key restored.';
  } catch (err) {
    $('#key-note').textContent = `Not restored: ${err.message}`;
  }
});

$('#copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#subject').textContent).catch(() => {});
  $('#copy').textContent = 'Copied'; setTimeout(() => ($('#copy').textContent = 'Copy'), 1400);
});

$('#fund').addEventListener('click', async () => {
  const g = generation;
  $('#fund').disabled = true;
  state('#s2', 'asking the drip…');
  try {
    const r = await fetch('/api/drip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account_id: me.accountId }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    if (g === generation) out('#fund-out', text('funded by the guild drip: '), txLink(d.tx));
  } catch (err) {
    if (g === generation) out('#fund-out', text(`not funded: ${err.message}`));
  }
  if (g === generation) refresh();
});

$('#eml').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const raw = await file.text();
    const eml = trimEml(raw);
    const flat = eml.slice(eml.toLowerCase().indexOf('dkim-signature:')).split('\r\n\r\n')[0].replace(/\r\n[ \t]+/g, ' ');
    const domain = flat.match(/[;\s]d=([^;\s]+)/i)?.[1]?.toLowerCase();
    const selector = flat.match(/[;\s]s=([^;\s]+)/i)?.[1];
    if (!domain || !selector) throw new Error('no DKIM signature found');
    const subject = eml.match(/^subject:[ \t]*(.*(?:\r\n[ \t].*)*)/im)?.[1].replace(/\r\n[ \t]+/g, ' ').trim();
    if (subject !== $('#subject').textContent) throw new Error('its subject is not your current challenge');
    if (status.pinned.size && !status.pinned.has(`${domain}/${selector}`)) throw new Error(`the guild has not approved ${domain} (selector ${selector})`);
    letter = { eml, domain, selector };
    $('#drop-label').textContent = `${file.name} · signed by ${domain} (${selector})`;
    $('#join').disabled = Boolean(status.role);
    state('#s3', 'email received', 'ok');
  } catch (err) {
    letter = null;
    $('#join').disabled = true;
    $('#drop-label').textContent = `${file.name}: ${err.message}`;
  }
});

async function verify(hash) {
  const g = generation;
  $('#reverify').hidden = true;
  $('#join-checks').replaceChildren();
  $('#verify-note').textContent = 'Re-checking the enclave run independently: Intel quote, approved image, code, input, output, seat…';
  try {
    const { checks } = await verifyJoin(hash, me.accountId, GUILD);
    if (g !== generation) return;
    checks.forEach((c, i) => setTimeout(() => {
      if (g !== generation) return;
      const li = el('li', `check ${c.ok ? 'ok' : 'bad'}`);
      li.append(el('span', 'seal', c.ok ? '✓' : '✕'), el('span', 'name', c.name), el('span', 'detail mono', c.detail));
      $('#join-checks').append(li);
    }, i * 110));
    $('#verify-note').textContent = checks.every((c) => c.ok) ? `All ${checks.length} checks passed in your browser.` : `${checks.filter((c) => !c.ok).length} check(s) failed. The chain record above is unchanged.`;
  } catch (err) {
    if (g !== generation) return;
    $('#verify-note').textContent = `Independent verification is unavailable right now (${err.message}). This does not change the result above.`;
  }
  $('#reverify').hidden = false;
}

$('#reverify').addEventListener('click', () => me.joinTx && verify(me.joinTx));

$('#join').addEventListener('click', async () => {
  if (!letter) return;
  const g = generation;
  $('#join').disabled = true;
  $('#reverify').hidden = true;
  $('#join-checks').replaceChildren();
  out('#verify-note');
  out('#join-out');
  state('#s4', 'checking before you pay…');
  let sent = false;
  try {
    const [{ inbox }, cost, balance] = await Promise.all([
      view(GUILD, 'get_config'),
      view(NETWORK.outlayer, 'estimate_execution_cost', { resource_limits: { max_instructions: 2000000000, max_memory_mb: 64, max_execution_seconds: 20 } }),
      balanceOf(me.accountId),
    ]);
    const deposit = BigInt(cost) + STORAGE_FEE;
    if (balance === null || balance < deposit + GAS_RESERVE) throw new Error(`your key needs about ${near(deposit + GAS_RESERVE)} NEAR; fund it first`);
    const sealed = seal(inbox, { eml: letter.eml, salt: me.salt });
    if (sealed.length > MAX_SEALED) throw new Error('this email is too large to seal; send a plain one with no attachments');
    state('#s4', 'sealed · waiting for the enclave (up to a minute)');
    sent = true;
    const r = await account().callFunctionRaw({ contractId: GUILD, methodName: 'join', args: { domain: letter.domain, selector: letter.selector, sealed }, deposit, gas: JOIN_GAS, waitUntil: 'FINAL' });
    if (g !== generation) return;
    const hash = r.transaction.hash;
    const result = r.status?.SuccessValue ? JSON.parse(atob(r.status.SuccessValue)) : null;
    if (result?.joined) {
      me.joinTx = hash; store.set(me);
      out('#join-out', text(`joined as ${result.role} · `), txLink(hash));
      state('#s4', `seated · ${result.role}`, 'ok');
      verify(hash);
    } else {
      const reason = result?.reason ?? 'the guild did not admit this key';
      out('#join-out', text(`refused: ${reason} · `), txLink(hash));
      state('#s4', 'refused; any run deposit was refunded');
      $('#join').disabled = false;
    }
  } catch (err) {
    if (g !== generation) return;
    const panic = /^Smart contract panicked:\s*/;
    if (panic.test(err.message)) {
      out('#join-out', text(`refused: ${err.message.replace(panic, '')} · `), historyLink());
      state('#s4', 'refused; nothing was charged but gas');
      $('#join').disabled = false;
    } else if (sent) {
      out('#join-out', text(`no clear answer (${err.message}). Check `), historyLink(), text(' and reload this page before trying again.'));
      state('#s4', 'unknown; check before retrying');
    } else {
      out('#join-out', text(`not sent: ${err.message}`));
      state('#s4', '');
      $('#join').disabled = false;
    }
  }
  refresh();
});

function request() {
  const raw = $('#amount').value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return { error: 'amount: up to two decimals' };
  const [whole, frac = ''] = raw.split('.');
  const yocto = BigInt(whole) * YOCTO + BigInt(frac.padEnd(24, '0'));
  if (yocto <= 0n || yocto > YOCTO) return { error: 'amount: between 0.01 and 1 NEAR' };
  const note = $('#reason').value.trim().replace(/\s+/g, ' ');
  return { yocto, description: `Member request: ${$('#category').value}${note ? ` · ${note}` : ''}` };
}

function preview() {
  const r = request();
  $('#preview').textContent = r.error ?? `Will publish: "${r.description}" · ${near(r.yocto)} NEAR to ${me.accountId.slice(0, 8)}…${me.accountId.slice(-4)}`;
}
['#amount', '#category', '#reason'].forEach((s) => $(s).addEventListener('input', preview));

async function requests() {
  const g = generation;
  try {
    const last = await view(DAO, 'get_last_proposal_id');
    const from = Math.max(0, last - 100);
    const all = await view(DAO, 'get_proposals', { from_index: from, limit: last - from });
    if (g !== generation) return;
    const mine = all.filter((p) => p.proposer === me.accountId && p.kind?.Transfer);
    $('#requests').replaceChildren(...mine.reverse().map((p) => {
      const li = el('li');
      const kind = p.status === 'Approved' ? 'ok' : ['Rejected', 'Removed', 'Expired', 'Failed'].includes(p.status) ? 'bad' : '';
      const label = p.status === 'Approved' ? 'approved and paid by the DAO' : p.status === 'InProgress' ? 'waiting for staff' : p.status.toLowerCase();
      li.append(text(`#${p.id} · ${near(p.kind.Transfer.amount)} NEAR`), el('span', `st ${kind}`, label));
      if (p.status === 'Approved') li.append(historyLink());
      return li;
    }));
  } catch { /* the list is a convenience; the request itself is on chain */ }
}

$('#ask').addEventListener('click', async () => {
  const r = request();
  if (r.error) { out('#ask-out', text(r.error)); return; }
  const g = generation;
  $('#ask').disabled = true;
  try {
    const kind = { Transfer: { token_id: '', receiver_id: me.accountId, amount: r.yocto.toString() } };
    const id = await account().callFunction({ contractId: DAO, methodName: 'add_proposal', args: { proposal: { description: r.description, kind } }, gas: 50n * 10n ** 12n });
    if (g === generation) out('#ask-out', text(`Proposal #${id} filed. Staff decide; you cannot approve it yourself.`));
  } catch (err) {
    if (g === generation) out('#ask-out', text(`not confirmed: ${err.message}. Check your requests below before trying again.`));
  }
  if (g === generation) { $('#ask').disabled = false; requests(); }
});

reveal();
preview();
refresh();
