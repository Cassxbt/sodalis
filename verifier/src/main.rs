mod dkim;
mod seal;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{env, io::Read};

const MAX_CHALLENGE_TTL_SECS: u64 = 86_400;

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum Request {
    Inbox { guild: String },
    Verify { guild: String, wallet: String, domain: String, selector: String, key_p: String, sealed: String },
}

#[derive(Deserialize)]
struct Letter {
    eml: String,
    salt: String,
}

/// Everything identity-bearing comes from the worker, never from the caller:
/// the reserved NEAR_* names cannot be set as secrets, and PROTECTED_* names
/// exist only when the keystore generated them.
fn worker_env(name: &str) -> Result<String, String> {
    env::var(name).ok().filter(|v| !v.is_empty()).ok_or_else(|| format!("{name} is not set by the worker"))
}

/// The master is released only to runs the guild contract requested, and only
/// alone: a run that also received any other secret (which could shadow a
/// worker variable) or that was requested by anyone else is refused.
fn master(guild: &str) -> Result<Vec<u8>, String> {
    if worker_env("NEAR_PREDECESSOR_ID")? != guild {
        return Err("only the guild contract may request this run".into());
    }
    let rows: Value = serde_json::from_str(&worker_env("OUTLAYER_SECRETS_ROWS").unwrap_or_else(|_| "[]".into()))
        .map_err(|_| "unreadable secret rows")?;
    if rows.as_array().map(|r| r.len()) != Some(1) || rows[0]["keys"] != json!(["PROTECTED_GUILD_MASTER"]) {
        return Err("no guild master: this run was not admitted to the guild's secret alone".into());
    }
    let hex_master = worker_env("PROTECTED_GUILD_MASTER")
        .map_err(|_| "no guild master: this run was not admitted to the guild's secret".to_string())?;
    let bytes = hex::decode(hex_master).map_err(|_| "guild master is not hex")?;
    if bytes.len() < 32 {
        return Err("guild master is shorter than 32 bytes".into());
    }
    Ok(bytes)
}

/// Accepts only `local@domain` or `Display Name <local@domain>`. Anything an
/// MTA might read differently (comments, quotes, groups, lists, a second
/// address) is refused rather than guessed at.
const ROLE_MAILBOXES: [&str; 14] = [
    "noreply", "no-reply", "donotreply", "do-not-reply", "postmaster", "mailer-daemon", "bounce",
    "bounces", "support", "help", "info", "admin", "abuse", "helpdesk",
];

fn mailbox(value: &str) -> Result<String, &'static str> {
    let value = value.trim_matches(&[' ', '\t'][..]);
    let addr = match (value.find('<'), value.rfind('>')) {
        (None, None) => value,
        (Some(a), Some(b)) if b == value.len() - 1 && value.matches('<').count() == 1 && value.matches('>').count() == 1 => {
            if value[..a].contains('@') {
                return Err("display name may not contain an address");
            }
            &value[a + 1..b]
        }
        _ => return Err("From/To must hold exactly one plain mailbox"),
    };
    let bad = |c: char| c.is_whitespace() || "()<>,;:\\\"[]".contains(c) || !c.is_ascii();
    if value.contains(['(', ')', '"', ',', ';']) || addr.chars().any(bad) || addr.matches('@').count() != 1 {
        return Err("From/To must hold exactly one plain mailbox");
    }
    let (local, domain) = addr.split_once('@').unwrap();
    // Sub-addresses (`dana+anything@`) reach the same mailbox, so they share one identity.
    let local = local.split('+').next().unwrap_or_default();
    if local.is_empty() || domain.is_empty() {
        return Err("From/To must hold exactly one plain mailbox");
    }
    Ok(format!("{}@{}", local.to_ascii_lowercase(), domain.to_ascii_lowercase()))
}

/// Proton writes `"addr" <addr>`: a quoted display name is allowed in To, never in From.
fn recipient(value: &str) -> Result<String, &'static str> {
    let value = value.trim_matches(&[' ', '\t'][..]);
    let rest = match value.strip_prefix('"').and_then(|v| v.split_once('"')) {
        Some((name, rest)) if !name.contains('\\') => rest,
        Some(_) => return Err("From/To must hold exactly one plain mailbox"),
        None => value,
    };
    mailbox(rest)
}

fn single<'a>(msg: &'a dkim::Message, name: &str) -> Result<&'a dkim::Header, String> {
    let found: Vec<_> = msg.headers.iter().filter(|h| h.name == name).collect();
    match found[..] {
        [h] => Ok(h),
        _ => Err(format!("message must have exactly one {name} header")),
    }
}

