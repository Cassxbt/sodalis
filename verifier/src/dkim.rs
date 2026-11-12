use base64::{engine::general_purpose::STANDARD, Engine};
use rsa::{pkcs1::DecodeRsaPublicKey, pkcs8::DecodePublicKey, Pkcs1v15Sign, RsaPublicKey};
use sha2::{Digest, Sha256};

pub struct Header {
    pub name: String,
    pub raw: String,
}

pub struct Message {
    pub headers: Vec<Header>,
    pub body: String,
}

pub struct Signature {
    pub domain: String,
    pub selector: String,
    pub signed_headers: Vec<String>,
    pub expires: Option<u64>,
}

pub fn parse(raw: &str) -> Result<Message, &'static str> {
    let raw = raw.replace("\r\n", "\n").replace('\n', "\r\n");
    let (head, body) = match raw.find("\r\n\r\n") {
        Some(i) => (&raw[..i + 2], &raw[i + 4..]),
        None => return Err("no header/body separator"),
    };
    let mut headers: Vec<Header> = Vec::new();
    for line in head.split_inclusive("\r\n") {
        if line.starts_with(' ') || line.starts_with('\t') {
            headers.last_mut().ok_or("continuation before first header")?.raw.push_str(line);
        } else if let Some(colon) = line.find(':') {
            headers.push(Header { name: line[..colon].trim().to_ascii_lowercase(), raw: line.to_string() });
        } else {
            return Err("malformed header line");
        }
    }
    Ok(Message { headers, body: body.to_string() })
}

pub fn header_value(h: &Header) -> String {
    let v = &h.raw[h.raw.find(':').unwrap() + 1..];
    collapse_wsp(&v.replace("\r\n", "")).trim_matches(&[' ', '\t'][..]).to_string()
}

fn collapse_wsp(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_ws = false;
    for c in s.chars() {
        if c == ' ' || c == '\t' {
            if !in_ws {
                out.push(' ');
            }
            in_ws = true;
        } else {
            out.push(c);
            in_ws = false;
        }
    }
    out
}

fn canon_header(h: &Header, relaxed: bool) -> String {
    if !relaxed {
        return h.raw.clone();
    }
    format!("{}:{}\r\n", h.name, header_value(h))
}

fn canon_body(body: &str, relaxed: bool, limit: Option<usize>) -> Vec<u8> {
    let mut lines: Vec<String> = body
        .split("\r\n")
        .map(|l| if relaxed { collapse_wsp(l).trim_end_matches(&[' ', '\t'][..]).to_string() } else { l.to_string() })
        .collect();
    while lines.last().is_some_and(|l| l.is_empty()) {
        lines.pop();
    }
    let mut out = String::new();
    for l in &lines {
        out.push_str(l);
        out.push_str("\r\n");
    }
    if out.is_empty() && !relaxed {
        out.push_str("\r\n");
    }
    let mut bytes = out.into_bytes();
    if let Some(l) = limit {
        bytes.truncate(l);
    }
    bytes
}

fn tags(value: &str) -> Vec<(String, String)> {
    value
        .split(';')
        .filter_map(|t| {
            let (k, v) = t.split_once('=')?;
            Some((k.trim().to_string(), v.chars().filter(|c| !c.is_whitespace()).collect()))
        })
        .collect()
}

fn strip_b_value(raw: &str) -> String {
    let colon = raw.find(':').unwrap();
    let (name, value) = raw.split_at(colon + 1);
    let parts: Vec<String> = value
        .split(';')
        .map(|t| match t.split_once('=') {
            Some((k, _)) if k.trim() == "b" => format!("{k}="),
            _ => t.to_string(),
        })
        .collect();
    let mut out = format!("{name}{}", parts.join(";"));
    if raw.ends_with("\r\n") && !out.ends_with("\r\n") {
        out.push_str("\r\n");
    }
    out
}

/// Verifies the first rsa-sha256 DKIM-Signature against the given DNS `p=` key.
pub fn verify(msg: &Message, key_p: &str) -> Result<Signature, String> {
    let sig_header = msg
        .headers
        .iter()
        .find(|h| h.name == "dkim-signature")
        .ok_or("no DKIM-Signature header")?;
    let t = tags(&sig_header.raw[sig_header.raw.find(':').unwrap() + 1..]);
    let get = |k: &str| t.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());

    if get("v").as_deref() != Some("1") {
        return Err("unsupported DKIM version".into());
    }
    if get("a").as_deref() != Some("rsa-sha256") {
        return Err("algorithm refused; only rsa-sha256".into());
    }
    let c = get("c").unwrap_or_else(|| "simple/simple".into());
    let (hc, bc) = c.split_once('/').unwrap_or((c.as_str(), "simple"));
    let (h_relaxed, b_relaxed) = (hc == "relaxed", bc == "relaxed");
    let domain = get("d").ok_or("missing d=")?.to_ascii_lowercase();
    let selector = get("s").ok_or("missing s=")?;
    let signed_headers: Vec<String> = get("h").ok_or("missing h=")?.split(':').map(|s| s.trim().to_ascii_lowercase()).collect();
    let limit = get("l").map(|l| l.parse::<usize>()).transpose().map_err(|_| "bad l=")?;
    if limit.is_some() {
        return Err("l= body length limit refused: unsigned content could be appended".into());
    }

    let body_hash = Sha256::digest(canon_body(&msg.body, b_relaxed, limit));
    if STANDARD.encode(body_hash) != get("bh").ok_or("missing bh=")? {
        return Err("body hash mismatch".into());
    }

    let mut used = vec![false; msg.headers.len()];
    let mut input = String::new();
    for name in &signed_headers {
        if let Some(i) = (0..msg.headers.len()).rev().find(|&i| !used[i] && msg.headers[i].name == *name) {
            used[i] = true;
            input.push_str(&canon_header(&msg.headers[i], h_relaxed));
        }
    }
    let stripped = Header { name: sig_header.name.clone(), raw: strip_b_value(&sig_header.raw) };
    let sig_canon = canon_header(&stripped, h_relaxed);
    input.push_str(sig_canon.trim_end_matches("\r\n"));

    let der = STANDARD.decode(key_p).map_err(|_| "bad key base64")?;
    let key = RsaPublicKey::from_public_key_der(&der)
        .or_else(|_| RsaPublicKey::from_pkcs1_der(&der))
        .map_err(|_| "bad RSA key")?;
    if rsa::traits::PublicKeyParts::size(&key) < 256 {
        return Err("RSA key shorter than 2048 bits refused".into());
    }
    let sig = STANDARD.decode(get("b").ok_or("missing b=")?).map_err(|_| "bad b= base64")?;
    key.verify(Pkcs1v15Sign::new::<Sha256>(), &Sha256::digest(input.as_bytes()), &sig)
        .map_err(|_| "signature invalid")?;

    let expires = get("x").and_then(|x| x.parse().ok());
    Ok(Signature { domain, selector, signed_headers, expires })
}
