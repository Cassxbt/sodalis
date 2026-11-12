use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult, RuntimeFeesConfig};

const NULLIFIER: &str = "13b496e1aa13b496e1aa13b496e1aa13b496e1aa13b496e1aa13b496e1aa13b4";

fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn as_caller(predecessor: &str, signer: &str) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acct("guild.testnet"))
        .predecessor_account_id(acct(predecessor))
        .signer_account_id(acct(signer))
        .attached_deposit(NearToken::from_millinear(9))
        .build());
}

fn with_result(result: PromiseResult) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(acct("guild.testnet"))
            .predecessor_account_id(acct("guild.testnet"))
            .account_balance(NearToken::from_near(5))
            .build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result.into()],
    );
}

fn guild() -> Guild {
    as_caller("owner.testnet", "owner.testnet");
    let mut g = Guild::new(
        acct("owner.testnet"),
        acct("outlayer.testnet"),
        Verifier { url: "https://example.org/v.wasm".into(), hash: "ab".repeat(32) },
        acct("owner.testnet"),
        "bg2".into(),
        acct("dao.testnet"),
    );
    g.set_domain_key("Acme-Test.org".into(), "s1".into(), "MIIB".into(), "public".into());
    g.inbox = Some("cd".repeat(32));
    g
}

fn verified(wallet: &str, nullifier: &str) -> PromiseResult {
    PromiseResult::Successful(
        json!({"ok": true, "guild": "guild.testnet", "domain": "acme-test.org", "selector": "s1",
               "wallet": wallet, "challenge_expires": 1, "nullifier": nullifier})
        .to_string()
        .into_bytes(),
    )
}

fn settle(g: &mut Guild, user: &str, result: PromiseResult) -> Value {
    with_result(result);
    g.on_verified(acct(user), "acme-test.org".into(), "s1".into(), "public".into(), U128(0))
}

#[test]
fn admits_a_verified_wallet_once() {
    let mut g = guild();
    assert_eq!(settle(&mut g, "anon.testnet", verified("anon.testnet", NULLIFIER))["joined"], json!(true));
    assert_eq!(g.get_member(acct("anon.testnet")).unwrap().domain, "acme-test.org");
    assert!(g.is_nullifier_used(NULLIFIER.into()));
    assert_eq!(g.get_config().member_count, 1);
    assert!(get_logs().iter().any(|l| l.contains("member_joined")));
}

#[test]
fn one_email_address_admits_one_member() {
    let mut g = guild();
    settle(&mut g, "anon.testnet", verified("anon.testnet", NULLIFIER));
    let second = settle(&mut g, "second.testnet", verified("second.testnet", NULLIFIER));
    assert_eq!(second["joined"], json!(false));
    assert!(second["reason"].as_str().unwrap().contains("already admitted"));
    assert!(g.get_member(acct("second.testnet")).is_none());
}

#[test]
fn refuses_a_result_for_another_wallet() {
    let mut g = guild();
    let out = settle(&mut g, "anon.testnet", verified("attacker.testnet", NULLIFIER));
    assert_eq!(out["reason"], json!("verifier checked a different wallet"));
    assert!(!g.is_nullifier_used(NULLIFIER.into()));
}

#[test]
fn refuses_a_result_for_another_guild_or_domain() {
    let mut g = guild();
    let other_guild = json!({"ok": true, "guild": "other.testnet", "domain": "acme-test.org", "selector": "s1",
                             "wallet": "anon.testnet", "nullifier": NULLIFIER});
    let out = settle(&mut g, "anon.testnet", PromiseResult::Successful(other_guild.to_string().into_bytes()));
    assert_eq!(out["reason"], json!("verifier answered for another guild"));
    let other_domain = json!({"ok": true, "guild": "guild.testnet", "domain": "evil.org", "selector": "s1",
                              "wallet": "anon.testnet", "nullifier": NULLIFIER});
    let out = settle(&mut g, "anon.testnet", PromiseResult::Successful(other_domain.to_string().into_bytes()));
    assert_eq!(out["reason"], json!("verifier checked a different domain"));
}

