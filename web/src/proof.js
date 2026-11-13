import { el, reveal } from './shell.js';
import { verifyJoin, verifyPayout, verifyRefusedVote, view } from './attest.js';
import { GUILD, DAO, EXPLORER, JOINS, PAYOUT } from './receipts.js';

const $ = (sel) => document.querySelector(sel);
const txLink = (hash) => { const a = el('a', 'tx', `${hash.slice(0, 8)}… ↗`); a.href = EXPLORER + hash; a.target = '_blank'; a.rel = 'noopener'; return a; };

async function roster() {
  const [config, keys, policy] = await Promise.all([view(GUILD, 'get_config'), view(GUILD, 'get_domain_keys'), view(DAO, 'get_policy')]);
  const fill = (id, nodes) => { const card = $(id); card.querySelector('.loading').remove(); card.append(...nodes); };

  const tiers = el('ul', 'plain');
  for (const [id, key] of keys) { const li = el('li'); li.append(el('span', `tag ${key.role}`, key.role), el('span', 'mono', id)); tiers.append(li); }
  fill('#tiers', [tiers, el('p', 'fine', config.issuers_sealed ? 'Sealed: no key can ever be added.' : 'Not yet sealed: the DAO can still add a key by public proposal.')]);

  const seats = el('ul', 'plain');
  for (const name of ['staff', 'public']) {
    const members = policy.roles.find((r) => r.name === name)?.kind?.Group ?? [];
    const li = el('li'); li.append(el('span', `tag ${name}`, name), el('span', 'mono', members.join(', ') || 'none yet')); seats.append(li);
  }
  const gate = policy.roles.find((r) => r.name === 'gatekeeper')?.kind?.Group ?? [];
  fill('#seats', [seats, el('p', 'fine', `Only ${gate.join(', ')} may add or remove seats.`)]);

  const dl = el('dl');
  for (const [k, v] of [['owner', config.owner], ['secret owner', config.secrets_owner], ['verifier', `${config.verifier.hash.slice(0, 16)}…`], ['members', String(config.member_count)]]) dl.append(el('dt', null, k), el('dd', 'mono', v));
  fill('#config', [dl]);
}

function row(check) {
  const li = el('li', `check ${check.ok ? 'ok' : 'bad'}`);
  li.append(el('span', 'seal', check.ok ? '✓' : '✕'), el('span', 'name', check.name), el('span', 'detail mono', check.detail));
  return li;
}

function joinEntry(join) {
  const li = el('li', 'entry reveal');
  li.id = `join-${join.id}`;
  const head = el('div', 'entry-head');
  head.append(el('h3', null, join.title), txLink(join.tx));
  const stages = el('div', 'stages');
  for (const g of ['execution', 'admission', 'seat']) {
    const s = el('div', 'stage'); s.dataset.group = g; s.append(el('h4', null, g), el('ul', 'checks')); stages.append(s);
  }
  li.append(head, el('p', 'note', join.note), stages, el('p', 'status', 'waiting'));
  return li;
}

async function runJoin(join, tamper) {
  const li = $(`#join-${join.id}`);
  li.classList.remove('verified', 'failed');
  li.classList.toggle('tampered', tamper);
  li.classList.add('running');
  li.querySelectorAll('.checks').forEach((u) => u.replaceChildren());
  li.querySelector('.status').textContent = tamper ? 'recomputing a forged record…' : 'recomputing…';
  try {
    const { checks, outcome } = await verifyJoin(join.tx, join.signer, GUILD, undefined, { tamper });
    checks.forEach((c, i) => setTimeout(() => li.querySelector(`.stage[data-group="${c.group}"] .checks`).append(row(c)), i * 110));
    const ok = checks.every((c) => c.ok);
    setTimeout(() => {
      li.classList.add(ok ? 'verified' : 'failed');
      li.querySelector('.status').textContent = ok
        ? `recomputed · ${outcome.account_id} seated as ${outcome.role}`
        : `failed · ${checks.filter((c) => !c.ok).length} check(s) refuse this record`;
    }, checks.length * 110);
  } catch (e) {
    li.querySelector('.status').textContent = `not verified here: ${e.message}`;
  } finally {
    li.classList.remove('running');
  }
}

function payoutEntries() {
  PAYOUT.steps.forEach((step, i) => {
    const li = el('li', `entry step reveal${step.refused ? ' refusal' : ''}`);
    li.id = `step-${i}`;
    const head = el('div', 'entry-head');
    head.append(el('h3', null, step.label), txLink(step.tx));
    li.append(head, el('ul', 'checks'));
    $('#payout').append(li);
  });
}

async function runPayout() {
  const [proposed, refused, approved] = PAYOUT.steps;
  const [refusal, payout] = await Promise.all([verifyRefusedVote(refused.tx, refused.signer), verifyPayout(DAO, PAYOUT.proposalId, proposed.tx, approved.tx, approved.signer)]);
  $('#step-0 .checks').replaceChildren(...payout.filter((c) => c.step === 0).map(row));
  $('#step-1 .checks').replaceChildren(...refusal.map(row));
  $('#step-2 .checks').replaceChildren(...payout.filter((c) => c.step === 2).map(row));
}

let tampered = false;
async function verifyAll() {
  const buttons = [$('#verify-all'), $('#tamper')];
  buttons.forEach((b) => (b.disabled = true));
  await Promise.all(JOINS.map((j) => runJoin(j, tampered)));
  await runPayout().catch((e) => $('#payout').append(el('p', 'status', `not verified here: ${e.message}`)));
  buttons.forEach((b) => (b.disabled = false));
}

JOINS.forEach((j) => $('#joins').append(joinEntry(j)));
payoutEntries();
reveal();
roster().catch((e) => document.querySelectorAll('.loading').forEach((n) => (n.textContent = `could not read: ${e.message}`)));
$('#verify-all').addEventListener('click', () => { tampered = false; $('#tamper').textContent = 'Forge one byte'; verifyAll(); });
$('#tamper').addEventListener('click', () => {
  tampered = !tampered;
  $('#tamper').textContent = tampered ? 'Restore the record' : 'Forge one byte';
  verifyAll();
});
verifyAll();
