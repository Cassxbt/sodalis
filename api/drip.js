// Funds a brand-new member key with enough test NEAR to join. Every member is
// funded from this one account, so the funding trail says nothing about who
// they are. It only funds implicit accounts that do not exist yet, once.
import { Account, actions } from 'near-api-js';

const RPC = 'https://rpc.testnet.fastnear.com';
const AMOUNT = 300_000_000_000_000_000_000_000n;
const PER_IP_WINDOW_MS = 10 * 60 * 1000;
const recent = new Map();

async function exists(accountId) {
  const body = { jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: accountId } };
  const r = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  return Boolean(r.result);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const accountId = String(req.body?.account_id ?? '');
  if (!/^[0-9a-f]{64}$/.test(accountId)) return res.status(400).json({ error: 'only a new implicit account (64 hex characters) can be funded' });

  const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
  const last = recent.get(ip);
  if (last && Date.now() - last < PER_IP_WINDOW_MS) return res.status(429).json({ error: 'one new member per visitor every 10 minutes' });

  try {
    if (await exists(accountId)) return res.status(409).json({ error: 'this account already exists; the drip only funds new keys' });
    const drip = new Account(process.env.DRIP_ACCOUNT, RPC, process.env.DRIP_PRIVATE_KEY);
    const r = await drip.signAndSendTransaction({ receiverId: accountId, actions: [actions.transfer(AMOUNT)], throwOnFailure: true });
    recent.set(ip, Date.now());
    return res.status(200).json({ tx: r.transaction.hash, amount: '0.3', from: process.env.DRIP_ACCOUNT });
  } catch (e) {
    return res.status(502).json({ error: `drip failed: ${String(e.message ?? e).slice(0, 160)}` });
  }
}
