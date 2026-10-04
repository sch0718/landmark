import { createNodeFs } from '../fs-port';
import { validateAll } from '../validate';

const { ok, errors } = await validateAll({ fs: createNodeFs() });
for (const e of errors) console.error(`${e.file}: ${e.message}`);
if (ok) console.log('검증 통과');
process.exit(ok ? 0 : 1);
