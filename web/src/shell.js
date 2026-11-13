import './style.css';
import { REPO } from './receipts.js';

const SEAL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6.5" stroke-dasharray="1.5 2"/><path d="M9 12.2l2 2 4-4.4"/></svg>`;
const PAGES = [
  ['/', 'Home', ''],
  ['/proof/', 'Proof', ''],
  ['/join/', 'Join', ''],
  ['/judges/', 'Break it', ''],
  ['/how/', 'How it works', 'hide-sm'],
];

function nav() {
  const here = location.pathname.replace(/index\.html$/, '');
  const links = PAGES.map(([href, label, cls]) => `<a href="${href}" class="${cls}"${here === href ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const header = document.createElement('header');
  header.className = 'nav';
  header.innerHTML = `<div class="wrap"><a class="brand" href="/">${SEAL}Sodalis</a><nav class="links">${links}<a href="${REPO}" class="hide-sm">Source</a></nav></div><div class="progress"></div>`;
  document.body.prepend(header);
  const bar = header.querySelector('.progress');
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.setProperty('--p', max > 0 ? String(scrollY / max) : '0');
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function footer() {
  const f = document.createElement('footer');
  f.innerHTML = `<div class="wrap"><span>Sodalis · built at NEAR HACKATHON by cassxbt · NEAR testnet</span><span><a href="${REPO}">Source</a> · <a href="/proof/">Re-verify</a> · <a href="/judges/">Break it</a></span></div>`;
  document.body.append(f);
}

/** Fades sections in as they enter; elements with the same parent stagger by --i. */
export function reveal(root = document) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  root.querySelectorAll('.reveal:not(.in)').forEach((el) => io.observe(el));
}

/** Counts a number up once it scrolls into view. */
export function countUp(el, to) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = String(to); return; }
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    const start = performance.now(), dur = 1200;
    const tick = (t) => {
      const k = Math.min(1, (t - start) / dur);
      el.textContent = String(Math.round(to * (1 - (1 - k) ** 3)));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  io.observe(el);
}

export const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

nav();
footer();
reveal();
