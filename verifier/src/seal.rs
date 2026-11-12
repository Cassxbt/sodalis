use chacha20poly1305::{aead::Aead, ChaCha20Poly1305, KeyInit, Nonce};
use hkdf::Hkdf;
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};

const INFO: &[u8] = b"blind-guild-inbox-v2";

pub struct Keys {
    pub inbox: StaticSecret,
    pub nullifier: [u8; 32],
}

/// Both keys come from the keystore-generated master, scoped to one guild, so
/// no person ever holds either of them.
pub fn derive(master: &[u8], guild: &str) -> Keys {
    let hk = Hkdf::<Sha256>::new(None, master);
    let mut inbox = [0u8; 32];
    let mut nullifier = [0u8; 32];
    hk.expand(format!("blind-guild/v2/inbox:{guild}").as_bytes(), &mut inbox).expect("32 bytes");
    hk.expand(format!("blind-guild/v2/nullifier:{guild}").as_bytes(), &mut nullifier).expect("32 bytes");
    Keys { inbox: StaticSecret::from(inbox), nullifier }
}

pub fn inbox_public(keys: &Keys) -> [u8; 32] {
    PublicKey::from(&keys.inbox).to_bytes()
}

/// Opens `[0x01 | ephemeral x25519 (32) | nonce (12) | ciphertext | tag (16)]`.
pub fn open(keys: &Keys, sealed: &[u8]) -> Result<Vec<u8>, &'static str> {
    if sealed.len() < 1 + 32 + 12 + 16 || sealed[0] != 1 {
        return Err("sealed payload is malformed");
    }
    let eph: [u8; 32] = sealed[1..33].try_into().unwrap();
    let shared = keys.inbox.diffie_hellman(&PublicKey::from(eph));
    let mut key = [0u8; 32];
    Hkdf::<Sha256>::new(None, shared.as_bytes()).expand(INFO, &mut key).expect("32 bytes");
    ChaCha20Poly1305::new(&key.into())
        .decrypt(Nonce::from_slice(&sealed[33..45]), &sealed[45..])
        .map_err(|_| "sealed payload does not open with this guild's inbox key")
}
