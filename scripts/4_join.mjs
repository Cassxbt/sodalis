// node 4_join.mjs <member> <letter.json> [--sealed-from <file>]  -- seals (or replays) a letter and joins.
import { readFileSync, writeFileSync } from 'node:fs';
import { load, state, call, view, executionDeposit } from './lib.mjs';
import { seal } from './seal.mjs';

const [member, letterPath, flag, replayPath] = process.argv.slice(2);
const who = load(member);
const { guild } = state();
const { inbox } = await view(who, guild, 'get_config');
const letter = JSON.parse(readFileSync(letterPath, 'utf8'));
const sealed = flag === '--sealed-from' ? readFileSync(replayPath, 'utf8') : seal(inbox, { eml: letter.eml, salt: letter.salt });
writeFileSync(`${letterPath}.sealed`, sealed);
const before = BigInt((await who.getState()).balance.total);
const r = await call(who, guild, 'join', { domain: letter.domain, selector: letter.selector, sealed }, { deposit: (await executionDeposit(who)) + 5n * 10n ** 21n });
const after = BigInt((await who.getState()).balance.total);
console.log(JSON.stringify({ member: who.accountId, tx: r.tx, result: r.ret, failures: r.failures, logs: r.logs.filter((l) => l.startsWith('EVENT_JSON')), cost_near: Number(before - after) / 1e24 }, null, 1));
console.log('member record:', JSON.stringify(await view(who, guild, 'get_member', { account_id: who.accountId })));
