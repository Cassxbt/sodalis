# Sodalis

**Prove you belong. Never say who you are.**

> *An illustration.* Maya's car breaks down three days before payday. Her team keeps a small fund for exactly this. But asking means telling the colleagues who run it that she's short this month. So she doesn't ask.

**Sodalis is a team fund on NEAR that people can ask for help without anyone learning who asked.** A member proves they belong with an email from an approved domain; the email is opened only inside an attested enclave, and the chain records a domain and a keyed fingerprint, never the address. One mailbox earns one seat in a Sputnik DAO treasury. Payouts run in **rounds the chain enforces**: a budget per round, an allowance per seat, a steward's approval, and every payment on chain. When a member leaves, their access ends.

On testnet, one member's whole journey (a builder test account) is on chain and re-checked live at **[/case](https://sodalis-red.vercel.app/case/)**: it joined privately, asked for 0.05 NEAR and was paid, was refused 0.06 more for going past its allowance, was refused for trying to skip the round, had a request turned down and returned to the round, then left, lost its DAO seat, and was refused when it asked again.

An organisation domain proves membership of that organisation. A free-mail domain (Gmail, Proton) proves only control of one mailbox, so free mail reaches only the `public` tier, which can ask for payouts but not approve them.

**Live:** https://sodalis-red.vercel.app · **[Follow one member](https://sodalis-red.vercel.app/case/)** · **[Verify the round](https://sodalis-red.vercel.app/proof/#the-round)** · **[Proof](https://sodalis-red.vercel.app/proof/)** · **[Join](https://sodalis-red.vercel.app/join/)** · **[Break it](https://sodalis-red.vercel.app/judges/)** · **[How it works](https://sodalis-red.vercel.app/how/)**

