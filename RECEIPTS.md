# Sodalis receipts (NEAR testnet)

Guild `sodalis.testnet` · DAO `sodalis.sputnik-v2.testnet` (Sputnik v2.0.0, the factory Trezu uses on testnet) · verifier sha256 `dea3b17844cf50145f89aacb56bc14fdb65a426f8eaf94957f82ac1e9bdfab40`. The verifier rebuilds from `verifier/` to the same hash.

## Setup

| Step | Tx |
|---|---|
| Verifier upload (FastFS). The tx shows Failure ("Exceeded the prepaid gas") because the script attaches 1 gas on purpose. FastFS serves files from the call arguments, and the served file hashes to `dea3b178…`. | 7MvFCekK2t7vwjjmemcdggS4KJDUs5tPtUEc6cxEkZpE |
| Create `sodalis.testnet` | NtCzAbWMTP3FrCMK7oJqMJQje3HEt4WenA8Lic8hGrc |
| Create DAO: roles council, gatekeeper = [sodalis.testnet], members = [] | CXRBQsLJMCyqN5CBBMmNzKzErDzKVkHBCjfZG4Mia66Y |
| Deploy + init guild | 3SzStWrxxBkWU1qCsrxGvnCsJG9LihpnFGrnbjSUzYS6 |
| TEE-generated guild master (Predecessor = sodalis.testnet) | GkibKYEGxXgQsgwXuRfDpthUtHJJ8cTXagv7AZmKJ6tD |
| Pin demo domain corp.example | EVpPXRDPLoqgXDjQ3XTxmeEhwY2CKJWcw4FZN9sF6m67 |
| Pin proton.me / protonmail2 | 47uwbf1HYA1u2WuNQ26Lng8RuQ9YQp216USYS1M2tq7D |
| Pin gmail.com / 20260707 | 2p9iTmdNwgbiECGntqwiVhvU1HNyw8L5KkSmZiKeX4Z7 |
| Inbox key from the TEE (two earlier attempts timed out at OutLayer's 200-block yield window, with no worker answer) | 8HSEpAze1bHVvnafvMg8ir3UxN6bFskxqJcYTts9TcYQ |

## Live cases

| Case | Result | Tx |
|---|---|---|
| m1 joins with a demo-domain email | Joined, and seated in DAO `members` through proposal #0 (proposer sodalis.testnet, status Approved), all in one tx, 0.0087 NEAR | EyhVeNVmvZNDrt3WKxjpJuqVitx4oEubdfWgPwrFUbdD |
| m2 replays m1's sealed email | Refused: "challenge is bound to a different wallet or guild"; no DAO call | 3FSuuFcLfmbVzs7wMFiP7uEo3sUmDh969hUbPZfkJmSJ |
| m1 (verified, unlinkable) asks the treasury for 0.05 NEAR | Proposal #1 | 9W1x57Wjp2Nx7qhvzSK4TMBH5WmSpGFYh8GdLg5CZHRZ |
| Council approves the payout | Paid; m1 +0.0497 NEAR net of gas | CZyeQMAFiaEjRY5X2MgBPs4THccapV69HJLNozBinXF8 |
| m2 joins with a real Proton-signed email (sent to a Gmail inbox; dkimpy verifies it against live DNS) | Joined, domain proton.me, seated through proposal #2, 0.0089 NEAR | 4UtpbLqmxWyn8h3hVJDA5JmUxCSaEJ8E3BN7QAJPE13e |
| m1 leaves | `member_removed` and `dao_role_removed` in one tx; DAO members = [m2] | 4cMYXRNYU9MKg3PNw2PZtPXHyQ4sVE5QsKVbD1YnJBpc |

## Open

- The guild account still has a full-access key, and the owner is still the admin account. Whoever can change the guild code can unmask members: forge a key, feed the verifier fake emails "from" guessed addresses, and match the fingerprints. The final state must be owner = DAO, no keys, no upgrade method.
- The council can change the DAO policy, including the member list. Such changes are public proposals.
- The contract does not check OutLayer's TEE attestation on chain. Anyone can check it off chain (see below).
- No forward secrecy: sealed letters are public calldata. A later leak of the guild master would open every letter, each holding the full email and its salt.
- The council is a single account (the builder's), so "owner = DAO" still means one party controls governance.
- m1 and m2 are subaccounts of the builder's account, so these receipts do not demonstrate unlinkability.

## Hardening (2026-11-12)

| Step | Tx |
|---|---|
| Demo domain corp.example unpinned: its private key exists locally, so keeping it would let the key holder mint members. The guild now trusts only gmail.com/20260707 and proton.me/protonmail2. | FyCi1NuEDdu5VoATu9LmwUHeKkTSpnX8Fk2sJwE2Wfcw |
| Guild ownership moved to the DAO (`sodalis.sputnik-v2.testnet`) | bRtxP8eLTsWzc5ENhyTmBXS25zGQVBE68YAHurR98Vg |
| Former owner tries to pin a key | Refused: "owner only" — 7y4NYEPncA6jc7evZjhRXh4gyN8zcsAduvVHAyb2mCPm |

Agreed with cassxbt: the guild account's full-access key is deleted as the last step before submission, after the final review. Until then it still exists, and this file says so.

## TEE attestation for the real-email join (checked 2026-11-12)

`GET https://testnet-api.outlayer.ai/attestations/by-tx/4UtpbLqmxWyn8h3hVJDA5JmUxCSaEJ8E3BN7QAJPE13e`, verified by `web/src/attest.js` (`node --test test/attest.live.test.mjs`):

| Check | Result |
|---|---|
| Intel DCAP chain, through Phala PCCS collateral and `@phala/dcap-qvl-web` 0.3.3 | UpToDate, no advisories |
| The quote's five measurements (MRTD, RTMR0-3) pass `worker.outlayer.testnet.is_measurements_approved` | true (a tampered RTMR3 gives false) |
| The quote's `report_data[0..32]` equals the task hash recomputed per `outlayer/worker/src/tdx_attestation.rs` | match |
| `wasm_hash` and `executed_wasm_sha256` equal the verifier pinned in `get_config` | `dea3b178…` |
| `input_hash` equals sha256 of `input_data` in the on-chain `execution_requested` event | match |
| `output_hash` equals sha256 of the result `outlayer.testnet` delivered on chain | match |

Freshness comes from block height 277279029 and the transaction, which the quote binds. There is no client nonce.

## v2 (2026-11-12): tiers, relay-ready joins, sealable issuer list

Verifier sha256 `9c0ef7f327e5eebb38540f15ea773c70dc63977b267bdb0d28c696ca5aad291f`: the joining wallet now comes from the guild, not the tx signer. Contract v2 has 33 tests. An adversarial review ran before the deploy; its stale-seat finding was fixed and tested.

| Step | Tx |
|---|---|
| Verifier upload (FastFS) | CtkAdt9murNKmxAMr2kUjp9YcPo7CRTaCpRqMRjw8VLL |
| New TEE-generated guild master (profile `sodalis-v2`, Predecessor = sodalis.testnet) | 7KNFRYd7i7heufWuFmahifNbFwFVh6Y9MNoUUnvTpF7y |
| Deploy v2 and `reset` in one transaction (signed by the guild account) | 7NDjtRTz2aVviF7dCXKyri79QYqBV291X3CorucSPCG4 |
| `reset` called by an outside account | Refused: "Method reset is private" — 9MTj77ncweDpsYjsYkvYoTkZ6XvewtKLL1vYbXMmM2aP |
| DAO policy: roles `public` (propose) and `staff` (approve payouts); `members` retired | AgJsN1ZJ9hdFTgZ5JZL1pXMHE5dHt2UnWb6oHY8JpTuL |
| Pin gmail.com/20260707 → public (key read from live DNS) | Dryki35Hb9jvfrG1V62zXyUsz4Px3ZuDDy33d89HGdEe |
| Pin proton.me/protonmail2 → public | 4veG2BajJPLoK4DSCHUz3a9tRSkfNPdmR2dvSHjQZK7V |
| Pin trendtwin.xyz/hostingermail-a → staff | HDjHREpkY2gLX71Qo2S4m32LC9S8tCpTp9kp7DrkTxB7 |
| Inbox key from the TEE (`5e1649d7…`) | DDyj3Pdminp6jD9hbWx6nnRBpon7Bd8R2EL7SmGnu4sa |
| Ownership back to the DAO | FHDYGzKP5yRrtGbnWUccyD1bEZ9v9ipEQQoFK1UynGBg |

| Case | Result | Tx |
|---|---|---|
| m2 joins with the real Proton email | Joined as **public**, seated through proposal #5 | 4H9kBLGsHU7vdcmcRnXZZ8FJJxy1Ju1MY5BGE8pJRwUG |
| m1 joins with a real email from a personal mailbox at trendtwin.xyz (d=trendtwin.xyz, s=hostingermail-a, rsa-sha256, Hostinger oversigns headers; dkimpy verifies it against live DNS) | Joined as **staff**, seated through proposal #6. About 0.009 NEAR after gas refunds. | CEz4RhEu4AbDzpJ2teg7b9p9pMdvUJUbyxQV1YtzBWu4 |
| Public member m2 proposes a 0.05 NEAR payout to itself | Proposal #7 | EksrkHFXcW6DG6qv7nsPdvVz54Ed1b9SJj983Fz215vr |
| m2 tries to approve its own payout | Refused by the DAO: `ERR_PERMISSION_DENIED` | 7gn39aaYTFSUHMyYN9R3H6LFrJmUHftPdY1rr7xu5H7h |
| Staff member m1 approves | Approved; the receipt shows exactly 0.05 NEAR from the DAO to m2 | EX4gMjGkXKiufBnuXEKKEasDAELedhb1CXgs96Rjef4Q |

Both members belong to the builder: m1 and m2 are builder subaccounts, and trendtwin.xyz is the builder's domain. These receipts show the mechanics. They do not show independent approvers or unlinkability.

## v3 (2026-11-12): the guild owns its TEE secret

OutLayer lets a secret's owner replace it. A replaced master would derive new nullifiers for old mailboxes and let an email join twice. The secret is now stored by the guild account itself, so it is frozen once the guild's keys are deleted.

| Step | Tx |
|---|---|
| m1 and m2 leave (DAO seats removed) | 7keohSe9NQS1a5NqWWV7Qm6UzA5uVzujqBgNbWi9Mj8A · 2yoMyqVt92gUvsPEXRiNNn5uQzeKMWpZU8haggUjQT6K |
| 0.2 NEAR to the guild for storage | ByW6MmvsbXrHnobXSMPh7nUqp83dSrY2LTEkzY6Srs9g |
| New master generated by the OutLayer keystore and stored **by `sodalis.testnet`** (profile `sodalis-v3`, Predecessor = sodalis.testnet) | 3qNovi3CeLFHFhpkqCoGwy1Qo3DKH9mf7r7ngFpUXDLE |
| Deploy and `reset` in one transaction with `secrets_owner = sodalis.testnet` | ASCXtheMvJS7Gt64z9hNswRetswCUL4HD2iurwxKJ78F |
| Pin gmail.com, proton.me (public) and trendtwin.xyz (staff) from live DNS | H5a2eJ2RTt6YUKB2VXpdSMQU49wrjNqZuz1TN5sDhMG3 · GkdJMuVm68Mxxa22Mfx21K279Q4v3QQbRa4m75jxkzim · 6s7SN7abRhLNxhp7phhUohgKFDEYm1ZzHvkGo7nFaWcz |
| Inbox key from the TEE (`dd77f168…`) | 24SJDm5S4NQoXuiXW29UtjdfKsH5fSNCsuKvCXY6KDX8 |
| Ownership to the DAO | 2XyoktRfSphZ5beRqcKFkEHez4SBJw2Qffw4SwceNx4v |
| m2 rejoins with the real Proton email: **public**, proposal #10 | 85pPVVqYoymT4GJSiqi1Rzne81EihdWschTPtueyrTmJ |
| m1 rejoins with the real trendtwin.xyz email: **staff**, proposal #11 | DaVFDQDR1pAzdDywJTfhGEFKZGq9VjsbmqxtV9dR5h77 |

## v4 (2026-11-13): new DAO, fresh storage, patched attestation check

Why:
- **The v3 DAO lost its council.** The only council key, for `kibble-pf-03c8a9.testnet`, was kept in a temporary folder and deleted, so `sodalis.sputnik-v2.testnet` can no longer change its policy. It is retired.
- **A partner review found that v3's issuer list read empty.** The v3 `reset` reused v2's storage prefixes, so the re-pinned keys were stored but not indexed. Each init now stamps its prefixes with its block height. A contract test reproduces the bug and pins the fix.
- **The browser attestation library `@phala/dcap-qvl-web` ≤0.3.3 has a critical advisory** (GHSA-796p-j2gh-9m2q: missing QE identity verification). It is replaced by `@phala/dcap-qvl` 0.7.0. All admissions were re-verified with it, in Node and in the browser.

The verifier build (`9c0ef7f3…`) and the guild-owned secret (`sodalis-v3`) did not change, so the inbox key is the same.

| Step | Tx |
|---|---|
| m1 and m2 leave the v3 guild (seats removed from the old DAO) | 9YfgwqsiE4pTu21qu3Jbonxi4VxDiPEjtk9SAtLN1bPw · 75Qkp2cGLGYdWc5yvGMYCuJuT3HYLx3i4Be5PX7RdUwp |
| New DAO `sodalis-dao.sputnik-v2.testnet`, council `sodalis-council.testnet` (a faucet-funded account; key kept in `.keys/`) | DMtDu6zWhYf9J9kWRwTBPwsst941Pc3ZhqTPFT1tut3n |
| Guild redeployed and reset onto fresh prefixes, signed by the guild account | 5MZuzQi3PtFu6yUej49cgcgTXNLtB6KVx2osg4KkX8nd |
| Pin gmail.com, proton.me (public) and trendtwin.xyz (staff) from live DNS; `get_domain_keys` lists all three | 32pXq6KkYtp3ZHfQ2Ytn3R7GJ9DGu6nKVqJeMVy2DGa3 · 9hTai7osZyDssBx8WAMv6SyNM2txyGXPk4ydzQFuu2jT · CPJz6RaUjBsBqfaPfUwEJN8cXWfym1cGRUVBZikh8Cq3 |
| Inbox key | GwqRZb7QhJmDLffjjgTzRSRCHc38pfLoD5MxedP1cfMd |
| Ownership to the new DAO | 2dkjuqnojDERn5yyqy91grpZdMbATG9JgfvEc17KyP1j |

| Case | Result | Tx |
|---|---|---|
| m1 rejoins with the real trendtwin.xyz email | **staff**, proposal #0 | AkSAiijEq17NBYu1Heh82hU8uEXpR5t2quhBhXefqYUk |
| m2 rejoins with a new real Proton email (one earlier attempt got no OutLayer answer and was refunded: BSDJcYH8pBHr3NTonoJtLnKm5m6kjdY51TpkBbyTSgr) | **public**, proposal #1 | B4aqUCYVAytpX6Tv25YcFQhNc7UMSedmb5YED6CRifkL |
| m2 proposes a 0.05 NEAR payout | proposal #2 | JDzowcGAH3GMVjRFGUiZVbMUBHpgMmWPqysj1NiLC2ad |
| m2 tries to approve it | Refused: `ERR_PERMISSION_DENIED` | 7aCd3oqjPuqGASxrCdADdcxkbLvPerzZKNtMxecEsh8G |
| m1 (staff) approves | Approved; exactly 0.05 NEAR moves | 4kWLrJobyVEwmXN55p2SaXWPU6xeF5szhJASGBcsuGkK |
| Outsider `eve.sodalis-council.testnet` sends a fresh, valid Proton challenge for itself from m2's mailbox | Refused: `this email address already admitted a member` | FdBzomLry7UaV3jLiNdVFJPUKVcjNgqZS38aYQonPWio |
| eve replays m2's sealed letter | Refused: `challenge is bound to a different wallet or guild` | 9Xtf5tXumh1jyaPvJ45Dk93QcQufiEfYFbM6T7AZStLC |
| eve joins with an unapproved domain | Refused: `has not pinned a key for that domain and selector` | 6voLAUxcoQkpJs35SGKfpocwqvMmczfQJ94FqBAQqKYN |
| eve calls OutLayer directly with the guild's secret | Refused: `Access denied by access condition` | 2R1cfdGXAFoPRNTMLLtsTA2QaJji7j8oJ9vzvgH44NpW |
| eve calls `reset` | Refused: `Method reset is private` | DP9VHiGRGerz8G6HNpnqY2GHggQXpZhfRp85wsGDKj6k |
| The former owner (`sodalis-council.testnet`) pins a key after handing the guild to the DAO | Refused: `owner only` | FvyF4rdu6NweHTG5VPQi4SuXX8aaUQh2eRWWriCfxCa1 |

While the attacks ran, OutLayer testnet gave no answer to four consecutive guild runs (88RynFVf…, DrqXxqrM…, Feq2nUTn…, 2HWSePWb…). Each one was refunded and admitted nobody. A run without a secret, and a guild run from another account, answered minutes later, and the retries above succeeded.

## v4.1 (2026-11-13): a seat taken from the live Join page

The [/join](https://sodalis-red.vercel.app/join/) page was run end to end in Chrome, with no script and no wallet. The page made a fresh implicit key in the browser, the guild drip (`api/drip.js`, a Vercel function holding `sodalis-drip.testnet`) funded it, and a Gmail-signed challenge was sent to a second inbox, saved as `.eml` and uploaded. The browser trimmed it to the signed headers, sealed it to the guild's inbox key and called `join`. The page then re-verified the run: all 11 checks passed.

| Step | Result | Tx |
|---|---|---|
| Drip funds the fresh key `54607a20…e75d` | 0.3 NEAR from `sodalis-drip.testnet` | 4rhzwhGovniA9w2sZAQDQ317BnTYKesQScUgdNq8jqHn |
| The key joins with the Gmail email (d=gmail.com, s=20260707) | **public**, proposal #3 approved by the guild | CyJABomVCPUED5nBGaDXx6y2kXG4mWejYWsyrtLxkRoY |
| The new member asks the treasury for 0.05 NEAR from the page | Proposal #4, in progress: public members cannot approve it | 7pRD8Faehque3KhLNytBiBuYJzoys2BMWHQqYqfV5TTf |

The drip is a visible transfer, so this seat has a funding trail to the guild's own drip account; every member funded this way shares the same one. The Gmail mailbox belongs to the builder, so this seat shows the flow works from a fresh browser key, not that a stranger used it.
