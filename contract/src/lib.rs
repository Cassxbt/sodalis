//! Sodalis: members prove, inside an OutLayer TEE, that they control a mailbox
//! at an approved domain without revealing which one, and are seated in a
//! Sputnik DAO role chosen by that domain's tier.
//!
//! Trust model: the verifier build and its TEE-generated secret are fixed at
//! deploy; only this contract can request its runs; once the issuer list is
//! sealed no DKIM key can be added, since a forged key could test guessed
//! addresses against members' nullifiers.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::{IterableMap, LookupMap, LookupSet};
use near_sdk::{env, near, require, AccountId, Gas, GasWeight, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue};

const EXECUTION_GAS: Gas = Gas::from_tgas(100);
const CALLBACK_GAS: Gas = Gas::from_tgas(20);
/// Includes seating the member in the DAO.
const VERIFIED_GAS: Gas = Gas::from_tgas(110);
const PROPOSE_GAS: Gas = Gas::from_tgas(15);
const ON_PROPOSED_GAS: Gas = Gas::from_tgas(55);
const VOTE_GAS: Gas = Gas::from_tgas(20);
const STATUS_GAS: Gas = Gas::from_tgas(5);
const ON_VOTED_GAS: Gas = Gas::from_tgas(10);
const MAX_SEALED_BYTES: usize = 24_000;
/// Pays for the member and nullifier records; refunded if the join is refused.
const STORAGE_FEE: NearToken = NearToken::from_millinear(5);
const GOVERNING_ROLES: [&str; 2] = ["council", "gatekeeper"];

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Verifier {
    pub url: String,
    pub hash: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct DomainKey {
    pub key_p: String,
    pub role: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Member {
    pub domain: String,
    pub role: String,
    pub joined_at_ms: u64,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub outlayer: AccountId,
    pub verifier: Verifier,
    pub secrets_owner: AccountId,
    pub secrets_profile: String,
    pub inbox: Option<String>,
    pub member_count: u32,
    pub dao: AccountId,
    pub issuers_sealed: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Guild {
    owner: AccountId,
    outlayer: AccountId,
    verifier: Verifier,
    secrets_owner: AccountId,
    secrets_profile: String,
    inbox: Option<String>,
    domain_keys: IterableMap<String, DomainKey>,
    issuers_sealed: bool,
    members: LookupMap<AccountId, Member>,
    nullifiers: LookupSet<String>,
    member_count: u32,
    dao: AccountId,
    /// Lags `members` only while a DAO call is in flight or after one failed.
    seated: LookupMap<AccountId, String>,
    pending: LookupSet<AccountId>,
}

fn key_id(domain: &str, selector: &str) -> String {
    require!(!domain.contains('/') && !selector.contains('/'), "domain and selector may not contain '/'");
    format!("{}/{}", domain.to_ascii_lowercase(), selector)
}

fn event(name: &str, data: Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard": "sodalis", "version": "2.0.0", "event": name, "data": [data]})
    ));
}

fn refused(account: &AccountId, reason: &str) -> Value {
    event("join_refused", json!({"account_id": account, "reason": reason}));
    json!({"joined": false, "reason": reason})
}

#[near]
impl Guild {
    #[init]
    pub fn new(
        owner: AccountId,
        outlayer: AccountId,
        verifier: Verifier,
        secrets_owner: AccountId,
        secrets_profile: String,
        dao: AccountId,
    ) -> Self {
        require!(
            verifier.hash.len() == 64 && verifier.hash.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()),
            "verifier hash must be 64 lowercase hex characters"
        );
        require!(verifier.url.starts_with("https://"), "verifier url must be https");
        // Each init gets its own prefixes: a reset leaves the previous version's
        // records in storage, and reusing a prefix would read them as current.
        let p = |tag: &str| format!("{}{tag}", env::block_height()).into_bytes();
        Self {
            owner,
            outlayer,
            verifier,
            secrets_owner,
            secrets_profile,
            inbox: None,
            domain_keys: IterableMap::new(p("k")),
            issuers_sealed: false,
            members: LookupMap::new(p("m")),
            nullifiers: LookupSet::new(p("n")),
            member_count: 0,
            dao,
            seated: LookupMap::new(p("s")),
            pending: LookupSet::new(p("p")),
        }
    }

    /// Callable only by the guild account itself, so never after its keys are deleted.
    #[private]
    #[init(ignore_state)]
    pub fn reset(
        owner: AccountId,
        outlayer: AccountId,
        verifier: Verifier,
        secrets_owner: AccountId,
        secrets_profile: String,
        dao: AccountId,
    ) -> Self {
        event("guild_reset", json!({"verifier": verifier.hash}));
        Self::new(owner, outlayer, verifier, secrets_owner, secrets_profile, dao)
    }

    pub fn transfer_ownership(&mut self, new_owner: AccountId) {
        self.assert_owner();
        event("owner_changed", json!({"from": self.owner, "to": new_owner}));
        self.owner = new_owner;
    }

    pub fn set_domain_key(&mut self, domain: String, selector: String, key_p: String, role: String) {
        self.assert_owner();
        require!(!self.issuers_sealed, "the issuer list is sealed; no key can be added");
        require!(!key_p.is_empty() && key_p.len() <= 2048, "key_p must be 1-2048 base64 characters");
        // Sputnik scopes the gatekeeper by proposal kind, not role; this is the only guard.
        require!(!role.is_empty() && !GOVERNING_ROLES.contains(&role.as_str()), "role may not be empty or a governing role");
        let id = key_id(&domain, &selector);
        event("domain_key_pinned", json!({"key": id, "role": role}));
        self.domain_keys.insert(id, DomainKey { key_p, role });
    }

    /// Allowed after sealing: removing a key only narrows who can join.
    pub fn remove_domain_key(&mut self, domain: String, selector: String) {
        self.assert_owner();
        let id = key_id(&domain, &selector);
        require!(self.domain_keys.remove(&id).is_some(), "no such domain key");
        event("domain_key_removed", json!({"key": id}));
    }

    /// Irreversible; a DKIM key rotation then requires a new guild.
    pub fn seal_issuers(&mut self) {
        self.assert_owner();
        require!(!self.issuers_sealed, "the issuer list is already sealed");
        self.issuers_sealed = true;
        let keys: Vec<String> = self.domain_keys.keys().cloned().collect();
        event("issuers_sealed", json!({"keys": keys}));
    }

    #[payable]
    pub fn init_inbox(&mut self) -> Promise {
        self.assert_owner();
        let input = json!({"action": "inbox", "guild": env::current_account_id()});
        self.request(input, env::predecessor_account_id(), env::attached_deposit())
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).with_unused_gas_weight(0).on_inbox())
    }

    #[private]
    pub fn on_inbox(&mut self) -> Value {
        let out = match env::promise_result_checked(0, 4096) {
            Ok(bytes) => serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null),
            Err(_) => return json!({"inbox": null, "reason": "request_execution failed"}),
        };
        let inbox = out["inbox"].as_str().unwrap_or_default();
        let valid = out["ok"] == json!(true)
            && out["guild"] == json!(env::current_account_id())
            && inbox.len() == 64
            && inbox.bytes().all(|b| b.is_ascii_hexdigit());
        if !valid {
            return json!({"inbox": null, "reason": out.get("reason").cloned().unwrap_or(Value::Null)});
        }
        self.inbox = Some(inbox.to_string());
        event("inbox_set", json!({"inbox": inbox}));
        json!({"inbox": inbox})
    }

    /// The member is the caller, not the signer, so a relayer can pay gas via a
    /// meta-transaction. Attach `STORAGE_FEE` plus the OutLayer run deposit.
    #[payable]
    pub fn join(&mut self, domain: String, selector: String, sealed: String) -> Promise {
        let user = env::predecessor_account_id();
        require!(!self.members.contains_key(&user), "already a member");
        // A stale seat from an earlier membership would survive a rejoin in another tier.
        require!(!self.seated.contains_key(&user) && !self.pending.contains(&user), "settle the previous DAO seat first (sync_dao_role)");
        require!(sealed.len() <= MAX_SEALED_BYTES, "sealed letter is too large");
        let pinned = self
            .domain_keys
            .get(&key_id(&domain, &selector))
            .unwrap_or_else(|| env::panic_str("this guild has not pinned a key for that domain and selector"))
            .clone();
        require!(self.inbox.is_some(), "guild inbox is not initialised");
        let run_deposit = env::attached_deposit()
            .checked_sub(STORAGE_FEE)
            .filter(|d| !d.is_zero())
            .unwrap_or_else(|| env::panic_str("attach the storage fee (0.005 NEAR) plus the OutLayer run deposit"));
        let domain = domain.to_ascii_lowercase();
        let input = json!({
            "action": "verify",
            "guild": env::current_account_id(),
            "wallet": user,
            "domain": domain,
            "selector": selector,
            "key_p": pinned.key_p,
            "sealed": sealed,
        });
        self.request(input, user.clone(), run_deposit).then(
            Self::ext(env::current_account_id())
                .with_static_gas(VERIFIED_GAS)
                .with_unused_gas_weight(0)
                .on_verified(user, domain, selector, pinned.role, U128(run_deposit.as_yoctonear())),
        )
    }

    #[private]
    pub fn on_verified(&mut self, user: AccountId, domain: String, selector: String, role: String, run_deposit: U128) -> Value {
        let out = match env::promise_result_checked(0, 4096) {
            Ok(bytes) => serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null),
            // Only a failed request_execution returns the run deposit to this
            // contract; any other outcome was settled (and refunded) by OutLayer.
            Err(PromiseError::Failed) => {
                self.refund(&user, run_deposit.0 + STORAGE_FEE.as_yoctonear());
                return refused(&user, "request_execution failed; deposit returned");
            }
            Err(_) => Value::Null,
        };
        let result = self.admit(user.clone(), &domain, &selector, &role, &out);
        if result["joined"] == json!(true) {
            self.dao_role_change(user, role, true).detach();
        } else {
            self.refund(&user, STORAGE_FEE.as_yoctonear());
        }
        result
    }

    /// Public repair path for a failed DAO call.
    pub fn sync_dao_role(&mut self, account_id: AccountId) -> Promise {
        self.assert_settled(&account_id);
        let wanted = self.members.get(&account_id).map(|m| m.role.clone());
        let held = self.seated.get(&account_id).cloned();
        match (wanted, held) {
            (Some(w), Some(h)) if w == h => env::panic_str("DAO role already matches membership"),
            (Some(_), Some(h)) => self.dao_role_change(account_id, h, false),
            (Some(w), None) => self.dao_role_change(account_id, w, true),
            (None, Some(h)) => self.dao_role_change(account_id, h, false),
            (None, None) => env::panic_str("DAO role already matches membership"),
        }
    }

    #[private]
    pub fn on_proposed(&mut self, account_id: AccountId, role: String, add: bool) -> PromiseOrValue<bool> {
        let id: Option<u64> = env::promise_result_checked(0, 32).ok().and_then(|b| serde_json::from_slice(&b).ok());
        let Some(id) = id else {
            self.pending.remove(&account_id);
            event("dao_role_sync_failed", json!({"account_id": account_id, "dao": self.dao, "role": role, "stage": "add_proposal"}));
            return PromiseOrValue::Value(false);
        };
        // The vote's own result says nothing about approval: read the status back.
        Promise::new(self.dao.clone())
            .function_call(
                "act_proposal".to_string(),
                serde_json::to_vec(&json!({"id": id, "action": "VoteApprove", "proposal": role_kind(&account_id, &role, add)}))
                    .expect("serialisable"),
                NearToken::from_yoctonear(0),
                VOTE_GAS,
            )
            .then(Promise::new(self.dao.clone()).function_call(
                "get_proposal".to_string(),
                serde_json::to_vec(&json!({"id": id})).expect("serialisable"),
                NearToken::from_yoctonear(0),
                STATUS_GAS,
            ))
            .then(Self::ext(env::current_account_id()).with_static_gas(ON_VOTED_GAS).on_voted(account_id, role, add, id))
            .into()
    }

    #[private]
    pub fn on_voted(&mut self, account_id: AccountId, role: String, add: bool, proposal_id: u64) -> bool {
        self.pending.remove(&account_id);
        let ok = env::promise_result_checked(0, 16_384)
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .is_some_and(|p| p["status"] == json!("Approved"));
        if ok {
            if add {
                self.seated.insert(account_id.clone(), role.clone());
            } else {
                self.seated.remove(&account_id);
            }
        }
        let name = match (ok, add) {
            (true, true) => "dao_role_granted",
            (true, false) => "dao_role_removed",
            (false, _) => "dao_role_sync_failed",
        };
        event(name, json!({"account_id": account_id, "dao": self.dao, "role": role, "proposal_id": proposal_id}));
        ok
    }

    /// The nullifier stays spent, so the address cannot readmit anyone.
    pub fn revoke(&mut self, account_id: AccountId) -> Promise {
        self.assert_owner();
        self.assert_settled(&account_id);
        let role = self.remove_member(&account_id, "revoked");
        self.dao_role_change(account_id, role, false)
    }

    /// Final: the nullifier stays spent.
    pub fn leave(&mut self) -> Promise {
        let account_id = env::predecessor_account_id();
        self.assert_settled(&account_id);
        let role = self.remove_member(&account_id, "left");
        self.dao_role_change(account_id, role, false)
    }

    pub fn get_config(&self) -> Config {
        Config {
            owner: self.owner.clone(),
            outlayer: self.outlayer.clone(),
            verifier: self.verifier.clone(),
            secrets_owner: self.secrets_owner.clone(),
            secrets_profile: self.secrets_profile.clone(),
            inbox: self.inbox.clone(),
            member_count: self.member_count,
            dao: self.dao.clone(),
            issuers_sealed: self.issuers_sealed,
        }
    }

    pub fn get_domain_keys(&self) -> Vec<(String, DomainKey)> {
        self.domain_keys.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    pub fn get_member(&self, account_id: AccountId) -> Option<Member> {
        self.members.get(&account_id).cloned()
    }

    pub fn get_seat(&self, account_id: AccountId) -> Option<String> {
        self.seated.get(&account_id).cloned()
    }

    pub fn is_nullifier_used(&self, nullifier: String) -> bool {
        self.nullifiers.contains(&nullifier)
    }
}

