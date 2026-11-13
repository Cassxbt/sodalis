// A first-time user joined on /join from her own browser and asked round 2 for
// 0.05 NEAR (proposal #12). Staff approve it, and anyone records it in the round.
import { load, call, saveState } from './lib.mjs';

const GUILD = 'sodalis.testnet';
const DAO = 'sodalis-dao.sputnik-v2.testnet';
const ID = 12;
const MEMBER = '12c54c6e4b43340db6f6a7fe7189ca76e21bbd5077f9f9e12ba278de7c0603e5';
const m1 = load('m1');
const eve = load('eve');

const proposal = await m1.provider.callFunction({ contractId: DAO, method: 'get_proposal', args: { id: ID } });
const transfer = proposal.kind?.Transfer;
if (proposal.status !== 'InProgress' || proposal.proposer !== GUILD || transfer?.receiver_id !== MEMBER) throw new Error(`#${ID} is not the expected request: ${JSON.stringify(proposal)}`);

const approved = await call(m1, DAO, 'act_proposal', { id: ID, action: 'VoteApprove', proposal: proposal.kind }, { tgas: 150n });
const after = await m1.provider.callFunction({ contractId: DAO, method: 'get_proposal', args: { id: ID } });
console.log(`staff m1 approves #${ID} · ${approved.tx} · ${after.status}`);
if (after.status !== 'Approved') throw new Error(JSON.stringify(approved.failures));

const settled = await call(eve, GUILD, 'settle', { proposal_id: ID }, { tgas: 80n });
console.log(`anyone settles #${ID} · ${settled.tx} · ${settled.ret}`);
if (settled.ret !== 'approved') throw new Error(JSON.stringify(settled.failures));
saveState({ firstUser: { member: MEMBER, drip: 'HzNhdN2rb1Np8nS7WXAJe4LxcTZfTeciSFTUNLT9BBGS', join: '9hJoh9YGNR8ZZ59pExrGoDW5qP37ZepcpUxJUwBU3fGe', ask: '8UcMF6PqYaWNmzB4oh3Uwkr4t7wGnRLnffuiHWar95uC', id: ID, approved: approved.tx, settled: settled.tx } });
