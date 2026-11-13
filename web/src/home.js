import { countUp } from './shell.js';
import { view, verifyPayout, verifyRefusal } from './attest.js';
import { GUILD, DAO, ATTACKS, ROUND, ROUND2 } from './receipts.js';

const steps = [...document.querySelectorAll('.mech-step')];
const nodes = [...document.querySelectorAll('.diagram .node')];
const wires = [...document.querySelectorAll('.diagram .wire')];

function light(active) {
  steps.forEach((s, i) => s.classList.toggle('active', i === active));
  nodes.forEach((n, i) => n.classList.toggle('on', i <= active));
  wires.forEach((w, i) => w.classList.toggle('on', i < active));
}

const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) light(Number(e.target.dataset.s));
}, { rootMargin: '-45% 0px -45% 0px' });
steps.forEach((s) => io.observe(s));
light(0);

const stat = (k) => document.querySelector(`.stat [data-k="${k}"]`);
Promise.all([view(DAO, 'get_policy'), view(GUILD, 'get_domain_keys')])
  .then(([policy, keys]) => {
    const seats = policy.roles.filter((r) => ['staff', 'public'].includes(r.name)).reduce((n, r) => n + (r.kind?.Group?.length ?? 0), 0);
    countUp(stat('seats'), seats);
    countUp(stat('domains'), new Set(keys.map(([id]) => id.split('/')[0])).size);
  })
  .catch(() => ['seats', 'domains', 'attacks'].forEach((k) => (stat(k).textContent = '?')));

Promise.all(ATTACKS.map((a) => verifyRefusal(a.tx, a.signer, a.expect).then((r) => r.ok).catch(() => false)))
  .then((oks) => countUp(stat('attacks'), oks.filter(Boolean).length));

// The three outcomes in the hero, each re-read from chain rather than asserted.
const outcome = (k, ok, text) => { const s = document.querySelector(`.outcome[data-o="${k}"] .o-s`); s.textContent = ok ? text : 'could not verify now'; s.classList.toggle('ok', ok); };
const [asked, , , approved] = ROUND.steps;
verifyPayout(DAO, ROUND.proposalId, asked.tx, approved.tx, approved.signer, { member: ROUND.member, guild: GUILD })
  .then((checks) => outcome('paid', checks.every((c) => c.ok), 'verified on chain · transfer receipt'))
  .catch(() => outcome('paid', false));
const [over, left] = [ROUND.steps[1], ROUND2.steps[5]];
verifyRefusal(over.tx, over.signer, over.refused).then((r) => outcome('over', r.ok, 'verified on chain · refused by the guild')).catch(() => outcome('over', false));
verifyRefusal(left.tx, left.signer, left.expect).then((r) => outcome('left', r.ok, 'verified on chain · refused by the guild')).catch(() => outcome('left', false));