fn role_kind(account_id: &AccountId, role: &str, add: bool) -> Value {
    let kind = if add { "AddMemberToRole" } else { "RemoveMemberFromRole" };
    json!({ kind: {"member_id": account_id, "role": role} })
}

impl Guild {
    /// Two in-flight changes for one account can land in either order in the DAO,
    /// leaving a seat the guild no longer tracks; so changes run one at a time.
    fn assert_settled(&self, account_id: &AccountId) {
        require!(!self.pending.contains(account_id), "a DAO role change is already in flight; retry once it lands");
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }

    fn remove_member(&mut self, account_id: &AccountId, how: &str) -> String {
        let member = self.members.remove(account_id).unwrap_or_else(|| env::panic_str("not a member"));
        self.member_count -= 1;
        event("member_removed", json!({"account_id": account_id, "how": how}));
        member.role
    }

    /// Proposes, then approves with the gatekeeper's vote, which alone meets the threshold.
    fn dao_role_change(&mut self, account_id: AccountId, role: String, add: bool) -> Promise {
        self.pending.insert(account_id.clone());
        let description = if add { "Sodalis: seat a verified member" } else { "Sodalis: unseat a former member" };
        Promise::new(self.dao.clone())
            .function_call(
                "add_proposal".to_string(),
                serde_json::to_vec(&json!({"proposal": {"description": description, "kind": role_kind(&account_id, &role, add)}}))
                    .expect("serialisable"),
                NearToken::from_yoctonear(0),
                PROPOSE_GAS,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(ON_PROPOSED_GAS).on_proposed(account_id, role, add))
    }

