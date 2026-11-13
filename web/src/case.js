import { el, reveal } from './shell.js';
import { near, verifyFiled, verifyJoin, verifyLeft, verifyPayout, verifyRefusal, verifyRejected, verifySettle, view } from './attest.js';
import { GUILD, DAO, EXPLORER, CASES } from './receipts.js';

const $ = (s) => document.querySelector(s);
const txLink = (hash) => { const a = el('a', 'tx', `${hash.slice(0, 8)}… ↗`); a.href = EXPLORER + hash; a.target = '_blank'; a.rel = 'noopener'; return a; };
const short = (account) => (account.length === 64 ? `${account.slice(0, 8)}…${account.slice(-4)}` : account);
const chosen = CASES.find((c) => c.id === new URLSearchParams(location.search).get('case')) ?? CASES[0];

function row(check) {
  const li = el('li', `check ${check.ok ? 'ok' : 'bad'}`);
  li.append(el('span', 'seal', check.ok ? '✓' : '✕'), el('span', 'name', check.name), el('span', 'detail mono', check.detail));
  return li;
}

const refusal = (step) => verifyRefusal(step.tx, step.signer, step.expect).then((r) => [{ name: `Refused on chain by ${r.where ?? 'the chain'}`, ok: r.ok, detail: r.text }]);

/** Every step resolves to `{checks, txs, seen}`; `seen` adds what this step made public. */
const CHECKS = {
  async join(step) {
    const { checks, outcome } = await verifyJoin(step.tx, step.signer, GUILD);
    const passed = checks.filter((c) => c.ok).length;
    const summary = { name: `${passed} of ${checks.length} checks pass: Intel quote, approved enclave image, the exact verifier, input and output, the admission and the DAO seat`, ok: passed === checks.length, detail: `${outcome.domain} · ${outcome.role}` };
    return { checks: [summary], details: checks, txs: [step.tx], seen: [`Domain: ${outcome.domain}, tier: ${outcome.role}`, `Seat key: ${short(step.signer)}`, 'A keyed fingerprint of the address, which cannot be reversed or tested against a guess'] };
  },
  async paid(step) {
    const [payout, books] = await Promise.all([
      verifyPayout(DAO, step.proposalId, step.ask, step.approve, step.approver, { member: chosen.member, guild: GUILD }),
      verifySettle(step.settle, step.settler, GUILD, step.proposalId, 'approved'),
    ]);
    return { checks: [...payout, ...books], txs: [step.ask, step.approve, step.settle], seen: ['Each request: amount, category, round and every vote'] };
  },
  async rejected(step) {
    const checks = (await Promise.all([
      verifyFiled(step.ask, chosen.member, GUILD, DAO, step.proposalId),
      verifyRejected(step.reject, step.approver, DAO, step.proposalId),
      verifySettle(step.settle, step.settler, GUILD, step.proposalId, 'rejected', 'released'),
    ])).flat();
    return { checks, txs: [step.ask, step.reject, step.settle] };
  },
  async left(step) {
    return { checks: await verifyLeft(step.tx, step.signer, GUILD, DAO), txs: [step.tx] };
  },
  async refused(step) {
    return { checks: await refusal(step), txs: [step.tx] };
  },
};

function tabs() {
  for (const c of CASES) {
    const a = el('a', 'case-tab', c.title);
    a.href = `?case=${c.id}`;
    if (c === chosen) a.setAttribute('aria-current', 'page');
    $('#cases').append(a);
  }
}

function entry(step, i) {
  const li = el('li', 'entry step running reveal');
  li.id = `step-${i}`;
  const head = el('div', 'entry-head');
  head.append(el('h3', null, step.label));
  li.append(head, el('ul', 'checks'), el('p', 'status', 'checking…'));
  return li;
}

async function runStep(step, i) {
  const li = $(`#step-${i}`);
  try {
    const { checks, details, txs, seen } = await CHECKS[step.kind](step);
    li.querySelector('.entry-head').append(el('span', 'txs'));
    txs.forEach((t) => li.querySelector('.txs').append(txLink(t)));
    li.querySelector('.checks').replaceChildren(...checks.map(row));
    if (details) {
      const list = el('ul', 'checks');
      list.append(...details.map(row));
      const more = el('details', 'more');
      more.append(el('summary', null, 'Show every check'), list);
      li.insertBefore(more, li.querySelector('.status'));
    }
    const ok = checks.every((c) => c.ok);
    li.classList.add(ok ? 'verified' : 'failed');
    li.querySelector('.status').textContent = ok ? 'verified now, from public data' : 'a check failed';
    return { ok, seen: seen ?? [] };
  } catch (e) {
    li.classList.add('failed');
    li.querySelector('.status').textContent = `not verified here: ${e.message}`;
    return { ok: false, seen: [] };
  } finally {
    li.classList.remove('running');
  }
}

async function now() {
  const [policy, member, allowance, round] = await Promise.all([
    view(DAO, 'get_policy'),
    view(GUILD, 'get_member', { account_id: chosen.member }),
    view(GUILD, 'get_allowance', { account_id: chosen.member }),
    view(GUILD, 'get_round'),
  ]);
  const roles = policy.roles.filter((r) => r.kind?.Group?.includes(chosen.member)).map((r) => r.name);
  const lines = [
    member ? `Member of the guild, ${member.role} tier` : 'No longer a member of the guild',
    roles.length ? `DAO seat: ${roles.join(', ')}` : 'No DAO seat: it cannot ask, vote or approve',
    member && allowance ? `Round ${round.id}: ${near(allowance.remaining)} of ${near(allowance.allowance)} NEAR left to ask for` : `Round ${round.id} is ${round.open ? 'open' : 'closed'}; this account cannot ask in it`,
  ];
  $('#now').replaceChildren(...lines.map((l) => el('li', null, l)));
}

tabs();
$('#case-who').textContent = chosen.who;
$('#case-title').textContent = chosen.title;
$('#case-summary').textContent = chosen.summary;
$('#linked').textContent = chosen.linked ?? 'A transfer from a wallet the person already owned: the seat is a fresh key, funded by the guild drip, which is public.';
chosen.steps.forEach((step, i) => $('#steps').append(entry(step, i)));
reveal();
now().catch((e) => $('#now').replaceChildren(el('li', null, `could not read: ${e.message}`)));
Promise.all(chosen.steps.map(runStep)).then((results) => {
  const passed = results.filter((r) => r.ok).length;
  $('#case-tally').textContent = `${passed} of ${results.length} steps verified now · member ${short(chosen.member)}`;
  const seen = [...new Set(results.flatMap((r) => r.seen))];
  $('#seen').replaceChildren(...seen.map((s) => el('li', null, s)));
});
