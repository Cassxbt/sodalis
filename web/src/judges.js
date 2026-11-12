import init from '@phala/dcap-qvl-web';
import dcapWasm from '@phala/dcap-qvl-web/dcap-qvl-web_bg.wasm?url';
import { el, reveal } from './shell.js';
import { verifyJoin, verifyRefusal } from './attest.js';
import { GUILD, EXPLORER, ATTACKS } from './receipts.js';

const $ = (sel) => document.querySelector(sel);
const ready = init({ module_or_path: dcapWasm });

function card(attack, i) {
  const c = el('article', 'attack reveal');
  c.style.setProperty('--i', String(i % 2));
  c.id = `attack-${attack.id}`;
  const link = el('a', 'tx', `${attack.tx.slice(0, 8)}… ↗`);
  link.href = EXPLORER + attack.tx; link.target = '_blank'; link.rel = 'noopener';
  const verdict = el('div', 'verdict');
  verdict.append(el('span', 'say', 'reading…'), link);
  c.append(el('span', 'stamp', 'Refused'), el('span', 'k', `Attack ${String(i + 1).padStart(2, '0')}`), el('h3', null, attack.name), el('p', null, attack.attempt), el('span', 'layer', `Stopped by: ${attack.layer}`), verdict);
  if (attack.tee) {
    const b = el('button', 'btn', 'Verify the enclave run');
    b.style.alignSelf = 'flex-start';
    b.addEventListener('click', () => teeRun(attack, c, b));
    c.append(b);
  }
  return c;
}

async function check(attack) {
  const c = $(`#attack-${attack.id}`);
  const say = c.querySelector('.say');
  c.classList.remove('refused');
  say.textContent = 'reading…';
  try {
    const r = await verifyRefusal(attack.tx, attack.signer, attack.expect);
    c.classList.toggle('refused', r.ok);
    say.textContent = r.ok ? `refused · "${r.text}"` : `not refused as claimed · saw "${r.text}"`;
    return r.ok;
  } catch (e) {
    say.textContent = `not verified here: ${e.message}`;
    return false;
  }
}

async function teeRun(attack, c, button) {
  button.disabled = true;
  button.textContent = 'Recomputing…';
  await ready;
  const { checks, outcome } = await verifyJoin(attack.tx, attack.signer, GUILD);
  const execution = checks.filter((x) => x.group === 'execution');
  const passed = execution.filter((x) => x.ok).length;
  const line = el('p', 'layer');
  line.textContent = `Enclave run: ${passed}/${execution.length} checks pass (Intel quote, approved image, exact task, requested code, input, output). The guild then ${outcome.joined ? 'admitted' : `refused: "${outcome.reason}"`}.`;
  button.replaceWith(line);
}

async function all() {
  const button = $('#recheck');
  button.disabled = true;
  $('#score').textContent = 'reading the chain…';
  const results = await Promise.all(ATTACKS.map(check));
  $('#score').textContent = `${results.filter(Boolean).length} of ${ATTACKS.length} attempts refused on chain`;
  button.disabled = false;
}

ATTACKS.forEach((a, i) => $('#attacks').append(card(a, i)));
reveal();
$('#recheck').addEventListener('click', all);
all();
