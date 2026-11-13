// The decisions this site re-verifies. Every value is a public testnet
// transaction; pages read the content from chain rather than trusting this file.
export const GUILD = 'sodalis.testnet';
export const DAO = 'sodalis-dao.sputnik-v2.testnet';
export const EXPLORER = 'https://testnet.nearblocks.io/txns/';
export const REPO = 'https://github.com/Cassxbt/sodalis';

const M1 = 'm1.kibble-pf-03c8a9.testnet';
const M2 = 'm2.kibble-pf-03c8a9.testnet';
const BROWSER = '54607a20b449611cb00929830d9f2da11a79457844e538deb5aff803bc53e75d';
const OUTSIDER = 'eve.sodalis-council.testnet';
const FORMER_OWNER = 'sodalis-council.testnet';

export const JOINS = [
  {
    id: 'staff',
    title: 'A staff seat from a company mailbox',
    note: 'A real email from a custom domain, signed by its mail host (d=trendtwin.xyz, s=hostingermail-a).',
    tx: 'AkSAiijEq17NBYu1Heh82hU8uEXpR5t2quhBhXefqYUk',
    signer: M1,
  },
  {
    id: 'public',
    title: 'A public seat from a free mailbox',
    note: 'A real Proton email, delivered to a Gmail inbox (d=proton.me, s=protonmail2).',
    tx: 'B4aqUCYVAytpX6Tv25YcFQhNc7UMSedmb5YED6CRifkL',
    signer: M2,
  },
  {
    id: 'browser',
    title: 'A seat taken on this site, from a browser',
    note: 'A fresh key made by the Join page, funded by the guild drip, with a Gmail-signed email (d=gmail.com, s=20260707). No wallet, no script.',
    tx: 'CyJABomVCPUED5nBGaDXx6y2kXG4mWejYWsyrtLxkRoY',
    signer: BROWSER,
  },
  {
    id: 'v1',
    title: 'The first real-email seat, three versions ago',
    note: 'Checked against the verifier the guild requested at the time, so upgrades never orphan an old proof.',
    tx: '4UtpbLqmxWyn8h3hVJDA5JmUxCSaEJ8E3BN7QAJPE13e',
    signer: M2,
  },
];

export const PAYOUT = {
  proposalId: 2,
  steps: [
    { label: 'A public member asks the treasury for 0.05 NEAR', tx: 'JDzowcGAH3GMVjRFGUiZVbMUBHpgMmWPqysj1NiLC2ad' },
    { label: 'They try to approve it themselves', tx: '7aCd3oqjPuqGASxrCdADdcxkbLvPerzZKNtMxecEsh8G', refused: true, signer: M2 },
    { label: 'A staff member approves it', tx: '4kWLrJobyVEwmXN55p2SaXWPU6xeF5szhJASGBcsuGkK', signer: M1 },
  ],
};

/** Round 1: a public member asks the guild, which enforces the allowance; staff decide. */
export const ROUND = {
  proposalId: 7,
  member: M2,
  steps: [
    { label: 'A public member asks the guild for 0.05 NEAR from round 1', tx: 'Euo7rGtkxqSQ2VMWHEbQntjEM5FvhriGXNcdA4e6yJY9', signer: M2 },
    { label: 'They ask for 0.06 more, past their 0.1 allowance', tx: 'GZkwDr3bSTsR5QP3Cz8AKCbVbQjrRNvehojsxwnVv4ab', signer: M2, refused: 'exceeds your allowance in this round' },
    { label: 'They ask the DAO directly, skipping the guild', tx: 'BcBnvJMu78hz64jS7C4CM92bCHeDpLvxjkp5V3P9VYPf', signer: M2, refused: 'ERR_PERMISSION_DENIED' },
    { label: 'A staff member approves, and the DAO pays', tx: 'qLiFNjgbnNbh9sCu9HV1JG16ZgfjxzNWkhA13kKZkzd', signer: M1 },
    { label: 'Anyone records the decision in the round', tx: 'GFFV57cMe8FZ6qFBPCodRYCTqz1NA8uAnCjq1ctgAcft', signer: OUTSIDER },
  ],
};

/** Round 2: the pot binds while a seat still has allowance, a rejection is returned once, and a departure ends authority. */
export const ROUND2 = {
  proposalId: 9,
  member: M2,
  staff: M1,
  steps: [
    { kind: 'filed', label: 'A public member asks for its whole 0.1 allowance', tx: 'Gxzr384ccmPtExYsNw5fEq2xK5jqHuQRAoEb7n852CVG', signer: M2 },
    { kind: 'refused', label: 'A staff member asks for 0.06: its own allowance allows it, the pot has 0.05 left', tx: '5nuDd6fUrj9bmavkJxahT7wfk5iTH4EAgP3kbZrFfSt2', signer: M1, expect: "exceeds the round's remaining budget" },
    { kind: 'rejected', label: 'Staff reject the 0.1 request', tx: 'STY4fGnhYdaMkCTBjRzJ5wqMWvdHhdshnpkhDDqr9Bq', signer: M1 },
    { kind: 'released', label: 'Anyone settles it: the 0.1 returns to the round', tx: '7hzcL4Qr8gUaYhmWDiVGj9a3zuUiQGsyiF65yBedFBeE', signer: OUTSIDER },
    { kind: 'left', label: 'The member leaves the guild', tx: 'CmKnfQ1CKk16ZK5zKiKA1szYLTEh8HSkZXx7e5TQxuDD', signer: M2 },
    { kind: 'refused', label: 'It asks again, without a seat', tx: 'B4JU3VFSzRg6mbyHRKqfqC61yrRmruuB4XCmAEGJxwj2', signer: M2, expect: 'only seated members may request a payout' },
  ],
};

