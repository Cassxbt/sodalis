// The decisions this site re-verifies. Every value is a public testnet
// transaction; pages read the content from chain rather than trusting this file.
export const GUILD = 'sodalis.testnet';
export const DAO = 'sodalis.sputnik-v2.testnet';
export const EXPLORER = 'https://testnet.nearblocks.io/txns/';
export const REPO = 'https://github.com/Cassxbt/sodalis';

const M1 = 'm1.kibble-pf-03c8a9.testnet';
const M2 = 'm2.kibble-pf-03c8a9.testnet';
const OUTSIDER = 'kibble-pf-03c8a9.testnet';

export const JOINS = [
  {
    id: 'staff',
    title: 'A staff seat from a company mailbox',
    note: 'A real email from a custom domain, signed by its mail host (d=trendtwin.xyz, s=hostingermail-a).',
    tx: 'DaVFDQDR1pAzdDywJTfhGEFKZGq9VjsbmqxtV9dR5h77',
    signer: M1,
  },
  {
    id: 'public',
    title: 'A public seat from a free mailbox',
    note: 'A real Proton email, delivered to a Gmail inbox (d=proton.me, s=protonmail2).',
    tx: '85pPVVqYoymT4GJSiqi1Rzne81EihdWschTPtueyrTmJ',
    signer: M2,
  },
  {
    id: 'v1',
    title: 'The first real-email seat, two versions ago',
    note: 'Checked against the verifier the guild requested at the time, so upgrades never orphan an old proof.',
    tx: '4UtpbLqmxWyn8h3hVJDA5JmUxCSaEJ8E3BN7QAJPE13e',
    signer: M2,
  },
];

export const PAYOUT = {
  proposalId: 7,
  steps: [
    { label: 'A public member asks the treasury for 0.05 NEAR', tx: 'EksrkHFXcW6DG6qv7nsPdvVz54Ed1b9SJj983Fz215vr' },
    { label: 'They try to approve it themselves', tx: '7gn39aaYTFSUHMyYN9R3H6LFrJmUHftPdY1rr7xu5H7h', refused: true, signer: M2 },
    { label: 'A staff member approves it', tx: 'EX4gMjGkXKiufBnuXEKKEasDAELedhb1CXgs96Rjef4Q', signer: M1 },
  ],
};

/** Real attempts against the live guild. `expect` is the refusal the chain must show. */
export const ATTACKS = [
  {
    id: 'sybil',
    name: 'One mailbox, two seats',
    attempt: 'The same Proton mailbox sends a fresh, correctly signed challenge bound to a second wallet.',
    layer: 'Guild contract, using the nullifier derived inside the TEE',
    tx: '5McKWNQE9XyhRMgMiaXHFKXAnRSzzG9pRxreTW5woNUm',
    signer: OUTSIDER,
    expect: 'this email address already admitted a member',
    tee: true,
  },
  {
    id: 'replay',
    name: 'Steal a member\'s sealed email',
    attempt: 'Another wallet submits a member\'s sealed letter, copied from the chain.',
    layer: 'Verifier in the TEE: the subject commits to the original wallet',
    tx: '331udABpYsbj2co3FSunhMBaGKoT5E8rRn5aKVx4i58b',
    signer: OUTSIDER,
    expect: 'challenge is bound to a different wallet or guild',
    tee: true,
  },
  {
    id: 'domain',
    name: 'Join from an unapproved domain',
    attempt: 'A join that names a domain the DAO never approved.',
    layer: 'Guild contract, before any TEE run is paid for',
    tx: 'GNrnqSuUNzX9GP2eURxH1HJu5VyiBTTACsFnrnvJ4K6S',
    signer: OUTSIDER,
    expect: 'has not pinned a key for that domain and selector',
  },
  {
    id: 'direct',
    name: 'Borrow the guild\'s secret',
    attempt: 'An outside account calls OutLayer directly, naming the guild\'s TEE secret.',
    layer: 'OutLayer keystore access rule: only sodalis.testnet may use it',
    tx: 'CDe12e5R9pd9NHGpEvoFqmzFMeSaUzM2EoPRSpkUV3Sn',
    signer: OUTSIDER,
    expect: 'Access denied by access condition',
  },
  {
    id: 'reset',
    name: 'Wipe the guild',
    attempt: 'An outside account calls the guild\'s one-time migration, reset.',
    layer: 'NEAR runtime: reset is #[private] to the guild account itself',
    tx: '9MTj77ncweDpsYjsYkvYoTkZ6XvewtKLL1vYbXMmM2aP',
    signer: OUTSIDER,
    expect: 'is private',
  },
  {
    id: 'owner',
    name: 'Slip in a forged issuer key',
    attempt: 'The former owner tries to approve a new DKIM key after handing the guild to the DAO.',
    layer: 'Guild contract: only the DAO may pin keys, by public proposal',
    tx: '7y4NYEPncA6jc7evZjhRXh4gyN8zcsAduvVHAyb2mCPm',
    signer: OUTSIDER,
    expect: 'owner only',
  },
  {
    id: 'self-approve',
    name: 'Approve your own payout',
    attempt: 'A public-tier member votes to approve the payout they proposed.',
    layer: 'Sputnik DAO policy: only staff may approve transfers',
    tx: '7gn39aaYTFSUHMyYN9R3H6LFrJmUHftPdY1rr7xu5H7h',
    signer: M2,
    expect: 'ERR_PERMISSION_DENIED',
  },
];
