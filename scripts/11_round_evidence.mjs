// Round 1 evidence: a public member asks within its allowance and is paid; asks
// past it and is refused by the guild; tries to bypass the guild and is refused
// by the DAO. An outsider cannot ask at all. Every step is a testnet receipt.
import { load, call, saveState } from './lib.mjs';

const GUILD = 'sodalis.testnet';
const DAO = 'sodalis-dao.sputnik-v2.testnet';
const NEAR = 10n ** 24n;
const m1 = load('m1');
const m2 = load('m2');
const eve = load('eve');

const show = (label, r) => console.log(`${label}\n  ${r.tx}\n  ret ${JSON.stringify(r.ret)}${r.failures.length ? `\n  refused ${r.failures[0]}` : ''}`);
const refusal = (r, text) => {
  if (!r.failures.some((f) => f.includes(text))) throw new Error(`expected "${text}", saw ${JSON.stringify(r.failures)}`);
};

const asked = await call(m2, GUILD, 'request_payout', { amount: String(NEAR / 20n), category: 'Travel' }, { tgas: 60n });
show('m2 asks for 0.05 NEAR within its allowance', asked);
if (typeof asked.ret !== 'number') throw new Error('request was not filed');
const id = asked.ret;

const over = await call(m2, GUILD, 'request_payout', { amount: String((NEAR * 6n) / 100n), category: 'Software' }, { tgas: 60n });
show('m2 asks for 0.06 more, past its 0.1 allowance', over);
refusal(over, 'exceeds your allowance in this round');

const kind = { Transfer: { token_id: '', receiver_id: m2.accountId, amount: String(NEAR / 20n) } };
const bypass = await call(m2, DAO, 'add_proposal', { proposal: { description: 'Sodalis: a request outside the round', kind } }, { tgas: 50n });
show('m2 asks the DAO directly, skipping the guild', bypass);
refusal(bypass, 'ERR_PERMISSION_DENIED');

const outsider = await call(eve, GUILD, 'request_payout', { amount: String(NEAR / 20n), category: 'Travel' }, { tgas: 60n });
show('an outsider asks the guild', outsider);
refusal(outsider, 'only seated members may request a payout');

const approved = await call(m1, DAO, 'act_proposal', { id, action: 'VoteApprove', proposal: kind }, { tgas: 150n });
show(`staff m1 approves #${id}`, approved);
const proposal = await m1.provider.callFunction({ contractId: DAO, method: 'get_proposal', args: { id } });
if (proposal.status !== 'Approved') throw new Error(`#${id} is ${proposal.status}`);

const settled = await call(eve, GUILD, 'settle', { proposal_id: id }, { tgas: 80n });
show('anyone records the outcome in the round', settled);
if (settled.ret !== 'approved') throw new Error(`settle returned ${settled.ret}`);

const round = await m1.provider.callFunction({ contractId: GUILD, method: 'get_round', args: {} });
const allowance = await m1.provider.callFunction({ contractId: GUILD, method: 'get_allowance', args: { account_id: m2.accountId } });
console.log('round', round, 'm2', allowance);
saveState({ v42Evidence: { id, asked: asked.tx, over: over.tx, bypass: bypass.tx, outsider: outsider.tx, approved: approved.tx, settled: settled.tx, round, allowance } });
