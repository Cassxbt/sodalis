// Re-verifies Sodalis decisions from public data only: the join transaction,
// OutLayer's attestation, Intel's collateral and the DAO's own records.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import dcap from '@phala/dcap-qvl';

export const NETWORK = {
  rpc: 'https://rpc.testnet.fastnear.com',
  // Regular nodes drop transactions and old state after a few epochs; history is read here.
  archive: 'https://archival-rpc.testnet.fastnear.com',
  attestations: 'https://testnet-api.outlayer.ai/attestations/by-tx/',
  pccs: dcap.PHALA_PCCS_URL,
  register: 'worker.outlayer.testnet',
  outlayer: 'outlayer.testnet',
};

const sha = (data) => bytesToHex(sha256(typeof data === 'string' ? utf8ToBytes(data) : data));
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const le = (n, size) => { const b = new Uint8Array(size); new DataView(b.buffer).setBigInt64(0, BigInt(n), true); return b; };
const short = (h) => `${String(h).slice(0, 12)}…`;
/** Exact yoctoNEAR to NEAR, without floating point. */
export const near = (yocto) => {
  const v = BigInt(yocto), whole = v / 10n ** 24n, frac = (v % 10n ** 24n).toString().padStart(24, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
};

async function rpc(method, params, { url = NETWORK.rpc, tries = 4 } = {}) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const d = await r.json();
      if (d.error) throw new Error(d.error.message ?? JSON.stringify(d.error));
      return d.result;
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 300 * 2 ** i));
    }
  }
}

/** A view call against current state, or against the state at `block` (a hash or height) from the archive. */
export async function view(contract, method, args = {}, block) {
  const at = block == null ? { finality: 'final' } : { block_id: block };
  const params = { request_type: 'call_function', ...at, account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args)) };
  const r = block == null ? await rpc('query', params) : await fromArchive('query', params);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(r.result)));
}

/** The archive holds old history but trails the head by a few blocks; the regular node covers the newest. */
async function fromArchive(method, params) {
  try {
    return await rpc(method, params, { url: NETWORK.archive, tries: 2 });
  } catch {
    return rpc(method, params);
  }
}

const txStatus = (hash, signer) => fromArchive('EXPERIMENTAL_tx_status', { tx_hash: hash, sender_account_id: signer, wait_until: 'FINAL' });
const blockHeight = async (hash) => (await fromArchive('block', { block_id: hash })).header.height;

/** Everything a join transaction recorded: the guild's request, OutLayer's answer and the guild's events. */
export async function readJoin(txHash, signer) {
  const tx = await txStatus(txHash, signer);
  const join = { request: null, requestedBy: null, requestBlock: null, output: null, events: [] };
  for (const o of tx.receipts_outcome) {
    for (const log of o.outcome.logs) {
      if (!log.startsWith('EVENT_JSON:')) continue;
      const e = JSON.parse(log.slice(11));
      if (e.event === 'execution_requested' && o.outcome.executor_id === NETWORK.outlayer) {
        const r = JSON.parse(e.data[0].request_data);
        join.request = r;
        join.requestedBy = r.predecessor_id;
        join.requestBlock = o.block_hash;
      } else if (e.standard === 'sodalis') {
        join.events.push({ event: e.event, ...e.data[0], emitter: o.outcome.executor_id });
      }
    }
    if (o.outcome.executor_id === NETWORK.outlayer && o.outcome.status.SuccessValue) join.output = b64(o.outcome.status.SuccessValue);
  }
  return join;
}

/** Intel's PCCS occasionally drops a request; a check should not fail on that alone. */
async function collateral(quote, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      return await dcap.getCollateral(NETWORK.pccs, quote);
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
}

/** report_data[0..32] as the OutLayer worker builds it (worker/src/tdx_attestation.rs). */
export function taskHash(a) {
  const parts = [utf8ToBytes(a.task_type), le(a.task_id, 8)];
  for (const k of ['repo', 'commit', 'build_target', 'wasm_hash', 'input_hash']) if (a[k]) parts.push(utf8ToBytes(String(a[k])));
  parts.push(utf8ToBytes(a.output_hash));
  if (a.block_height != null) parts.push(le(a.block_height, 8));
  for (const k of ['caller_account_id', 'project_id', 'secrets_ref']) if (a[k]) parts.push(utf8ToBytes(String(a[k])));
  parts.push(le(a.timestamp, 8));
  if (a.attached_usd != null) parts.push(utf8ToBytes(String(a.attached_usd)));
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (all.set(p, at), at + p.length), 0);
  return sha(all);
}

function measurements(quote) {
  const body = quote.subarray(48, 632);
  const m = (from) => bytesToHex(body.subarray(from, from + 48));
  return { mrtd: m(136), rtmr0: m(328), rtmr1: m(376), rtmr2: m(424), rtmr3: m(472), reportData: bytesToHex(body.subarray(520, 584)) };
}

/**
 * Checks one join end to end and returns `{checks, outcome}`; each check is
 * `{group, name, ok, detail}`. Groups: execution (the TEE run), admission
 * (the guild's decision) and seat (the DAO role). A refused join verifies its
 * execution and admission and has no seat group.
 */
