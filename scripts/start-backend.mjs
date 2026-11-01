import fs from 'node:fs';
import path from 'node:path';
import { root, backend, windows, run, localEnvironment } from './common.mjs';

const env = localEnvironment();
const runtime = path.join(root, '.runtime');
const segmentation = path.join(runtime, 'segmentation');
fs.mkdirSync(segmentation, { recursive: true });
const python = env.SEGMENTATION_PYTHON || path.join(backend, '.venv', windows ? 'Scripts/python.exe' : 'bin/python');
if (!fs.existsSync(python)) throw new Error('Python environment missing. Create backend/.venv and install backend/python/requirements-seg.txt; see deploy/README.md.');
const jar = path.join(backend, 'target', 'demo-0.0.1-SNAPSHOT.jar');
if (!fs.existsSync(jar)) throw new Error('Backend JAR missing. Run node scripts/build.mjs backend.');
Object.assign(env, {
  SERVER_ADDRESS: '127.0.0.1',
  SERVER_PORT: '8082',
  APP_BASE_URL: 'http://127.0.0.1:8080',
  KEYCLOAK_ISSUER_URI: 'http://127.0.0.1:8081/realms/medical-demo',
  KEYCLOAK_CLIENT_ID: 'medical-demo-web',
  KEYCLOAK_DIRECTORY_CLIENT_ID: 'medical-demo-directory',
  ORTHANC_BASE_URL: 'http://127.0.0.1:8042',
  APP_DATABASE_URL: `jdbc:h2:file:${path.join(runtime, 'access-control').replaceAll('\\', '/')};DB_CLOSE_ON_EXIT=FALSE`,
  SEGMENTATION_PYTHON: python,
  SEGMENTATION_CODEC_SCRIPT: path.join(backend, 'python', 'seg_codec.py'),
  SEGMENTATION_WORK_DIR: segmentation,
});
if (!env.KEYCLOAK_CLIENT_SECRET || !env.KEYCLOAK_DIRECTORY_CLIENT_SECRET) throw new Error('Local Keycloak secrets are missing.');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', windows ? 'java.exe' : 'java') : 'java';
run(java, [`-Djava.io.tmpdir=${runtime}`, '-jar', jar], { cwd: backend, env });
