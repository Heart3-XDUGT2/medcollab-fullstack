import path from 'node:path';
import { root, run } from './common.mjs';
run(process.execPath, [path.join(root, 'gateway', 'unified-server.mjs')], {
  env: { ...process.env, PORTAL_PORT: '8080', PORTAL_JAVA_PORT: '8082' },
});