/** Real attempts against the live guild. `expect` is the refusal the chain must show. */
export const ATTACKS = [
  {
    id: 'sybil',
    name: 'One mailbox, two seats',
    attempt: 'The same Proton mailbox sends a fresh, correctly signed challenge bound to a second wallet.',
    layer: 'Guild contract, using the nullifier derived inside the TEE',
    tx: 'FdBzomLry7UaV3jLiNdVFJPUKVcjNgqZS38aYQonPWio',
    signer: OUTSIDER,
    expect: 'this email address already admitted a member',
    tee: true,
  },
  {
    id: 'replay',
    name: 'Steal a member\'s sealed email',
    attempt: 'Another wallet submits a member\'s sealed letter, copied from the chain.',
    layer: 'Verifier in the TEE: the subject commits to the original wallet',
    tx: '9Xtf5tXumh1jyaPvJ45Dk93QcQufiEfYFbM6T7AZStLC',
    signer: OUTSIDER,
    expect: 'challenge is bound to a different wallet or guild',
    tee: true,
  },
  {
    id: 'domain',
    name: 'Join from an unapproved domain',
    attempt: 'A join that names a domain the DAO never approved.',
    layer: 'Guild contract, before any TEE run is paid for',
    tx: '6voLAUxcoQkpJs35SGKfpocwqvMmczfQJ94FqBAQqKYN',
    signer: OUTSIDER,
    expect: 'has not pinned a key for that domain and selector',
  },
  {
    id: 'direct',
    name: 'Borrow the guild\'s secret',
    attempt: 'An outside account calls OutLayer directly, naming the guild\'s TEE secret.',
    layer: 'OutLayer keystore access rule: only sodalis.testnet may use it',
    tx: '2R1cfdGXAFoPRNTMLLtsTA2QaJji7j8oJ9vzvgH44NpW',
    signer: OUTSIDER,
    expect: 'Access denied by access condition',
  },
  {
    id: 'reset',
    name: 'Wipe the guild',
    attempt: 'An outside account calls the guild\'s one-time migration, reset.',
    layer: 'NEAR runtime: reset is #[private] to the guild account itself',
    tx: 'DP9VHiGRGerz8G6HNpnqY2GHggQXpZhfRp85wsGDKj6k',
    signer: OUTSIDER,
    expect: 'is private',
  },
  {
    id: 'owner',
    name: 'Slip in a forged issuer key',
    attempt: 'The former owner tries to approve a new DKIM key after handing the guild to the DAO.',
    layer: 'Guild contract: only the DAO may pin keys, by public proposal',
    tx: 'FvyF4rdu6NweHTG5VPQi4SuXX8aaUQh2eRWWriCfxCa1',
    signer: FORMER_OWNER,
    expect: 'owner only',
  },
  {
    id: 'over-allowance',
    name: 'Ask past your allowance',
    attempt: 'A public member who already asked for 0.05 NEAR in round 1 asks for 0.06 more; each seat may ask for 0.1.',
    layer: 'Guild contract: per-seat allowance and round budget',
    tx: 'GZkwDr3bSTsR5QP3Cz8AKCbVbQjrRNvehojsxwnVv4ab',
    signer: M2,
    expect: 'exceeds your allowance in this round',
  },
  {
    id: 'bypass',
    name: 'Skip the round',
    attempt: 'A member files a transfer straight with the DAO instead of asking the guild.',
    layer: 'Sputnik DAO policy: members file transfers only through the guild',
    tx: 'BcBnvJMu78hz64jS7C4CM92bCHeDpLvxjkp5V3P9VYPf',
    signer: M2,
    expect: 'ERR_PERMISSION_DENIED',
  },
  {
    id: 'outsider-request',
    name: 'Ask without a seat',
    attempt: 'An account with no seat asks the guild for a payout.',
    layer: 'Guild contract: only seated members may ask',
    tx: 'F2FiyoQ7ZfZzuFsddeiy1yhmcF3zE3fb4FBQ2bpa155n',
    signer: OUTSIDER,
    expect: 'only seated members may request a payout',
  },
  {
    id: 'over-budget',
    name: 'Ask past the round\'s budget',
    attempt: 'A staff member with its whole allowance left asks for 0.06 NEAR when the round has 0.05 left.',
    layer: 'Guild contract: the round budget binds every seat together',
    tx: '5nuDd6fUrj9bmavkJxahT7wfk5iTH4EAgP3kbZrFfSt2',
    signer: M1,
    expect: "exceeds the round's remaining budget",
  },
  {
    id: 'double-settle',
    name: 'Release a reservation twice',
    attempt: 'Settle a rejected request a second time, hoping to return its 0.1 to the round again.',
    layer: 'Guild contract: a request settles once',
    tx: 'BZz83MP86L1pCGxHTbZsDpgC8NvdG32JUWEHLVU2u2xX',
    signer: OUTSIDER,
    expect: 'this request is already settled',
  },
  {
    id: 'after-leaving',
    name: 'Ask after leaving',
    attempt: 'A member leaves the guild, losing its DAO seat in the same transaction, then asks for a payout.',
    layer: 'Guild contract and DAO roster: leaving ends spending authority',
    tx: 'B4JU3VFSzRg6mbyHRKqfqC61yrRmruuB4XCmAEGJxwj2',
    signer: M2,
    expect: 'only seated members may request a payout',
  },
  {
    id: 'self-approve',
    name: 'Approve your own payout',
    attempt: 'A public-tier member votes to approve the payout they proposed.',
    layer: 'Sputnik DAO policy: public members cannot approve transfers',
    tx: '7aCd3oqjPuqGASxrCdADdcxkbLvPerzZKNtMxecEsh8G',
    signer: M2,
    expect: 'ERR_PERMISSION_DENIED',
  },
];

