// Funds a brand-new member key with enough test NEAR to join, so a member never
// moves funds from a wallet they already own. The transfer is public: anyone can
// see which keys this drip funded. It only funds implicit accounts that do not
// exist yet. The per-visitor limit lives in this instance's memory, so it slows
// a drain rather than preventing one; the drip account holds only test NEAR.
import { Account, actions } from 'near-api-js';

const RPC = 'https://rpc.testnet.fastnear.com';
const AMOUNT = 300_000_000_000_000_000_000_000n;
const PER_IP_WINDOW_MS = 10 * 60 * 1000;
const FLOOR = 500_000_000_000_000_000_000_000n;
const recent = new Map();
const inFlight = new Set();

/** The account's balance, or null when it does not exist. Any other answer is an error, never "absent". */
async function balance(accountId) {
  const body = { jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: accountId } };
  const r = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  if (r.result) return BigInt(r.result.amount);
  if (r.error?.cause?.name === 'UNKNOWN_ACCOUNT') return null;
  throw new Error('could not read the account; try again shortly');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const accountId = String(req.body?.account_id ?? '');
  if (!/^[0-9a-f]{64}$/.test(accountId)) return res.status(400).json({ error: 'only a new implicit account (64 hex characters) can be funded' });

  const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
  const last = recent.get(ip);
  if (last && Date.now() - last < PER_IP_WINDOW_MS) return res.status(429).json({ error: 'one new member per visitor every 10 minutes' });

  if (inFlight.has(accountId)) return res.status(409).json({ error: 'this key is already being funded' });
  recent.set(ip, Date.now());
  inFlight.add(accountId);
  let signing = false;
  try {
    if ((await balance(accountId)) !== null) return res.status(409).json({ error: 'this account already exists; the drip only funds new keys' });
    if ((await balance(process.env.DRIP_ACCOUNT)) < FLOOR) {
      recent.delete(ip);
      return res.status(503).json({ error: 'the drip is empty for now; fund the key from any testnet faucet instead' });
    }
    const drip = new Account(process.env.DRIP_ACCOUNT, RPC, process.env.DRIP_PRIVATE_KEY);
    signing = true;
    const r = await drip.signAndSendTransaction({ receiverId: accountId, actions: [actions.transfer(AMOUNT)], throwOnFailure: true, waitUntil: 'FINAL' });
    return res.status(200).json({ tx: r.transaction.hash, amount: '0.3', from: process.env.DRIP_ACCOUNT });
  } catch (e) {
    // Once a transfer may have been sent, keep the visitor's slot so a retry cannot fund twice.
    if (!signing) recent.delete(ip);
    return res.status(502).json({ error: `drip failed: ${String(e.message ?? e).slice(0, 160)}` });
  } finally {
    inFlight.delete(accountId);
  }
}