    fn request(&self, input: Value, payer: AccountId, deposit: NearToken) -> Promise {
        let args = json!({
            "source": {"WasmUrl": {"url": self.verifier.url, "hash": self.verifier.hash, "build_target": "wasm32-wasip1"}},
            "resource_limits": {"max_instructions": 2_000_000_000u64, "max_memory_mb": 64, "max_execution_seconds": 20},
            "input_data": input.to_string(),
            "secrets_ref": {"profile": self.secrets_profile, "account_id": self.secrets_owner},
            "response_format": "Json",
            "payer_account_id": payer,
        });
        Promise::new(self.outlayer.clone()).function_call_weight(
            "request_execution".to_string(),
            serde_json::to_vec(&args).expect("serialisable"),
            deposit,
            EXECUTION_GAS,
            GasWeight(1),
        )
    }

    fn admit(&mut self, user: AccountId, domain: &str, selector: &str, role: &str, out: &Value) -> Value {
        if out.is_null() {
            return refused(&user, "verifier produced no output");
        }
        if out["ok"] != json!(true) {
            return refused(&user, out["reason"].as_str().unwrap_or("verifier refused"));
        }
        let checks = [
            (out["guild"] == json!(env::current_account_id()), "verifier answered for another guild"),
            (out["wallet"] == json!(user), "verifier checked a different wallet"),
            (out["domain"] == json!(domain), "verifier checked a different domain"),
            (out["selector"] == json!(selector), "verifier checked a different selector"),
        ];
        if let Some((_, reason)) = checks.iter().find(|(ok, _)| !ok) {
            return refused(&user, reason);
        }
        // The key may have been removed while the run was in flight.
        if self.domain_keys.get(&key_id(domain, selector)).is_none_or(|k| k.role != role) {
            return refused(&user, "the domain key was removed or changed during the join");
        }
        let Some(nullifier) = out["nullifier"].as_str().filter(|n| n.len() == 64) else {
            return refused(&user, "verifier returned no nullifier");
        };
        if self.members.contains_key(&user) {
            return refused(&user, "already a member");
        }
        if !self.nullifiers.insert(nullifier.to_string()) {
            return refused(&user, "this email address already admitted a member");
        }
        let member = Member { domain: domain.to_string(), role: role.to_string(), joined_at_ms: env::block_timestamp_ms() };
        self.members.insert(user.clone(), member);
        self.member_count += 1;
        event("member_joined", json!({"account_id": user, "domain": domain, "role": role, "nullifier": nullifier}));
        json!({"joined": true, "domain": domain, "role": role})
    }

    fn refund(&self, user: &AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        let locked = env::storage_byte_cost().saturating_mul(u128::from(env::storage_usage()));
        if env::account_balance().saturating_sub(locked) >= NearToken::from_yoctonear(amount) {
            Promise::new(user.clone()).transfer(NearToken::from_yoctonear(amount)).detach();
        }
    }
}

mod round;

#[cfg(test)]
mod tests;