/**
 * One member's whole journey, step by step. Each step is checked live on the
 * case page; `kind` picks the check.
 */
export const CASES = [
  {
    id: 'first-user',
    title: 'A first-time user, from email to payment',
    who: 'Someone the builder reached out to, who agreed to try it',
    member: '12c54c6e4b43340db6f6a7fe7189ca76e21bbd5077f9f9e12ba278de7c0603e5',
    summary: 'Joined from their own tablet with a Gmail-signed email, following an eight-step written guide from the builder and no other help. Asked round 2 for 0.05 NEAR for travel; a steward approved it and the DAO paid. Their verdict on the page alone: confusing without the guide, which is now built into the Join page.',
    steps: [
      { kind: 'join', label: 'Proves they belong, with a Gmail email, from their own browser', tx: '9hJoh9YGNR8ZZ59pExrGoDW5qP37ZepcpUxJUwBU3fGe', signer: '12c54c6e4b43340db6f6a7fe7189ca76e21bbd5077f9f9e12ba278de7c0603e5' },
      { kind: 'paid', label: 'Round 2: asks for 0.05 NEAR for travel; a steward approves; the DAO pays', proposalId: 12, ask: '8UcMF6PqYaWNmzB4oh3Uwkr4t7wGnRLnffuiHWar95uC', approve: '8MW1nWsLU6tY5bcJ6d3EuVLkCxZP69mnAJs8FxFUxqb3', approver: M1, settle: '8Er7qb6E5niGp4nvX5QJzAa3r7UaRbpDSHf2v8DynboB', settler: OUTSIDER },
    ],
  },
  {
    id: 'departure',
    title: 'From first seat to departure',
    who: 'A builder test account',
    member: M2,
    // A named subaccount links back to the builder; a member who joins on /join gets a fresh key instead.
    linked: 'This test seat is a named subaccount of the builder\'s account, so it is linked to the builder. A member who joins on /join gets a fresh key with no such link.',
    summary: 'Proved membership with a Proton email. Asked for help twice: paid once, refused once for going past its allowance. Tried to skip the round. Asked for its whole allowance in round 2 and was turned down. Then left, and lost the right to ask.',
    steps: [
      { kind: 'join', label: 'Proves it belongs, with a Proton email', tx: JOINS[1].tx, signer: M2 },
      { kind: 'paid', label: 'Round 1: asks for 0.05 NEAR; staff approve; the DAO pays', proposalId: ROUND.proposalId, ask: ROUND.steps[0].tx, approve: ROUND.steps[3].tx, approver: M1, settle: ROUND.steps[4].tx, settler: OUTSIDER },
      { kind: 'refused', label: 'Asks for 0.06 more, past its 0.1 allowance', tx: ROUND.steps[1].tx, signer: M2, expect: ROUND.steps[1].refused },
      { kind: 'refused', label: 'Tries to skip the guild and ask the DAO directly', tx: ROUND.steps[2].tx, signer: M2, expect: ROUND.steps[2].refused },
      { kind: 'rejected', label: 'Round 2: asks for its whole 0.1; staff turn it down; the 0.1 returns to the round', proposalId: ROUND2.proposalId, ask: ROUND2.steps[0].tx, reject: ROUND2.steps[2].tx, approver: M1, settle: ROUND2.steps[3].tx, settler: OUTSIDER },
      { kind: 'left', label: 'Leaves the guild; the DAO seat goes with it', tx: ROUND2.steps[4].tx, signer: M2 },
      { kind: 'refused', label: 'Asks again, without a seat', tx: ROUND2.steps[5].tx, signer: M2, expect: ROUND2.steps[5].expect },
    ],
  },
];
