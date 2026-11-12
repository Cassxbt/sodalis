// Pure helpers shared by the join page and the tests: challenge, email trimming, sealing.
import { x25519 } from '@noble/curves/ed25519.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

const SEAL_INFO = utf8ToBytes('blind-guild-inbox-v2');
const toBase64 = (b) => btoa(String.fromCharCode(...b));

export const newSalt = () => bytesToHex(randomBytes(32));

export const commitment = (guild, wallet, salt) => bytesToHex(sha256(utf8ToBytes(`blind-guild:v2:${guild}:${wallet}:${salt}`)));

/** The subject line the member sends; valid for at most 24 hours. */
export function challengeSubject(guild, wallet, salt, expiresAt) {
  return `bg2 ${commitment(guild, wallet, salt)} ${expiresAt}`;
}

/**
 * Keeps only the DKIM-Signature header and the headers it signs, plus the body.
 * Unsigned headers (Received, ARC, Authentication-Results) carry relay hops
 * and addresses the guild does not need, and they would only enlarge the letter.
 */
export function trimEml(raw) {
  const eml = raw.replace(/\r?\n/g, '\r\n');
  const split = eml.indexOf('\r\n\r\n');
  if (split < 0) throw new Error('not an email: no header/body separator');
  const fields = eml.slice(0, split).split(/\r\n(?![ \t])/);
  const signatures = fields.filter((f) => /^dkim-signature\s*:/i.test(f));
  if (signatures.length === 0) throw new Error('this email carries no DKIM signature');
  const h = signatures[0].replace(/\s+/g, '').match(/[:;]h=([^;]+)/i);
  if (!h) throw new Error('DKIM signature lists no signed headers');
  const signed = new Set(h[1].toLowerCase().split(':'));
  const kept = fields.filter((f) => /^dkim-signature\s*:/i.test(f) || signed.has(f.slice(0, f.indexOf(':')).trim().toLowerCase()));
  return `${kept.join('\r\n')}\r\n\r\n${eml.slice(split + 4)}`;
}

/** Seals `{eml, salt}` to the guild inbox: [0x01 | ephemeral X25519 | nonce | ChaCha20-Poly1305]. */
export function seal(inboxHex, letter) {
  const ephemeral = x25519.utils.randomSecretKey();
  const shared = x25519.getSharedSecret(ephemeral, hexToBytes(inboxHex));
  const key = hkdf(sha256, shared, new Uint8Array(0), SEAL_INFO, 32);
  const nonce = randomBytes(12);
  const ct = chacha20poly1305(key, nonce).encrypt(utf8ToBytes(JSON.stringify(letter)));
  const out = new Uint8Array(1 + 32 + 12 + ct.length);
  out.set([1], 0);
  out.set(x25519.getPublicKey(ephemeral), 1);
  out.set(nonce, 33);
  out.set(ct, 45);
  return toBase64(out);
}