#[test]
fn passes_the_verifier_refusal_through() {
    let mut g = guild();
    let body = json!({"ok": false, "reason": "challenge expired"}).to_string().into_bytes();
    assert_eq!(settle(&mut g, "anon.testnet", PromiseResult::Successful(body))["reason"], json!("challenge expired"));
    assert_eq!(settle(&mut g, "anon.testnet", PromiseResult::Successful(b"null".to_vec()))["reason"], json!("verifier produced no output"));
    assert_eq!(settle(&mut g, "anon.testnet", PromiseResult::Failed)["joined"], json!(false));
    assert_eq!(g.get_config().member_count, 0);
}

#[test]
#[should_panic(expected = "has not pinned a key")]
fn join_refuses_an_unpinned_domain() {
    let mut g = guild();
    as_caller("anon.testnet", "anon.testnet");
    g.join("gmail.com".into(), "s1".into(), "AAAA".into()).detach();
}

#[test]
fn the_member_is_the_caller_even_when_a_relayer_signs() {
    let mut g = guild();
    as_caller("anon.testnet", "relayer.testnet");
    g.join("acme-test.org".into(), "s1".into(), "AAAA".into()).detach();
    let calls = calls();
    let (_, _, args) = calls.iter().find(|c| c.1 == "request_execution").expect("no OutLayer request");
    let input: Value = serde_json::from_str(args["input_data"].as_str().unwrap()).unwrap();
    assert_eq!(input["wallet"], json!("anon.testnet"));
    assert_eq!(args["payer_account_id"], json!("anon.testnet"));
}

#[test]
#[should_panic(expected = "owner only")]
fn only_the_owner_pins_keys() {
    let mut g = guild();
    as_caller("anon.testnet", "anon.testnet");
    g.set_domain_key("evil.org".into(), "s1".into(), "MIIB".into(), "public".into());
}

#[test]
fn a_too_long_answer_is_refused_without_a_run_refund() {
    let mut g = guild();
    with_result(PromiseResult::Successful(vec![b'x'; 5000]));
    let out = g.on_verified(acct("anon.testnet"), "acme-test.org".into(), "s1".into(), "public".into(), U128(3_000_000_000_000_000_000_000));
    assert_eq!(out["reason"], json!("verifier produced no output"));
    // Only the storage fee comes back (one transfer of 0.005 NEAR), never the run deposit OutLayer already refunded.
    let receipts = near_sdk::test_utils::get_created_receipts();
    let refunded: Vec<String> = receipts.iter().map(|r| format!("{:?}", r.actions)).collect();
    assert_eq!(refunded.len(), 1);
    assert!(refunded[0].contains(&STORAGE_FEE.as_yoctonear().to_string()), "{refunded:?}");
}

#[test]
fn revoked_member_cannot_rejoin_with_the_same_address() {
    let mut g = guild();
    settle(&mut g, "anon.testnet", verified("anon.testnet", NULLIFIER));
    as_caller("owner.testnet", "owner.testnet");
    g.revoke(acct("anon.testnet")).detach();
    assert!(g.get_member(acct("anon.testnet")).is_none());
    assert_eq!(g.get_config().member_count, 0);
    assert!(settle(&mut g, "anon.testnet", verified("anon.testnet", NULLIFIER))["reason"].as_str().unwrap().contains("already admitted"));
}

#[test]
fn a_member_can_leave() {
    let mut g = guild();
    settle(&mut g, "anon.testnet", verified("anon.testnet", NULLIFIER));
    as_caller("anon.testnet", "anon.testnet");
    g.leave().detach();
    assert!(g.get_member(acct("anon.testnet")).is_none());
}

#[test]
#[should_panic(expected = "may not contain '/'")]
fn key_ids_cannot_collide() {
    let mut g = guild();
    g.set_domain_key("a".into(), "b/c".into(), "MIIB".into(), "public".into());
}

#[test]
#[should_panic(expected = "attach the storage fee")]
fn join_requires_the_storage_fee() {
    let mut g = guild();
    testing_env!(VMContextBuilder::new()
        .current_account_id(acct("guild.testnet"))
        .predecessor_account_id(acct("anon.testnet"))
        .signer_account_id(acct("anon.testnet"))
        .attached_deposit(NearToken::from_millinear(5))
        .build());
    g.join("acme-test.org".into(), "s1".into(), "AAAA".into()).detach();
}

