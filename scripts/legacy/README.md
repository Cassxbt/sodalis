# Superseded scripts

These created earlier versions of the testnet deployment. They no longer describe how the live system works:
- `1_publish.mjs` deploys the pre-flight contract.
- `2_secret.mjs` stores an admin-owned secret; the guild now owns its own (see `../7_rekey.mjs`).
- `3_setup.mjs` and `make_live.py` use a demo DKIM key that was removed from the live guild.
- `5_direct_attack.mjs` is replaced by the recorded attacks in the README.

They are kept only so the history in RECEIPTS.md can be traced. The live state comes from `1_deploy.mjs`, then `6_migrate.mjs`, `7_rekey.mjs`, `8_v4.mjs` and `9_v4_evidence.mjs`.