pub fn commitment(guild: &str, wallet: &str, salt: &str) -> String {
    hex::encode(Sha256::digest(format!("blind-guild:v2:{guild}:{wallet}:{salt}").as_bytes()))
}

fn inbox(guild: &str) -> Result<Value, String> {
    let keys = seal::derive(&master(guild)?, guild);
    Ok(json!({"ok": true, "guild": guild, "inbox": hex::encode(seal::inbox_public(&keys))}))
}

// Refusal reasons are public (they land in the receipt), so none of them
// names the email's domain, address or contents.
/// `wallet` is the account that called the guild's `join`. Only the guild can
/// get a run this far (`master` checks the predecessor), so the guild vouches
/// for it, which also lets a relayer pay gas for a member's meta-transaction.
fn verify(guild: &str, wallet: &str, domain: &str, selector: &str, key_p: &str, sealed: &str) -> Result<Value, String> {
    let keys = seal::derive(&master(guild)?, guild);
    if wallet.is_empty() || wallet.len() > 64 {
        return Err("wallet must be a NEAR account id".into());
    }
    let now = worker_env("NEAR_BLOCK_TIMESTAMP")?.parse::<u64>().map_err(|_| "bad block timestamp")? / 1_000_000_000;

    let sealed = B64.decode(sealed.trim()).map_err(|_| "sealed payload is not base64")?;
    let letter: Letter = serde_json::from_slice(&seal::open(&keys, &sealed)?).map_err(|_| "sealed payload is not a letter")?;
    if letter.salt.len() != 64 || hex::decode(&letter.salt).is_err() {
        return Err("salt must be 32 random bytes in hex".into());
    }

    let msg = dkim::parse(&letter.eml)?;
    let sig = dkim::verify(&msg, key_p)?;
    if sig.domain != domain.to_ascii_lowercase() || sig.selector != selector {
        return Err("signature does not come from the guild's pinned domain key".into());
    }
    for required in ["from", "to", "subject"] {
        if !sig.signed_headers.iter().any(|h| h == required) {
            return Err(format!("{required} header is not covered by the signature"));
        }
    }
    let from = mailbox(&dkim::header_value(single(&msg, "from")?))?;
    // Lists, ticket desks and bounce handlers live on role mailboxes and can echo an outsider's subject.
    let local = from.split('@').next().unwrap_or_default();
    if ROLE_MAILBOXES.contains(&local) {
        return Err("role and no-reply mailboxes cannot join".into());
    }
    // Any single recipient: Gmail delivers mail sent to oneself internally, with no DKIM signature.
    recipient(&dkim::header_value(single(&msg, "to")?))?;
    let from_domain = from.rsplit_once('@').map(|(_, d)| d.to_string()).unwrap_or_default();
    if from_domain != sig.domain && !from_domain.ends_with(&format!(".{}", sig.domain)) {
        return Err("From address is not aligned with the signing domain".into());
    }
    if sig.expires.is_some_and(|x| x <= now) {
        return Err("DKIM signature expired (x=)".into());
    }

    let subject = dkim::header_value(single(&msg, "subject")?);
    let [tag, commit, expiry] = subject.split_whitespace().collect::<Vec<_>>()[..] else {
        return Err("subject is not a blind-guild v2 challenge".into());
    };
    if tag != "bg2" {
        return Err("subject is not a blind-guild v2 challenge".into());
    }
    if commit != commitment(guild, wallet, &letter.salt) {
        return Err("challenge is bound to a different wallet or guild".into());
    }
    let expiry: u64 = expiry.parse().map_err(|_| "bad challenge expiry")?;
    if expiry <= now {
        return Err("challenge expired".into());
    }
    if expiry > now + MAX_CHALLENGE_TTL_SECS {
        return Err("challenge lifetime exceeds 24h".into());
    }

    let mut mac = Hmac::<Sha256>::new_from_slice(&keys.nullifier).expect("any key length");
    mac.update(from.as_bytes());
    Ok(json!({
        "ok": true,
        "guild": guild,
        "domain": sig.domain,
        "selector": sig.selector,
        "wallet": wallet,
        "challenge_expires": expiry,
        "nullifier": hex::encode(mac.finalize().into_bytes()),
    }))
}

fn main() {
    let mut input = String::new();
    let _ = std::io::stdin().read_to_string(&mut input);
    let out = match serde_json::from_str::<Request>(&input) {
        Ok(Request::Inbox { guild }) => inbox(&guild),
        Ok(Request::Verify { guild, wallet, domain, selector, key_p, sealed }) => verify(&guild, &wallet, &domain, &selector, &key_p, &sealed),
        Err(e) => Err(format!("bad input: {e}")),
    };
    println!("{}", out.unwrap_or_else(|reason| json!({"ok": false, "reason": reason})));
}
