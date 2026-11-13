//! Payout rounds. The DAO opens a round with a total budget and a per-seat
//! allowance. Members ask through the guild, which reserves the amount and
//! files the DAO transfer itself; staff still decide each request. The DAO
//! policy lets only the guild file transfers, so a round cannot be bypassed.
//!
//! Round records live under their own prefix and outlive a `reset`: a payout
//! that happened stays on the books. A reset is refused while any request is
//! unresolved, so every request settles against the DAO it was filed with.

use crate::*;
use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};

const PROPOSE_PAYOUT_GAS: Gas = Gas::from_tgas(15);
const ON_PAYOUT_PROPOSED_GAS: Gas = Gas::from_tgas(15);
const READ_GAS: Gas = Gas::from_tgas(10);
const UNRESOLVED: &str = "round:unresolved";
const ON_SETTLED_GAS: Gas = Gas::from_tgas(15);
const MIN_REQUEST: u128 = 10_000_000_000_000_000_000_000;
/// A fixed list, so nothing that identifies a member can ride in a request.
pub const CATEGORIES: [&str; 5] = ["Travel", "Software", "Equipment", "Event costs", "Other"];

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Round {
    pub id: u32,
    pub budget: U128,
    pub allowance: U128,
    /// Reserved by pending requests plus approved.
    pub committed: U128,
    /// Approved by the DAO. Whether each transfer landed is in its receipt.
    pub approved: U128,
    pub open: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct PayoutRequest {
    pub account_id: AccountId,
    pub round: u32,
    pub amount: U128,
    pub category: String,
    /// pending, approved or released.
    pub state: String,
}

#[near(serializers = [json])]
pub struct Allowance {
    pub round: u32,
    pub allowance: U128,
    pub used: U128,
    pub remaining: U128,
}

fn load<T: BorshDeserialize>(key: &str) -> Option<T> {
    env::storage_read(key.as_bytes()).map(|b| borsh::from_slice(&b).expect("round record"))
}

fn save<T: BorshSerialize>(key: &str, value: &T) {
    env::storage_write(key.as_bytes(), &borsh::to_vec(value).expect("serialisable"));
}

const CURRENT: &str = "round:current";
fn round_key(id: u32) -> String {
    format!("round:{id}")
}
fn used_key(id: u32, account: &AccountId) -> String {
    format!("round:{id}:used:{account}")
}
fn request_key(proposal_id: u64) -> String {
    format!("round:request:{proposal_id}")
}

pub(crate) fn unresolved_requests() -> u32 {
    load(UNRESOLVED).unwrap_or(0)
}

fn round(id: u32) -> Round {
    load(&round_key(id)).unwrap_or_else(|| env::panic_str("no such round"))
}
fn used(id: u32, account: &AccountId) -> u128 {
    load(&used_key(id, account)).unwrap_or(0)
}

/// Moves `amount` into (`add`) or out of a round's books and the member's use of it.
fn book(id: u32, account: &AccountId, amount: u128, add: bool) {
    let mut r = round(id);
    let u = used(id, account);
    let (committed, u) = if add { (r.committed.0 + amount, u + amount) } else { (r.committed.0 - amount, u - amount) };
    r.committed = U128(committed);
    save(&round_key(id), &r);
    save(&used_key(id, account), &u);
}

#[near]
impl Guild {
    /// Closes any open round and opens the next one.
    pub fn open_round(&mut self, budget: U128, allowance: U128) {
        self.assert_owner();
        require!(allowance.0 >= MIN_REQUEST && budget.0 >= allowance.0, "allowance must be at least 0.01 NEAR and no more than the budget");
        let id = load::<u32>(CURRENT).unwrap_or(0) + 1;
        if id > 1 {
            let mut previous = round(id - 1);
            previous.open = false;
            save(&round_key(id - 1), &previous);
        }
        save(&round_key(id), &Round { id, budget, allowance, committed: U128(0), approved: U128(0), open: true });
        save(CURRENT, &id);
        event("round_opened", json!({"round": id, "budget": budget, "allowance": allowance}));
    }

    pub fn close_round(&mut self) {
        self.assert_owner();
        let mut r = self.get_round(None).unwrap_or_else(|| env::panic_str("no round to close"));
        r.open = false;
        save(&round_key(r.id), &r);
        event("round_closed", json!({"round": r.id}));
    }

    /// Asks the treasury for `amount` to the caller. Refused on chain when it
    /// exceeds the caller's allowance or the round's remaining budget.
    pub fn request_payout(&mut self, amount: U128, category: String) -> Promise {
        let user = env::predecessor_account_id();
        let role = self.members.get(&user).map(|m| m.role.clone());
        require!(role.is_some() && self.seated.get(&user) == role.as_ref() && !self.pending.contains(&user), "only seated members may request a payout");
        require!(CATEGORIES.contains(&category.as_str()), &format!("category must be one of: {}", CATEGORIES.join(", ")));
        require!(amount.0 >= MIN_REQUEST, "a request must be at least 0.01 NEAR");
        let r = self.get_round(None).filter(|r| r.open).unwrap_or_else(|| env::panic_str("no round is open"));
        require!(used(r.id, &user) + amount.0 <= r.allowance.0, "exceeds your allowance in this round");
        require!(r.committed.0 + amount.0 <= r.budget.0, "exceeds the round's remaining budget");
        book(r.id, &user, amount.0, true);

        let proposal = json!({"proposal": {
            "description": format!("Sodalis round {}: {category}", r.id),
            "kind": {"Transfer": {"token_id": "", "receiver_id": user, "amount": amount}},
        }});
        Promise::new(self.dao.clone())
            .function_call("add_proposal".to_string(), serde_json::to_vec(&proposal).expect("serialisable"), NearToken::from_yoctonear(0), PROPOSE_PAYOUT_GAS)
            .then(Self::ext(env::current_account_id()).with_static_gas(ON_PAYOUT_PROPOSED_GAS).on_payout_proposed(user, r.id, amount, category))
    }

    #[private]
    pub fn on_payout_proposed(&mut self, account_id: AccountId, round: u32, amount: U128, category: String) -> Option<u64> {
        let id = match env::promise_result_checked(0, 32) {
            Ok(bytes) => serde_json::from_slice::<u64>(&bytes).ok(),
            Err(_) => {
                book(round, &account_id, amount.0, false);
                event("payout_request_failed", json!({"account_id": account_id, "round": round, "amount": amount}));
                return None;
            }
        };
        // The DAO answered but not with an id: a proposal may exist, so the reservation stays.
        let Some(id) = id else {
            event("payout_request_unrecorded", json!({"account_id": account_id, "round": round, "amount": amount}));
            return None;
        };
        event("payout_requested", json!({"account_id": account_id, "round": round, "amount": amount, "category": category, "proposal_id": id}));
        save(&request_key(id), &PayoutRequest { account_id, round, amount, category, state: "pending".into() });
        save(UNRESOLVED, &(unresolved_requests() + 1));
        Some(id)
    }

    /// Anyone may settle a request once the DAO has recorded a decision: approved,
    /// or released back to the round when it was rejected, expired or removed.
    pub fn settle(&mut self, proposal_id: u64) -> Promise {
        let request = self.get_payout_request(proposal_id).unwrap_or_else(|| env::panic_str("no such payout request"));
        require!(request.state == "pending", "this request is already settled");
        // A removed proposal is deleted, not marked: an empty page is how its absence shows.
        Promise::new(self.dao.clone())
            .function_call(
                "get_proposals".to_string(),
                serde_json::to_vec(&json!({"from_index": proposal_id, "limit": 1})).expect("serialisable"),
                NearToken::from_yoctonear(0),
                READ_GAS,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(ON_SETTLED_GAS).on_settled(proposal_id))
    }

    #[private]
    pub fn on_settled(&mut self, proposal_id: u64) -> String {
        let mut request = self.get_payout_request(proposal_id).expect("request recorded");
        let page = env::promise_result_checked(0, 32_768).ok().and_then(|b| serde_json::from_slice::<Vec<Value>>(&b).ok());
        // A failed read says nothing about the proposal, so nothing changes.
        let Some(page) = page else { return request.state };
        if request.state != "pending" {
            return request.state;
        }
        let outcome = match page.into_iter().find(|p| p["id"] == json!(proposal_id)) {
            None => "removed",
            Some(p) => {
                let transfer = &p["kind"]["Transfer"];
                let ours = p["proposer"] == json!(env::current_account_id())
                    && transfer["receiver_id"] == json!(request.account_id)
                    && transfer["amount"] == json!(request.amount)
                    && transfer["token_id"] == json!("");
                // Only outcomes the DAO has recorded and will not revisit. Expiry is
                // judged against the current policy, so an undecided request stays
                // reserved until a vote or finalisation records it.
                match p["status"].as_str().unwrap_or_default() {
                    _ if !ours => return request.state,
                    "Approved" => "approved",
                    "Rejected" => "rejected",
                    "Expired" => "expired",
                    _ => return request.state,
                }
            }
        };
        if outcome == "approved" {
            let mut r = round(request.round);
            r.approved = U128(r.approved.0 + request.amount.0);
            save(&round_key(r.id), &r);
            request.state = "approved".into();
        } else {
            book(request.round, &request.account_id, request.amount.0, false);
            request.state = "released".into();
        }
        save(UNRESOLVED, &unresolved_requests().saturating_sub(1));
        event("payout_settled", json!({"proposal_id": proposal_id, "account_id": request.account_id, "round": request.round, "amount": request.amount, "outcome": outcome}));
        save(&request_key(proposal_id), &request);
        request.state
    }

    /// The current round, or round `round_id`.
    pub fn get_round(&self, round_id: Option<u32>) -> Option<Round> {
        round_id.or_else(|| load(CURRENT)).and_then(|id| load(&round_key(id)))
    }

    pub fn get_allowance(&self, account_id: AccountId) -> Option<Allowance> {
        let r = self.get_round(None)?;
        let u = used(r.id, &account_id);
        Some(Allowance { round: r.id, allowance: r.allowance, used: U128(u), remaining: U128(r.allowance.0.saturating_sub(u)) })
    }

    pub fn get_payout_request(&self, proposal_id: u64) -> Option<PayoutRequest> {
        load(&request_key(proposal_id))
    }
}
