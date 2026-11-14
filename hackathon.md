# Sodalis at NEAR HACKATHON

The judge's file: how Sodalis fits its two tracks, how to check that it runs and does what the README says, and where each judging dimension can be checked. Every claim points to a page, a command or a file.

**Live** https://sodalis-red.vercel.app · **Repo** https://github.com/Cassxbt/sodalis · **Demo video** https://youtu.be/Obe4K6lmxzU · **Network** NEAR testnet

## Tracks

| Track | The brief | How Sodalis answers it | Check it |
|---|---|---|---|
| **Social Money** (`social`) | "Build shared budgets, programmable rewards, collective ownership and reputation-based access on top of Sputnik DAO and Trezu. Don't rebuild the multisig — build what communities do with it." | A shared budget a community actually runs: access earned by proving membership, a round with a budget and a per-seat allowance the chain enforces, steward approval, and removal by a DAO vote. Sputnik's multisig is used as is; Sodalis adds the access and spending rules around it. | [/case](https://sodalis-red.vercel.app/case/?case=removed): paid, refused past the allowance, removed by vote, refused after. `contract/src/round.rs` |
| **Privacy & Private AI** (`privacy`) | "Explore confidential computation, private finance and AI that protects sensitive data. Build intelligence without exposure." | Confidential computation decides who belongs. A sealed email is opened only inside an OutLayer TEE (Intel TDX), and the public record keeps a domain and a keyed fingerprint, never the address. Every enclave run is attested and re-checked in the browser. | [/proof](https://sodalis-red.vercel.app/proof/): twelve checks per admission; **Forge one byte** turns it red. `verifier/src/main.rs`, `web/src/attest.js` |

## It runs

No keys, wallet or funds are needed for anything here.

| Do | See |
|---|---|
| `git clone https://github.com/Cassxbt/sodalis && cd sodalis && npm ci` | A clean install (Node 22+, Rust pinned in `rust-toolchain.toml`) |
| `npm test` | 29 tests pass: 24 re-read the recorded admissions, refusals and payouts from testnet; 5 check sealing offline |
| `npm run test:contract` | 56 contract tests pass |
| `npm run test:verifier` | 43 verifier checks pass: 34 signed-email cases plus 9 enclave-environment checks |
| `npm run verify:build` | `MATCH`: the verifier and the guild contract rebuild byte for byte to what is deployed and pinned |
| Open https://sodalis-red.vercel.app | The home page re-reads three outcomes from chain: paid, refused past the allowance, refused after leaving |

[CI](https://github.com/Cassxbt/sodalis/actions/workflows/ci.yml) runs the contract tests, the verifier checks, the live chain checks and the site build on every push.

## It does what the README says

| Claim | Where to check |
|---|---|
| A real DKIM email earns a DAO seat without its address being published | [/case](https://sodalis-red.vercel.app/case/?case=first-user), first step; README "Live testnet proof" |
| One mailbox, one seat | [/judges](https://sodalis-red.vercel.app/judges/), "One mailbox, two seats" |
| The guild refuses requests past a seat's allowance or a round's budget | [/judges](https://sodalis-red.vercel.app/judges/), "Ask past your allowance" and "Ask past the round's budget" |
| Members cannot skip the round | [/judges](https://sodalis-red.vercel.app/judges/), "Skip the round" |
| Approved requests are paid exactly, once | [/proof](https://sodalis-red.vercel.app/proof/#the-round), round 1; [/case](https://sodalis-red.vercel.app/case/?case=first-user), step two |
| Leaving, or removal by a DAO vote, ends spending authority | [/case](https://sodalis-red.vercel.app/case/?case=removed) and [/case](https://sodalis-red.vercel.app/case/?case=departure) |
| A first-time user completed the flow | [/case](https://sodalis-red.vercel.app/case/?case=first-user); README "What a first-time user told us" |

## The five dimensions

The organizer's FAQ names the dimensions previous NEAR hackathons used: technical implementation, design, impact, originality and sustainability.

| Dimension | Evidence | Honest limit |
|---|---|---|
| **Technical implementation** | A contract that calls an enclave and acts on its answer in one transaction; attested runs re-verified in the browser against Intel's collateral; reproducible builds; 56 contract tests, 43 verifier checks, 29 live checks | One filing failure mode (a callback that never records an id) is disclosed, not handled |
| **Design** | A judge can verify a whole member journey on one page with no wallet; the Join page needs no wallet either; requests show their exact public text before filing | Joining needs two inboxes and saving an email as a file, which a first-time user found confusing without a guide |
| **Impact** | A first-time user joined and was paid from their own tablet; the rules map onto team hardship and mutual-aid funds | One guided participant; no team has run its own fund on Sodalis yet |
| **Originality** | Private first admission (no prior enrolment) that changes who may ask a real treasury, with chain-enforced allowances and removal | Confidential compute, DKIM proofs and DAO budgets each exist elsewhere; the combination is the contribution |
| **Sustainability** | Open source, MIT; verifiable builds; a public `settle` anyone can call; the DAO owns the guild | The steward and council are the builder's; the guild key is held until a failed seat removal and its repair are rehearsed |

## Rules

| Rule | Status |
|---|---|
| Code written in the window (Q-001, from 2026-10-19) | Yes: all code was written during the window |
| Existing product on another chain (Q-002) | Not applicable |
| Hosted demo kept up (Q-012) | https://sodalis-red.vercel.app stays up through judging |
| Licence (Q-014) | MIT, [LICENSE](LICENSE) |
| Other projects by the same person (Q-015) | None submitted |
| Repository public, demo post on X with @NEARProtocol and #NEARHackathon | Done at submission |
| No secrets in the repository | Keys live outside the repository; the drip's key is a hosting environment variable |
| Testnet | Allowed; everything here runs on NEAR testnet |

## What is not done

The full list is the README's [honesty table](README.md#what-is-real-vs-pending-the-honesty-table). The five a judge is most likely to ask about:

1. No team has yet run its own fund on Sodalis; the steward and council are the builder's accounts.
2. A staff member could approve a request paid to themselves; with several staff, a guild should require two approvals.
3. Gmail and Proton prove control of one mailbox, not membership of a team; an organisation domain is the stronger eligibility rule.
4. A filing whose callback never records a proposal id keeps its reservation with no record to reconcile.
5. The guild account still holds a key, and the issuer list is not sealed, on purpose.