#[test]
fn inbox_is_taken_only_from_a_valid_answer_for_this_guild() {
    let mut g = guild();
    g.inbox = None;
    with_result(PromiseResult::Successful(json!({"ok": true, "guild": "other.testnet", "inbox": "ef".repeat(32)}).to_string().into_bytes()));
    g.on_inbox();
    assert!(g.get_config().inbox.is_none());
    with_result(PromiseResult::Successful(json!({"ok": true, "guild": "guild.testnet", "inbox": "ef".repeat(32)}).to_string().into_bytes()));
    g.on_inbox();
    assert_eq!(g.get_config().inbox, Some("ef".repeat(32)));
}

/// (receiver, method, args) of every function call the last step created.
fn calls() -> Vec<(String, String, Value)> {
    near_sdk::test_utils::get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let to = r.receiver_id.to_string();
            r.actions.into_iter().filter_map(move |a| match a {
                near_sdk::mock::MockAction::FunctionCallWeight { method_name, args, .. } => Some((
                    to.clone(),
                    String::from_utf8(method_name).unwrap(),
                    serde_json::from_slice(&args).unwrap_or(Value::Null),
                )),
                _ => None,
            })
        })
        .collect()
}

fn with_return(bytes: &[u8]) {
    with_result(PromiseResult::Successful(bytes.to_vec()));
}

fn with_status(status: &str) {
    with_return(json!({"id": 7, "status": status}).to_string().as_bytes());
}

#[test]
fn an_admitted_member_is_proposed_for_the_dao_role() {
    let mut g = guild();
    settle(&mut g, "anon.testnet", verified("anon.testnet", NULLIFIER));
    let calls = calls();
    let (to, method, args) = calls.iter().find(|c| c.1 == "add_proposal").expect("no add_proposal");
    assert_eq!((to.as_str(), method.as_str()), ("dao.testnet", "add_proposal"));
    assert_eq!(args["proposal"]["kind"], json!({"AddMemberToRole": {"member_id": "anon.testnet", "role": "public"}}));
    assert!(g.get_seat(acct("anon.testnet")).is_none(), "seated only once the DAO confirms");
}

#[test]
fn a_refused_join_never_touches_the_dao() {
    let mut g = guild();
    settle(&mut g, "anon.testnet", verified("someone.else", NULLIFIER));
    assert!(calls().iter().all(|c| c.0 != "dao.testnet"));
}

#[test]
fn the_guild_approves_exactly_the_proposal_the_dao_numbered() {
    let mut g = guild();
    with_return(b"7");
    let _ = g.on_proposed(acct("anon.testnet"), "public".into(), true);
    let calls = calls();
    let (to, method, args) = calls.iter().find(|c| c.1 == "act_proposal").expect("no act_proposal");
    assert_eq!((to.as_str(), method.as_str()), ("dao.testnet", "act_proposal"));
    assert_eq!(args["id"], json!(7));
    assert_eq!(args["action"], json!("VoteApprove"));
    assert_eq!(args["proposal"], json!({"AddMemberToRole": {"member_id": "anon.testnet", "role": "public"}}));
    assert!(calls.iter().any(|c| c.1 == "get_proposal" && c.2["id"] == json!(7)), "status must be read back");
}

#[test]
fn a_rejected_proposal_is_not_voted_on_and_can_be_retried() {
    let mut g = guild();
    settle(&mut g, "anon.testnet", verified("anon.testnet", NULLIFIER));
    with_result(PromiseResult::Failed);
    assert!(matches!(g.on_proposed(acct("anon.testnet"), "public".into(), true), PromiseOrValue::Value(false)));
    assert!(calls().iter().all(|c| c.1 != "act_proposal"));
    as_caller("stranger.testnet", "stranger.testnet");
    g.sync_dao_role(acct("anon.testnet")).detach();
}

#[test]
fn a_vote_that_leaves_the_proposal_in_progress_does_not_seat() {
    let mut g = guild();
    settle(&mut g, "anon.testnet", verified("anon.testnet", NULLIFIER));
    with_status("InProgress");
    assert!(!g.on_voted(acct("anon.testnet"), "public".into(), true, 7));
    assert!(g.get_seat(acct("anon.testnet")).is_none());
}

