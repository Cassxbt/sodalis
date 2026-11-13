// The camera member (a fresh key that joined on /join) asks round 2 for 0.05 and
// is paid, asks for 0.06 more and is refused, is removed by a DAO vote that calls
// the guild's revoke, and is refused when it asks again.
import { Account } from 'near-api-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, RPC, load, call, saveState } from './lib.mjs';

const GUILD = 'sodalis.testnet';
const DAO = 'sodalis-dao.sputnik-v2.testnet';
const NEAR = 10n ** 24n;
const saved = JSON.parse(readFileSync(join(ROOT, '.keys/browser-member.json'), 'utf8'));
const member = new Account(saved.account_id, RPC, saved.private_key);
const m1 = load('m1');
const eve = load('eve');
const council = load('council');
const read = (contractId, method, args = {}) => m1.provider.callFunction({ contractId, method, args });
const show = (label, r) => console.log(`${label}\n  ${r.tx}\n  ret ${JSON.stringify(r.ret)}${r.failures.length ? `\n  refused ${r.failures[0].slice(0, 160)}` : ''}`);
const refusal = (r, text) => { if (!r.failures.some((f) => f.includes(text))) throw new Error(`expected "${text}", saw ${JSON.stringify(r.failures)}`); };

if ((await read(GUILD, 'get_seat', { account_id: member.accountId })) !== 'public') throw new Error('the camera member is not seated');

const asked = await call(member, GUILD, 'request_payout', { amount: String(NEAR / 20n), category: 'Equipment' }, { tgas: 60n });
show('the member asks round 2 for 0.05', asked);
if (typeof asked.ret !== 'number') throw new Error('request was not filed');
const id = asked.ret;
const proposal = await read(DAO, 'get_proposal', { id });
const approved = await call(m1, DAO, 'act_proposal', { id, action: 'VoteApprove', proposal: proposal.kind }, { tgas: 150n });
show(`a steward approves #${id}`, approved);
const settled = await call(eve, GUILD, 'settle', { proposal_id: id }, { tgas: 80n });
show(`anyone settles #${id}`, settled);
if (settled.ret !== 'approved') throw new Error(`settle returned ${settled.ret}`);

const over = await call(member, GUILD, 'request_payout', { amount: String((NEAR * 6n) / 100n), category: 'Travel' }, { tgas: 60n });
show('it asks for 0.06 more', over);
refusal(over, 'exceeds your allowance in this round');

const kind = { FunctionCall: { receiver_id: GUILD, actions: [{ method_name: 'revoke', args: Buffer.from(JSON.stringify({ account_id: member.accountId })).toString('base64'), deposit: '0', gas: '150000000000000' }] } };
const filed = await call(council, DAO, 'add_proposal', { proposal: { description: 'Sodalis: revoke a member who has left the team', kind } }, { tgas: 100n });
if (typeof filed.ret !== 'number') throw new Error(`add_proposal failed: ${JSON.stringify(filed.failures)}`);
const voted = await call(council, DAO, 'act_proposal', { id: filed.ret, action: 'VoteApprove', proposal: kind }, { tgas: 300n });
show(`the DAO votes to revoke it (proposal #${filed.ret})`, voted);
const policy = await read(DAO, 'get_policy');
if (policy.roles.some((r) => r.kind?.Group?.includes(member.accountId)) || (await read(GUILD, 'get_member', { account_id: member.accountId }))) throw new Error('the member still holds a seat');

const after = await call(member, GUILD, 'request_payout', { amount: String(NEAR / 100n), category: 'Other' }, { tgas: 60n });
show('it asks again', after);
refusal(after, 'only seated members may request a payout');

saveState({ revocation: { member: member.accountId, id, asked: asked.tx, approved: approved.tx, settled: settled.tx, over: over.tx, revokeProposal: filed.ret, revokeFiled: filed.tx, revoked: voted.tx, after: after.tx } });
