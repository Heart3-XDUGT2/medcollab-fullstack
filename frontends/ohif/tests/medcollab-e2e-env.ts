import path from 'node:path';

export const runtime = path.resolve(
  process.env.MEDCOLLAB_E2E_RUNTIME || path.join(__dirname, '../.runtime/medcollab-e2e')
);
export const evidence = path.join(runtime, 'evidence');
export const origin = (process.env.MEDCOLLAB_E2E_ORIGIN || 'http://127.0.0.1:8080').replace(/\/$/, '');
export const datasetId = process.env.MEDCOLLAB_E2E_DATASET_ID || '';