![tracks](https://img.shields.io/badge/tracks-social%20%C2%B7%20privacy-c9a45c) ![network](https://img.shields.io/badge/network-NEAR%20testnet-2c6b5a) ![contract tests](https://img.shields.io/badge/contract%20tests-56-2c6b5a) ![verifier cases](https://img.shields.io/badge/verifier%20cases-43-2c6b5a) ![live checks](https://img.shields.io/badge/npm%20test-27-2c6b5a) ![license](https://img.shields.io/badge/license-MIT-lightgrey)

| | |
|---|---|
| **Fastest proof** | Open [/proof](https://sodalis-red.vercel.app/proof/). Your browser re-verifies every admission from NEAR testnet, OutLayer's attestation API and Intel's collateral. Then press **Forge one byte** and watch the ledger turn red. |
| **Fastest join** | Open [/join](https://sodalis-red.vercel.app/join/). The page makes a fresh key, the guild drip funds it, and one email from an approved domain seats it. [This seat](https://testnet.nearblocks.io/txns/CyJABomVCPUED5nBGaDXx6y2kXG4mWejYWsyrtLxkRoY) was taken that way. |
| **Fastest attack** | Open [/judges](https://sodalis-red.vercel.app/judges/). Thirteen real attempts against the live guild, each re-read from chain with its refusal. |
| **Status** | Live on **NEAR testnet**. Real emails (Proton, Gmail, and a custom domain on Hostinger). All members belong to the builder (three joined; one has since left): the rules are proven, independent use is not. See [What is real](#what-is-real). |

## What it does

```
your fresh wallet ─► challenge subject = sha256(guild:wallet:salt) + expiry
your work mailbox ─► sends it; your mail host signs it (DKIM)
your browser      ─► drops unsigned headers, seals the email to the guild's inbox key
sodalis.testnet   ─► join(): asks OutLayer to run the pinned verifier in Intel TDX
the enclave       ─► checks signature, domain, subject, expiry → returns HMAC(mailbox) under a secret nobody has seen
sodalis.testnet   ─► fingerprint unused? record member, propose + approve the DAO seat, same transaction
```

One mechanism: a **sealed letter opened only inside an attested enclave**. The output is a domain and a keyed fingerprint. The fingerprint admits one wallet per admission epoch: one seat per normalised mailbox, not per person. Only a `reset` signed by the guild account itself starts a new epoch with an empty spent set; v4 began the current one (see [RECEIPTS](RECEIPTS.md)). Tiers come from the domain: `staff` may approve payouts and `public` may not.

Money moves in **payout rounds**. The DAO opens a round with a budget and the same allowance for every seat. A member asks the guild (`request_payout`), which refuses anything past the seat's allowance or the round's budget, reserves the amount and files the DAO transfer itself; the DAO's policy lets members file transfers only through the guild, so a member cannot skip a round (the council, which governs the DAO, still can). Staff decide; anyone can `settle` a request once the DAO has recorded its decision, which books it as approved or returns the reservation when the DAO rejected, expired or removed it. An undecided request stays reserved.

## Verify it yourself

```bash
git clone https://github.com/Cassxbt/sodalis && cd sodalis && npm ci

npm test               # 27 tests: re-reads every admission, refusal and payout from testnet, plus offline sealing checks
npm run verify:build   # rebuilds the verifier and the guild contract; checks both against the chain
npm run test:contract  # 56 contract tests (Rust, offline)
npm run test:verifier  # 43 verifier cases: DKIM attack patterns and edge cases on signed test emails (offline)
```

`npm run verify:build` exits non-zero if the source and the chain disagree. Expected output:

```
verifier (runs in the enclave)
  rebuilt from source    9c0ef7f327e5eebb38540f15ea773c70dc63977b267bdb0d28c696ca5aad291f
  pinned by sodalis.testnet  9c0ef7f327e5eebb38540f15ea773c70dc63977b267bdb0d28c696ca5aad291f
  served by FastFS       9c0ef7f327e5eebb38540f15ea773c70dc63977b267bdb0d28c696ca5aad291f
guild contract
  rebuilt from source    B8EywgDtj7UaXmYNDknso8bZAKNjavRwi7geULrG9kak
  deployed at sodalis.testnet B8EywgDtj7UaXmYNDknso8bZAKNjavRwi7geULrG9kak
MATCH: the guild runs exactly this source, on chain and in the enclave.
```

Requirements: Node 22+ and Rust (the toolchain is pinned to 1.99.1 in `rust-toolchain.toml` with the `wasm32-wasip1` and `wasm32-unknown-unknown` targets). The live tests need network access. No keys, wallet or funds are needed for anything above.

## What a member reveals

| Step on [/join](https://sodalis-red.vercel.app/join/) | Public on testnet | Seen by |
|---|---|---|
| Fund the key | The guild drip funded this key, and when | The site's host sees the visitor's IP address |
| Send the challenge | Nothing | The member's mail provider and the inbox it was sent to |
| Join | The key, the domain, a keyed fingerprint of the address, the sealed bytes, the tier and the time | Only the enclave opens the email |
| Ask the treasury | Amount, a fixed category and every vote. There is no free-text field. | Everyone: the page shows the exact public text before filing |

## Evidence: allowed and refused

Guild `sodalis.testnet` · DAO `sodalis-dao.sputnik-v2.testnet` · explorer links via [nearblocks](https://testnet.nearblocks.io).

| What happened | Result | Tx |
|---|---|---|
| A real email from a custom domain (`d=trendtwin.xyz`) joins | Seated as **staff**, DAO proposal #0 approved by the guild | [`AkSAiijE…`](https://testnet.nearblocks.io/txns/AkSAiijEq17NBYu1Heh82hU8uEXpR5t2quhBhXefqYUk) |
| A real Proton email (`d=proton.me`) joins | Seated as **public**, proposal #1 | [`B4aqUCYV…`](https://testnet.nearblocks.io/txns/B4aqUCYVAytpX6Tv25YcFQhNc7UMSedmb5YED6CRifkL) |
| A fresh browser key joins from the live [/join](https://sodalis-red.vercel.app/join/) page with a Gmail-signed email | Seated as **public**, proposal #3; every check passes in the page | [`CyJABomV…`](https://testnet.nearblocks.io/txns/CyJABomVCPUED5nBGaDXx6y2kXG4mWejYWsyrtLxkRoY) |
| The same mailbox signs a fresh, valid challenge for a second wallet | **Refused**: `this email address already admitted a member` | [`FdBzomLr…`](https://testnet.nearblocks.io/txns/FdBzomLry7UaV3jLiNdVFJPUKVcjNgqZS38aYQonPWio) |
| Another wallet replays a member's sealed email | **Refused**: `challenge is bound to a different wallet or guild` | [`9Xtf5tXu…`](https://testnet.nearblocks.io/txns/9Xtf5tXumh1jyaPvJ45Dk93QcQufiEfYFbM6T7AZStLC) |
| A join names a domain the DAO never approved | **Refused** by the contract before any TEE run | [`6voLAUxc…`](https://testnet.nearblocks.io/txns/6voLAUxcoQkpJs35SGKfpocwqvMmczfQJ94FqBAQqKYN) |
| An outside account calls OutLayer with the guild's secret | **Refused** by the keystore: `Access denied by access condition` | [`2R1cfdGX…`](https://testnet.nearblocks.io/txns/2R1cfdGXAFoPRNTMLLtsTA2QaJji7j8oJ9vzvgH44NpW) |
| An outside account calls the guild's one-time `reset` | **Refused**: `Method reset is private` | [`DP9VHiGR…`](https://testnet.nearblocks.io/txns/DP9VHiGRGerz8G6HNpnqY2GHggQXpZhfRp85wsGDKj6k) |
| The former owner tries to pin a DKIM key after handing the guild to the DAO | **Refused**: `owner only` | [`FvyF4rdu…`](https://testnet.nearblocks.io/txns/FvyF4rdu6NweHTG5VPQi4SuXX8aaUQh2eRWWriCfxCa1) |
| **Round 1:** a public member asks the guild for 0.05 NEAR | The guild files proposal #7 | [`Euo7rGtk…`](https://testnet.nearblocks.io/txns/Euo7rGtkxqSQ2VMWHEbQntjEM5FvhriGXNcdA4e6yJY9) |
| They ask for 0.06 more, past the seat's 0.1 allowance | **Refused** by the guild: `exceeds your allowance in this round` | [`GZkwDr3b…`](https://testnet.nearblocks.io/txns/GZkwDr3bSTsR5QP3Cz8AKCbVbQjrRNvehojsxwnVv4ab) |
| They file a transfer straight with the DAO | **Refused** by the DAO policy: `ERR_PERMISSION_DENIED` | [`BcBnvJMu…`](https://testnet.nearblocks.io/txns/BcBnvJMu78hz64jS7C4CM92bCHeDpLvxjkp5V3P9VYPf) |
| An account with no seat asks the guild | **Refused**: `only seated members may request a payout` | [`F2FiyoQ7…`](https://testnet.nearblocks.io/txns/F2FiyoQ7ZfZzuFsddeiy1yhmcF3zE3fb4FBQ2bpa155n) |
| Staff approve #7 | Approved; the receipt shows exactly 0.05 NEAR from the DAO | [`qLiFNjgb…`](https://testnet.nearblocks.io/txns/qLiFNjgbnNbh9sCu9HV1JG16ZgfjxzNWkhA13kKZkzd) |
| Anyone settles #7 | The round records 0.05 approved; the seat has 0.05 left | [`GFFV57cM…`](https://testnet.nearblocks.io/txns/GFFV57cMe8FZ6qFBPCodRYCTqz1NA8uAnCjq1ctgAcft) |
| **Round 2** (0.15 NEAR, 0.1 per seat): a public member asks for its whole 0.1 | The guild files proposal #9 | [`Gxzr384c…`](https://testnet.nearblocks.io/txns/Gxzr384ccmPtExYsNw5fEq2xK5jqHuQRAoEb7n852CVG) |
| A staff member with its whole allowance left asks for 0.06; the pot has 0.05 | **Refused**: `exceeds the round's remaining budget` | [`5nuDd6fU…`](https://testnet.nearblocks.io/txns/5nuDd6fUrj9bmavkJxahT7wfk5iTH4EAgP3kbZrFfSt2) |
| Staff reject #9, then anyone settles it | Rejected; settle returns the 0.1 to the round | [`STY4fGnh…`](https://testnet.nearblocks.io/txns/STY4fGnhYdaMkCTBjRzJ5wqMWvdHhdshnpkhDDqr9Bq) · [`7hzcL4Qr…`](https://testnet.nearblocks.io/txns/7hzcL4Qr8gUaYhmWDiVGj9a3zuUiQGsyiF65yBedFBeE) |
| Settle #9 a second time | **Refused**: `this request is already settled` | [`BZz83MP8…`](https://testnet.nearblocks.io/txns/BZz83MP86L1pCGxHTbZsDpgC8NvdG32JUWEHLVU2u2xX) |
| The member leaves the guild | Its DAO seat is removed in the same transaction | [`CmKnfQ1C…`](https://testnet.nearblocks.io/txns/CmKnfQ1CKk16ZK5zKiKA1szYLTEh8HSkZXx7e5TQxuDD) |
| It asks again | **Refused**: `only seated members may request a payout` | [`B4JU3VFS…`](https://testnet.nearblocks.io/txns/B4JU3VFSzRg6mbyHRKqfqC61yrRmruuB4XCmAEGJxwj2) |
| *Before rounds:* a public member proposes a 0.05 NEAR payout | Proposal #2 | [`JDzowcGA…`](https://testnet.nearblocks.io/txns/JDzowcGAH3GMVjRFGUiZVbMUBHpgMmWPqysj1NiLC2ad) |
| They try to approve it themselves | **Refused** by the DAO: `ERR_PERMISSION_DENIED` | [`7aCd3oqj…`](https://testnet.nearblocks.io/txns/7aCd3oqjPuqGASxrCdADdcxkbLvPerzZKNtMxecEsh8G) |
| A staff member approves it | Approved; the receipt shows exactly 0.05 NEAR from the DAO | [`4kWLrJob…`](https://testnet.nearblocks.io/txns/4kWLrJobyVEwmXN55p2SaXWPU6xeF5szhJASGBcsuGkK) |

Every row is re-checked by `npm test` and by the site. The full deployment history, including two earlier versions and why each changed, is in [RECEIPTS.md](RECEIPTS.md).

### What the attestation check proves

For each join, [`web/src/attest.js`](web/src/attest.js) checks, from public data only:

1. Intel signed the TDX quote; the DCAP chain and TCB status are `UpToDate`.
2. The worker's five measurements are on OutLayer's approved list (`worker.outlayer.testnet.is_measurements_approved`).
3. The quote's `report_data` equals the task hash recomputed from the attestation fields.
4. The guild itself requested the run.
5. The code that ran is the verifier the guild requested in that transaction, so old proofs survive upgrades.
6. It ran on the input recorded on chain.
7. The guild acted on exactly the output the enclave produced.
8. The guild admitted the wallet the verifier checked, with the nullifier the verifier derived.
9. The DAO approved exactly that seat.

There is no client nonce. Freshness comes from the quote's binding to the block height and transaction.

## Why NEAR

Remove any of these and the mechanism stops working:

| Primitive | Its job in Sodalis | Where |
|---|---|---|
| **OutLayer** `request_execution` with yield/resume | The contract calls the enclave and acts on its answer in the same transaction. No backend sits between proof and seat. | `contract/src/lib.rs` (`join`, `on_verified`) |
| **OutLayer** keystore, WasmHash-bound secrets with a `Predecessor` rule | The guild master is generated inside the keystore, released only to one verifier build, only on runs the guild requests, and **owned by the guild account**. Once the guild's keys are deleted, nobody can replace it. | `scripts/7_rekey.mjs`, `verifier/src/main.rs` (`master`) |
| **OutLayer** per-execution TDX attestation | Lets anyone check that the enclave ran this code on this input and produced this output. | `web/src/attest.js` |
| **Sputnik DAO** roles and policy | Tiers are DAO roles. The guild holds a `gatekeeper` role that can add or remove members and file round transfers; only staff or the council can approve one. The same DAO factory Trezu uses (`sputnik-v2.testnet`). | `scripts/1_deploy.mjs`, `scripts/6_migrate.mjs` |
| **FastFS** | Serves the verifier by content hash, so the guild pins code, not a URL. | `scripts/6_migrate.mjs` |
| **NEP-366** meta-transactions | The member is whoever calls `join`, not whoever pays gas, so a relayer can sponsor a brand-new wallet with no funding trail. Tested; no relayer is deployed (the live Join page uses a guild drip). | `contract/src/tests.rs`, `scripts/local_test.mjs` |

## Trust model

| Party | Could | Stopped by |
|---|---|---|
| Your mail host | Sign mail for any address on its domain | Nothing. DKIM trusts the domain's mail host, as email does. |
| OutLayer operator | Withhold or delay a run | Cannot forge one with an approved image: the quote binds code, input and output. |
| OutLayer's register owner | Approve a malicious worker image | The approved list is public and the proof page shows which image ran. **This is the deepest trust assumption.** |
| DAO council (`sodalis-council.testnet`, the builder) | Add or remove an approved domain, change policy, open rounds, file and approve payouts outside a round | Every change is a public proposal. A sealed issuer list takes no new key. |
| Builder | Redeploy the guild while its account still has a key | The key is deleted as the last step before submission (see below). |
| Chain readers | See the domain, the wallet and a fingerprint | The fingerprint is keyed by a master that never leaves the enclave, so a guessed address cannot be tested against it. |

## What is real

| Claim | State |
|---|---|
| A real DKIM email from an approved domain earns a DAO seat | **On chain** |
| One mailbox, one seat | **On chain** (Sybil attempt refused) |
| Public members only ask for payouts; staff approve them (the council can too) | **On chain** |
| Per-seat allowance and round budget | **On chain**: round 1 refused a request past the allowance, round 2 one past the budget; a member's DAO bypass refused |
| Leaving ends spending authority | **On chain**: a member left, lost its DAO seat in the same transaction, and its next request was refused |
| An undecided or failed payout returns its reservation | **Partly**: a rejection returned exactly once on chain; an undecided request stays reserved until the DAO records an outcome, and one that ends `Failed` stays reserved |
| A staff member cannot approve their own request | **Not provided**: Sputnik cannot tell the receiver from the voter, and this guild has one staff member. A guild with several staff should require two approvals |
| The enclave run is attested and bound to code, input and output | **On chain**, checked in the browser |
| A fresh browser key can join with no wallet | **On chain**: the [/join](https://sodalis-red.vercel.app/join/) page seated one, run by the builder |
| A relayer can pay gas for a brand-new wallet | **In tests**. The live Join page funds new keys with a visible 0.3 NEAR drip from `sodalis-drip.testnet` instead |
| A member's wallet cannot be linked to their email | **Designed**: the chain holds only a domain and a keyed fingerprint, but the demo members are the builder's own accounts |
| Independent people govern a real treasury | **Not done**: all members belong to the builder (three joined; one has since left) |
| Guild key deleted, issuer list sealed | **Not done yet**: held until the final review, then the guild account's keys are deleted and the DAO seals the issuer list |
| Forward secrecy for sealed letters | **Not provided**: letters stay on chain, and a future leak of the master would open them |
| Seat recovery after a lost wallet | **Not provided**: a spent mailbox cannot rejoin |
| OutLayer testnet availability | **Observed outages**: some runs got no answer within the 200-block window. The contract refunds the joiner and nothing is admitted; a retry worked each time |

Three lessons from testing shaped the design. Gmail does not DKIM-sign mail you send to yourself, so the challenge goes to any other address. OutLayer lets a secret's owner replace it, so the guild account owns its own secret. And a reset must never reuse storage prefixes: v3 did, and its issuer list stopped enumerating, so every init now stamps its prefixes with its block height. v4 also moved to a new DAO after the v3 council key was lost (see RECEIPTS.md).

## Project layout

```
contract/   NEAR guild contract (near-sdk 5.29.1): join, tiers, DAO seating, payout rounds, sealing, 56 tests
verifier/   enclave program (Rust → wasm32-wasip1): DKIM, sealing, nullifier
web/        the site: Vite multi-page, attestation checks in the browser
test/       live tests against testnet (npm test)
fixtures/   signed test emails (keys generated locally at test time, never trusted on chain)
scripts/    deploy, migrate and re-key scripts used to create the testnet state (need the builder's keys)
```

## Built with

Everything here was written within the hackathon window (Q-001: code from 2026-10-19 counts); there is no pre-hackathon code. Libraries:
- **Rust:** `near-sdk`, `rsa`, `sha2`, `hmac`, `hkdf`, `x25519-dalek`, `chacha20poly1305`, `base64`, `serde`.
- **JS:** `near-api-js`, `@noble/curves`, `@noble/ciphers`, `@noble/hashes`, `@phala/dcap-qvl` 0.7.0 (Intel DCAP verification; patched for GHSA-796p-j2gh-9m2q), `vite`.
- **Python (fixtures only):** `dkimpy`.

The code was written with Claude Code.

## Hackathon

Built at **NEAR HACKATHON** by **cassxbt** for the **Social Money** and **Privacy & Private AI** tracks. cassxbt's other entry is **Vestigia**, a separate project that shows what a NEAR Intents swap reveals about your wallets before you sign (link added when it ships).

MIT licensed, see [LICENSE](LICENSE).
