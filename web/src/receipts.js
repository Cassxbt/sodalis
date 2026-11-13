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
    layer: 'Sputnik DAO policy: only the guild may file transfers',
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
    id: 'self-approve',
    name: 'Approve your own payout',
    attempt: 'A public-tier member votes to approve the payout they proposed.',
    layer: 'Sputnik DAO policy: public members cannot approve transfers',
    tx: '7aCd3oqjPuqGASxrCdADdcxkbLvPerzZKNtMxecEsh8G',
    signer: M2,
    expect: 'ERR_PERMISSION_DENIED',
  },
];
