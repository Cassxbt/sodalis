import { countUp } from './shell.js';
import { view, verifyRefusal } from './attest.js';
import { GUILD, DAO, ATTACKS } from './receipts.js';

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