#[test]
#[should_panic(expected = "already in flight")]
fn repairs_wait_for_an_in_flight_change() {
    let mut g = guild();
    settle(&mut g, "anon.testnet", verified("anon.testnet", NULLIFIER));
    as_caller("stranger.testnet", "stranger.testnet");
    g.sync_dao_role(acct("anon.testnet")).detach();
}

#[test]
#[should_panic(expected = "governing role")]
fn a_domain_cannot_seat_members_in_a_governing_role() {
    let mut g = guild();
    g.set_domain_key("corp.example".into(), "s1".into(), "MIIB".into(), "council".into());
}

#[test]
fn seating_follows_the_dao_outcome_and_can_be_repaired() {
    let mut g = guild();
    settle(&mut g, "anon.testnet", verified("anon.testnet", NULLIFIER));
    with_result(PromiseResult::Failed);
    assert!(!g.on_voted(acct("anon.testnet"), "public".into(), true, 7));
    assert!(g.get_seat(acct("anon.testnet")).is_none());
    assert!(get_logs().iter().any(|l| l.contains("dao_role_sync_failed")));

    as_caller("stranger.testnet", "stranger.testnet");
    g.sync_dao_role(acct("anon.testnet")).detach();
    assert!(calls().iter().any(|c| c.1 == "add_proposal" && c.2["proposal"]["kind"]["AddMemberToRole"]["member_id"] == json!("anon.testnet")));

    with_status("Approved");
    assert!(g.on_voted(acct("anon.testnet"), "public".into(), true, 8));
    assert_eq!(g.get_seat(acct("anon.testnet")).as_deref(), Some("public"));
}

#[test]
#[should_panic(expected = "DAO role already matches membership")]
fn sync_refuses_when_nothing_is_out_of_line() {
    let mut g = guild();
    as_caller("stranger.testnet", "stranger.testnet");
    g.sync_dao_role(acct("nobody.testnet")).detach();
}

#[test]
fn leaving_unseats_the_member() {
    let mut g = guild();
    settle(&mut g, "anon.testnet", verified("anon.testnet", NULLIFIER));
    with_status("Approved");
    g.on_voted(acct("anon.testnet"), "public".into(), true, 7);
    as_caller("anon.testnet", "anon.testnet");
    g.leave().detach();
    assert!(calls().iter().any(|c| c.2["proposal"]["kind"] == json!({"RemoveMemberFromRole": {"member_id": "anon.testnet", "role": "public"}})));
    with_status("Approved");
    g.on_voted(acct("anon.testnet"), "public".into(), false, 9);
    assert!(g.get_seat(acct("anon.testnet")).is_none());
}

#[test]
fn ownership_moves_to_the_dao() {
    let mut g = guild();
    as_caller("owner.testnet", "owner.testnet");
    g.transfer_ownership(acct("dao.testnet"));
    assert_eq!(g.get_config().owner, acct("dao.testnet"));
    as_caller("dao.testnet", "dao.testnet");
    g.set_domain_key("corp.example".into(), "s2".into(), "MIIB".into(), "public".into());
}

#[test]
#[should_panic(expected = "owner only")]
fn the_old_owner_loses_control() {
    let mut g = guild();
    as_caller("owner.testnet", "owner.testnet");
    g.transfer_ownership(acct("dao.testnet"));
    g.set_domain_key("evil.org".into(), "s1".into(), "MIIB".into(), "public".into());
}

