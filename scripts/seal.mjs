import { createPublicKey, generateKeyPairSync, diffieHellman, hkdfSync, randomBytes, createCipheriv, createHash } from 'node:crypto';

const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');

/** Seals a letter to the guild inbox: [0x01 | eph x25519 | nonce | ct | tag], base64. */
export function seal(inboxHex, letter) {
  const recipient = createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, Buffer.from(inboxHex, 'hex')]), format: 'der', type: 'spki' });
  const eph = generateKeyPairSync('x25519');
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: recipient });
  const key = Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), 'blind-guild-inbox-v2', 32));
  const nonce = randomBytes(12);
  const cipher = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });
  const ct = Buffer.concat([cipher.update(JSON.stringify(letter)), cipher.final(), cipher.getAuthTag()]);
  const ephRaw = eph.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return Buffer.concat([Buffer.of(1), ephRaw, nonce, ct]).toString('base64');
}

export const commitment = (guild, wallet, salt) =>
  createHash('sha256').update(`blind-guild:v2:${guild}:${wallet}:${salt}`).digest('hex');

export const newSalt = () => randomBytes(32).toString('hex');
