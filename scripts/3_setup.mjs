// Pins the test company's DKIM key and has the guild fetch its inbox key from the TEE.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, admin, state, saveState, call, view, executionDeposit } from './lib.mjs';

const owner = admin();
const { guild } = state();
const company = JSON.parse(readFileSync(join(ROOT, '.keys/company.json'), 'utf8'));
const pin = await call(owner, guild, 'set_domain_key', { domain: company.domain, selector: company.selector, key_p: company.key_p }, { tgas: 30n });
console.log('pin tx', pin.tx, pin.failures);
const inbox = await call(owner, guild, 'init_inbox', {}, { deposit: await executionDeposit(owner) });
console.log('init_inbox tx', inbox.tx, JSON.stringify(inbox.ret), inbox.failures);
saveState({ pin_tx: pin.tx, inbox_tx: inbox.tx });
console.log(JSON.stringify(await view(owner, guild, 'get_config'), null, 1));