#[test]
fn a_staff_domain_seats_its_member_as_staff() {
    let mut g = guild();
    g.set_domain_key("trendtwin.xyz".into(), "hostingermail-a".into(), "MIIB".into(), "staff".into());
    as_caller("anon.testnet", "anon.testnet");
    g.join("trendtwin.xyz".into(), "hostingermail-a".into(), "AAAA".into()).detach();
    let joined = calls();
    let (_, _, args) = joined.iter().find(|c| c.1 == "on_verified").expect("no callback");
    assert_eq!(args["role"], json!("staff"));
    with_result(PromiseResult::Successful(
        json!({"ok": true, "guild": "guild.testnet", "domain": "trendtwin.xyz", "selector": "hostingermail-a", "wallet": "anon.testnet", "nullifier": NULLIFIER})
            .to_string()
            .into_bytes(),
    ));
    let out = g.on_verified(acct("anon.testnet"), "trendtwin.xyz".into(), "hostingermail-a".into(), "staff".into(), U128(0));
    assert_eq!(out["role"], json!("staff"));
    assert_eq!(g.get_member(acct("anon.testnet")).unwrap().role, "staff");
    assert!(calls().iter().any(|c| c.2["proposal"]["kind"] == json!({"AddMemberToRole": {"member_id": "anon.testnet", "role": "staff"}})));
}

#[test]
#[should_panic(expected = "issuer list is sealed")]
fn a_sealed_issuer_list_takes_no_new_key() {
    let mut g = guild();
    g.seal_issuers();
    g.set_domain_key("corp.example".into(), "s1".into(), "MIIB".into(), "public".into());
}

#[test]
fn a_sealed_issuer_list_can_still_drop_a_key() {
    let mut g = guild();
    g.seal_issuers();
    g.remove_domain_key("acme-test.org".into(), "s1".into());
    assert!(g.get_domain_keys().is_empty());
    assert!(g.get_config().issuers_sealed);
}

#[test]
fn leaving_unseats_from_the_role_the_member_holds() {
    let mut g = guild();
    g.set_domain_key("trendtwin.xyz".into(), "hostingermail-a".into(), "MIIB".into(), "staff".into());
    with_result(PromiseResult::Successful(
        json!({"ok": true, "guild": "guild.testnet", "domain": "trendtwin.xyz", "selector": "hostingermail-a", "wallet": "anon.testnet", "nullifier": NULLIFIER})
            .to_string()
            .into_bytes(),
    ));
    g.on_verified(acct("anon.testnet"), "trendtwin.xyz".into(), "hostingermail-a".into(), "staff".into(), U128(0));
    with_status("Approved");
    g.on_voted(acct("anon.testnet"), "staff".into(), true, 7);
    as_caller("anon.testnet", "anon.testnet");
    g.leave().detach();
    assert!(calls().iter().any(|c| c.2["proposal"]["kind"] == json!({"RemoveMemberFromRole": {"member_id": "anon.testnet", "role": "staff"}})));
}

#[test]
#[should_panic(expected = "settle the previous DAO seat first")]
fn a_former_member_with_a_stale_seat_cannot_rejoin() {
    let mut g = guild();
    settle(&mut g, "anon.testnet", verified("anon.testnet", NULLIFIER));
    with_status("Approved");
    g.on_voted(acct("anon.testnet"), "public".into(), true, 7);
    as_caller("anon.testnet", "anon.testnet");
    g.leave().detach();
    with_result(PromiseResult::Failed);
    g.on_voted(acct("anon.testnet"), "public".into(), false, 8);
    as_caller("anon.testnet", "anon.testnet");
    g.join("acme-test.org".into(), "s1".into(), "AAAA".into()).detach();
}

#[test]
fn repair_removes_a_wrong_seat_before_adding_the_right_one() {
    let mut g = guild();
    settle(&mut g, "anon.testnet", verified("anon.testnet", NULLIFIER));
    with_status("Approved");
    g.on_voted(acct("anon.testnet"), "staff".into(), true, 7);
    as_caller("stranger.testnet", "stranger.testnet");
    g.sync_dao_role(acct("anon.testnet")).detach();
    assert!(calls().iter().any(|c| c.2["proposal"]["kind"] == json!({"RemoveMemberFromRole": {"member_id": "anon.testnet", "role": "staff"}})));
}

#[test]
fn a_key_removed_mid_join_admits_nobody() {
    let mut g = guild();
    g.remove_domain_key("acme-test.org".into(), "s1".into());
    let out = settle(&mut g, "anon.testnet", verified("anon.testnet", NULLIFIER));
    assert_eq!(out["joined"], json!(false));
    assert!(out["reason"].as_str().unwrap().contains("removed or changed"));
    assert!(!g.is_nullifier_used(NULLIFIER.into()));
}
