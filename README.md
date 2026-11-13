# Sodalis

**Prove you work there. Never say who you are.**

Communities that want to pay their members face a bad choice. Verifying members means a council that knows every name and employer. Staying anonymous means one person with ten wallets takes ten shares. Sodalis is a NEAR guild where **an email from an approved domain earns a seat in a Sputnik DAO treasury, one mailbox buys one seat, and the chain never learns which mailbox.**

An organisation domain proves membership of that organisation. A free-mail domain (Gmail, Proton) proves only control of one mailbox, so free mail reaches only the `public` tier, which can propose payouts but not approve them.

**Live:** https://sodalis-red.vercel.app · **[Proof](https://sodalis-red.vercel.app/proof/)** · **[Break it](https://sodalis-red.vercel.app/judges/)** · **[How it works](https://sodalis-red.vercel.app/how/)**

![tracks](https://img.shields.io/badge/tracks-social%20%C2%B7%20privacy-c9a45c) ![network](https://img.shields.io/badge/network-NEAR%20testnet-2c6b5a) ![contract tests](https://img.shields.io/badge/contract%20tests-36-2c6b5a) ![verifier cases](https://img.shields.io/badge/verifier%20cases-43-2c6b5a) ![live checks](https://img.shields.io/badge/live%20chain%20tests-17-2c6b5a) ![license](https://img.shields.io/badge/license-MIT-lightgrey)

| | |
|---|---|
| **Fastest proof** | Open [/proof](https://sodalis-red.vercel.app/proof/). Your browser re-verifies every admission from NEAR testnet, OutLayer's attestation API and Intel's collateral. Then press **Forge one byte** and watch the ledger turn red. |
| **Fastest attack** | Open [/judges](https://sodalis-red.vercel.app/judges/). Seven real attempts against the live guild, each re-read from chain with its refusal. |
| **Status** | Live on **NEAR testnet**. Real emails (Proton, and a custom domain on Hostinger). Both members belong to the builder: the rules are proven, independent use is not. See [What is real](#what-is-real). |

## What it does

```
your fresh wallet ─► challenge subject = sha256(guild:wallet:salt) + expiry
your work mailbox ─► sends it; your mail host signs it (DKIM)
your browser      ─► drops unsigned headers, seals the email to the guild's inbox key
sodalis.testnet   ─► join(): asks OutLayer to run the pinned verifier in Intel TDX
the enclave       ─► checks signature, domain, subject, expiry → returns HMAC(mailbox) under a secret nobody has seen
sodalis.testnet   ─► fingerprint unused? record member, propose + approve the DAO seat, same transaction
```

One mechanism: a **sealed letter opened only inside an attested enclave**. The output is a domain and a keyed fingerprint. The fingerprint admits one wallet, ever. Tiers come from the domain: `staff` may approve payouts and `public` may only propose them.

## Verify it yourself

```bash
git clone https://github.com/Cassxbt/sodalis && cd sodalis && npm ci

npm test               # 17 live tests: re-reads every admission, refusal and payout from testnet
npm run verify:build   # rebuilds the verifier and checks it is byte-identical to what the guild pins
npm run test:contract  # 36 contract tests (Rust, offline)
npm run test:verifier  # 43 verifier cases: DKIM attack patterns and edge cases on signed test emails (offline)
```

`npm run verify:build` exits non-zero if the source and the chain disagree. Expected output:

```
rebuilt from source   9c0ef7f327e5eebb38540f15ea773c70dc63977b267bdb0d28c696ca5aad291f
pinned by sodalis.testnet  9c0ef7f327e5eebb38540f15ea773c70dc63977b267bdb0d28c696ca5aad291f
served by FastFS       9c0ef7f327e5eebb38540f15ea773c70dc63977b267bdb0d28c696ca5aad291f
MATCH: the guild runs exactly this source.
```

Requirements: Node 22+ and Rust (the toolchain is pinned to 1.99.1 in `rust-toolchain.toml` with the `wasm32-wasip1` and `wasm32-unknown-unknown` targets). The live tests need network access. No keys, wallet or funds are needed for anything above.

## Evidence: allowed and refused

Guild `sodalis.testnet` · DAO `sodalis-dao.sputnik-v2.testnet` · explorer links via [nearblocks](https://testnet.nearblocks.io).

| What happened | Result | Tx |
|---|---|---|
| A real email from a custom domain (`d=trendtwin.xyz`) joins | Seated as **staff**, DAO proposal #0 approved by the guild | [`AkSAiijE…`](https://testnet.nearblocks.io/txns/AkSAiijEq17NBYu1Heh82hU8uEXpR5t2quhBhXefqYUk) |
| A real Proton email (`d=proton.me`) joins | Seated as **public**, proposal #1 | [`B4aqUCYV…`](https://testnet.nearblocks.io/txns/B4aqUCYVAytpX6Tv25YcFQhNc7UMSedmb5YED6CRifkL) |
| The same mailbox signs a fresh, valid challenge for a second wallet | **Refused**: `this email address already admitted a member` | [`FdBzomLr…`](https://testnet.nearblocks.io/txns/FdBzomLry7UaV3jLiNdVFJPUKVcjNgqZS38aYQonPWio) |
| Another wallet replays a member's sealed email | **Refused**: `challenge is bound to a different wallet or guild` | [`9Xtf5tXu…`](https://testnet.nearblocks.io/txns/9Xtf5tXumh1jyaPvJ45Dk93QcQufiEfYFbM6T7AZStLC) |
| A join names a domain the DAO never approved | **Refused** by the contract before any TEE run | [`6voLAUxc…`](https://testnet.nearblocks.io/txns/6voLAUxcoQkpJs35SGKfpocwqvMmczfQJ94FqBAQqKYN) |
| An outside account calls OutLayer with the guild's secret | **Refused** by the keystore: `Access denied by access condition` | [`2R1cfdGX…`](https://testnet.nearblocks.io/txns/2R1cfdGXAFoPRNTMLLtsTA2QaJji7j8oJ9vzvgH44NpW) |
| An outside account calls the guild's one-time `reset` | **Refused**: `Method reset is private` | [`DP9VHiGR…`](https://testnet.nearblocks.io/txns/DP9VHiGRGerz8G6HNpnqY2GHggQXpZhfRp85wsGDKj6k) |
| The former owner tries to pin a DKIM key after handing the guild to the DAO | **Refused**: `owner only` | [`FvyF4rdu…`](https://testnet.nearblocks.io/txns/FvyF4rdu6NweHTG5VPQi4SuXX8aaUQh2eRWWriCfxCa1) |
| A public member proposes a 0.05 NEAR payout | Proposal #2 | [`JDzowcGA…`](https://testnet.nearblocks.io/txns/JDzowcGAH3GMVjRFGUiZVbMUBHpgMmWPqysj1NiLC2ad) |
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
| **Sputnik DAO** roles and policy | Tiers are DAO roles. The guild holds a `gatekeeper` role that can only add or remove members; spending stays with the DAO. The same DAO factory Trezu uses (`sputnik-v2.testnet`). | `scripts/1_deploy.mjs`, `scripts/6_migrate.mjs` |
| **FastFS** | Serves the verifier by content hash, so the guild pins code, not a URL. | `scripts/6_migrate.mjs` |
| **NEP-366** meta-transactions | The member is whoever calls `join`, not whoever pays gas, so a relayer can sponsor a brand-new wallet with no funding trail. Tested; no relayer is deployed. | `contract/src/tests.rs`, `scripts/local_test.mjs` |

## Trust model

| Party | Could | Stopped by |
|---|---|---|
| Your mail host | Sign mail for any address on its domain | Nothing. DKIM trusts the domain's mail host, as email does. |
| OutLayer operator | Withhold or delay a run | Cannot forge one with an approved image: the quote binds code, input and output. |
| OutLayer's register owner | Approve a malicious worker image | The approved list is public and the proof page shows which image ran. **This is the deepest trust assumption.** |
| DAO council (`sodalis-council.testnet`, the builder) | Add or remove an approved domain, change policy, approve payouts | Every change is a public proposal. A sealed issuer list takes no new key. |
| Builder | Redeploy the guild while its account still has a key | The key is deleted as the last step before submission (see below). |
| Chain readers | See the domain, the wallet and a fingerprint | The fingerprint is keyed by a master that never leaves the enclave, so a guessed address cannot be tested against it. |

## What is real

| Claim | State |
|---|---|
| A real DKIM email from an approved domain earns a DAO seat | **On chain** |
| One mailbox, one seat | **On chain** (Sybil attempt refused) |
| Public members only propose payouts; staff approve them (the council can too) | **On chain** |
| The enclave run is attested and bound to code, input and output | **On chain**, checked in the browser |
| A relayer can pay gas for a brand-new wallet | **In tests**, no relayer deployed |
| A member's wallet cannot be linked to their email | **Designed**: the chain holds only a domain and a keyed fingerprint, but the demo members are the builder's own subaccounts |
| Independent people govern a real treasury | **Not done**: both members belong to the builder |
| Guild key deleted, issuer list sealed | **Not done yet**: held until the final review, then the guild account's keys are deleted and the DAO seals the issuer list |
| Forward secrecy for sealed letters | **Not provided**: letters stay on chain, and a future leak of the master would open them |
| Seat recovery after a lost wallet | **Not provided**: a spent mailbox cannot rejoin |
| Spending caps per tier | **Not provided**: Sputnik has no amount limits; staff or the council approve each payout |
| OutLayer testnet availability | **Observed outages**: some runs got no answer within the 200-block window. The contract refunds the joiner and nothing is admitted; a retry worked each time |

Three lessons from testing shaped the design. Gmail does not DKIM-sign mail you send to yourself, so the challenge goes to any other address. OutLayer lets a secret's owner replace it, so the guild account owns its own secret. And a reset must never reuse storage prefixes: v3 did, and its issuer list stopped enumerating, so every init now stamps its prefixes with its block height. v4 also moved to a new DAO after the v3 council key was lost (see RECEIPTS.md).

## Project layout

```
contract/   NEAR guild contract (near-sdk 5.29.1): join, tiers, DAO seating, sealing, 36 tests
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