export async function verifyJoin(txHash, signer, guild, now = BigInt(Math.floor(Date.now() / 1000)), { tamper = false } = {}) {
  const checks = [];
  const add = (group, name, ok, detail) => checks.push({ group, name, ok: Boolean(ok), detail });

  const join = await readJoin(txHash, signer);
  // Simulates a forged record in the browser: one flipped byte must break the chain of checks.
  if (tamper && join.output) join.output = Uint8Array.from(join.output, (b, i) => (i === 3 ? b ^ 1 : b));
  const att = await (await fetch(NETWORK.attestations + txHash)).json();
  const quote = b64(att.tdx_quote);
  const m = measurements(quote);
  const requestedHash = join.request?.code_source?.WasmUrl?.hash;

  try {
    const report = dcap.verify(quote, await collateral(quote), Number(now));
    add('execution', 'Intel signed this TDX quote (DCAP chain, TCB status)', report.status === 'UpToDate', `status ${report.status}${report.advisory_ids?.length ? `, advisories ${report.advisory_ids.join(', ')}` : ''}`);
  } catch (e) {
    add('execution', 'Intel signed this TDX quote (DCAP chain, TCB status)', false, String(e));
  }
  const approved = await view(NETWORK.register, 'is_measurements_approved', { measurements: { mrtd: m.mrtd, rtmr0: m.rtmr0, rtmr1: m.rtmr1, rtmr2: m.rtmr2, rtmr3: m.rtmr3 } });
  add('execution', 'The worker image is on OutLayer\'s approved list', approved === true, `${NETWORK.register}.is_measurements_approved = ${approved}`);
  add('execution', 'The quote commits to this exact task', m.reportData === taskHash(att) + '0'.repeat(64), `report_data ${short(m.reportData)}`);
  const height = join.requestBlock ? await blockHeight(join.requestBlock) : null;
  add('execution', 'The quote is for the request recorded on chain', height != null && Number(att.block_height) === height && att.caller_account_id === join.request?.sender_id && Number(att.request_id) === join.request?.request_id,
    `signed block ${att.block_height} and caller match OutLayer's request #${join.request?.request_id}`);
  add('execution', 'The guild itself requested this run', join.requestedBy === guild, `predecessor ${join.requestedBy}`);
  add('execution', 'The code that ran is the verifier the guild requested', requestedHash && att.wasm_hash === requestedHash && att.executed_wasm_sha256 === requestedHash, `${short(requestedHash)}`);
  add('execution', 'It ran on the request recorded on chain', join.request && sha(join.request.input_data) === att.input_hash, `sha256(input) ${short(att.input_hash)}`);
  add('execution', 'The guild acted on the output the TEE produced', join.output && sha(join.output) === att.output_hash, `sha256(output) ${short(att.output_hash)}`);

  const out = join.output ? JSON.parse(new TextDecoder().decode(join.output)) : {};
  const joined = join.events.find((e) => e.event === 'member_joined' && e.emitter === guild);
  const refused = join.events.find((e) => e.event === 'join_refused' && e.emitter === guild);
  if (joined) {
    add('admission', 'The guild admitted the wallet the verifier checked', joined.account_id === out.wallet && joined.domain === out.domain, `${joined.account_id} via ${joined.domain}`);
    add('admission', 'It recorded the nullifier the verifier derived', joined.nullifier === out.nullifier, `nullifier ${short(joined.nullifier)}`);
    const granted = join.events.find((e) => e.event === 'dao_role_granted' && e.emitter === guild && e.account_id === joined.account_id);
    if (granted) {
      const proposal = await view(granted.dao, 'get_proposal', { id: granted.proposal_id });
      const kind = proposal.kind?.AddMemberToRole;
      add('seat', 'The guild proposed exactly this seat', proposal.proposer === guild && kind?.member_id === joined.account_id && kind?.role === granted.role, `proposal #${granted.proposal_id}: ${kind?.member_id} → ${kind?.role}`);
      add('seat', 'The DAO approved it', proposal.status === 'Approved', `status ${proposal.status}`);
    } else {
      add('seat', 'The DAO seat was granted in this transaction', false, 'no dao_role_granted event');
    }
  } else {
    add('admission', 'The guild refused the join', Boolean(refused), refused ? refused.reason : 'no admission event');
  }
  const seat = join.events.find((e) => e.event === 'dao_role_granted' && e.emitter === guild);
  return { checks, outcome: joined ? { joined: true, ...joined, role: joined.role ?? seat?.role } : { joined: false, reason: refused?.reason }, attestation: { taskId: att.task_id, blockHeight: att.block_height } };
}

const rolesAt = async (dao, block) => {
  const { roles } = await view(dao, 'get_policy', {}, block);
  return (account) => roles.filter((r) => r.kind?.Group?.includes(account)).map((r) => r.name);
};
const callOf = (tx) => {
  const call = tx.transaction.actions.find((a) => a.FunctionCall)?.FunctionCall;
  return call ? { method: call.method_name, args: JSON.parse(atob(call.args)) } : {};
};

/**
 * A payout, step by step, with roles read as they stood when each step ran:
 * the member's request (step 0), the approval (step 2) and the DAO's transfer.
 */
export async function verifyPayout(dao, proposalId, proposeTx, approveTx, approver) {
  const checks = [];
  const add = (step, name, ok, detail) => checks.push({ group: 'payout', step, name, ok: Boolean(ok), detail });
  const proposal = await view(dao, 'get_proposal', { id: proposalId });
  const transfer = proposal.kind?.Transfer;

  const filed = await txStatus(proposeTx, proposal.proposer);
  const filedAt = filed.receipts_outcome.find((o) => o.outcome.executor_id === dao)?.block_hash;
  const proposerRoles = filedAt ? (await rolesAt(dao, filedAt))(proposal.proposer) : [];
  const returned = filed.status?.SuccessValue ? JSON.parse(atob(filed.status.SuccessValue)) : null;
  add(0, 'A member filed this payout request', filed.transaction.signer_id === proposal.proposer && callOf(filed).method === 'add_proposal' && filed.transaction.receiver_id === dao && returned === proposalId && Boolean(transfer) && ['public', 'staff'].some((r) => proposerRoles.includes(r)),
    `#${proposalId} by ${proposal.proposer} (${proposerRoles.join(', ') || 'no role'} then): ${near(transfer?.amount ?? 0)} NEAR to ${transfer?.receiver_id}`);

  const voted = await txStatus(approveTx, approver);
  const vote = callOf(voted);
  const votedAt = voted.receipts_outcome.find((o) => o.outcome.executor_id === dao)?.block_hash;
  const roleAtVote = votedAt ? await rolesAt(dao, votedAt) : () => [];
  const approvers = Object.entries(proposal.votes).filter(([, v]) => v === 'Approve').map(([a]) => a);
  add(2, 'Staff approved it', voted.status?.SuccessValue != null && proposal.votes[approver] === 'Approve' && vote.method === 'act_proposal' && vote.args.id === proposalId && vote.args.action === 'VoteApprove' && proposal.status === 'Approved'
    && approvers.length > 0 && approvers.every((a) => roleAtVote(a).some((r) => r === 'staff' || r === 'council')) && roleAtVote(approver).includes('staff'),
    `${approver} (${roleAtVote(approver).join(', ')} then) voted VoteApprove on #${proposalId}; status ${proposal.status}`);

  const outcomes = new Map(voted.receipts_outcome.map((o) => [o.id, o.outcome.status]));
  const paid = voted.receipts.filter((r) => r.predecessor_id === dao && r.receiver_id === transfer?.receiver_id)
    .flatMap((r) => (r.receipt.Action?.actions ?? []).filter((a) => a.Transfer).map((a) => ({ amount: BigInt(a.Transfer.deposit), ok: Boolean(outcomes.get(r.receipt_id)) && !outcomes.get(r.receipt_id).Failure })))
    .filter((t) => t.amount > 0n);
  add(2, 'The DAO transferred exactly that amount, successfully', paid.some((t) => t.ok && t.amount === BigInt(transfer?.amount ?? -1)), `${paid.map((t) => `${near(t.amount)} NEAR${t.ok ? '' : ' (failed)'}`).join(', ') || 'no transfer'} from ${dao}`);
  return checks;
}

/** A vote the DAO refused, e.g. a public member approving their own payout. */
export async function verifyRefusedVote(txHash, signer) {
  const tx = await txStatus(txHash, signer);
  const failure = tx.receipts_outcome.map((o) => o.outcome.status.Failure).find(Boolean);
  const message = JSON.stringify(failure ?? {});
  return [{ group: 'payout', name: `The DAO refused ${signer}'s approval`, ok: message.includes('ERR_PERMISSION_DENIED'), detail: message.includes('ERR_PERMISSION_DENIED') ? 'ERR_PERMISSION_DENIED' : message.slice(0, 120) }];
}

/** Finds `expect` in a transaction's refusal: a panic, a guild refusal event, or OutLayer's error. */
export async function verifyRefusal(txHash, signer, expect) {
  const tx = await txStatus(txHash, signer);
  const found = [];
  for (const o of tx.receipts_outcome) {
    const failure = o.outcome.status.Failure;
    if (failure) found.push({ where: o.outcome.executor_id, text: JSON.stringify(failure) });
    for (const log of o.outcome.logs) {
      if (!log.startsWith('EVENT_JSON:')) continue;
      const e = JSON.parse(log.slice(11));
      if (e.event === 'join_refused') found.push({ where: o.outcome.executor_id, text: e.data[0].reason });
      if (e.event === 'execution_completed' && e.data[0].error_message) found.push({ where: NETWORK.outlayer, text: e.data[0].error_message });
    }
  }
  const hit = found.find((f) => f.text.includes(expect));
  return { ok: Boolean(hit), where: hit?.where, text: hit ? expect : found[0]?.text?.slice(0, 160) ?? 'no refusal recorded' };
}
