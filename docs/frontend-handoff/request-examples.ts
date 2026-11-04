/**
 * Request building examples only. Prefer Portal api.ts / DatasetWorkspace in the existing apps.
 * No account creation, authentication submission, or writes execute on import.
 * These helpers do not replace runtime DTO validation, UI cancellation/generation guards,
 * IndexedDB transactions, publication freezing or conflict handling.
 */
import type {
  Dataset, Identity, ImportResult, Items, LabelmapRequest, LabelmapWorkspace,
  Launch, SegmentationStatus, Session, User,
  PersonalAnnotationStats, DatasetAnnotationStats, SeriesAnnotationStats,
} from './contracts';

const encode = encodeURIComponent;
const MAX_IMPORT_BYTES = 1024 * 1024 * 1024;
const datasetPath = (id: string) => `/api/datasets/${encode(id)}`;
const segmentationPath = (datasetId: string, seriesId: string) =>
  `${datasetPath(datasetId)}/segmentations/${encode(seriesId)}`;

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function checked(response: Response): Promise<Response> {
  if (!response.ok) {
    let message = `请求失败 (${response.status})`;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
        message = body.error;
      }
    } catch { /* Preserve a readable fallback for non-JSON proxy errors. */ }
    throw new HttpError(response.status, message);
  }
  return response;
}

async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await checked(await fetch(path, {
    credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
  }));
  // Existing Portal validates this unknown JSON against DTO fields; keep that validation.
  return await response.json() as T;
}

export const session = (signal?: AbortSignal) => read<Session>('/api/session', signal);

/** Identity comes from the session. Never pass a username/subject to read another user's total. */
export const personalAnnotationStats = (signal?: AbortSignal) =>
  read<PersonalAnnotationStats>('/api/me/annotation-stats', signal);
export const datasetAnnotationStats = (datasetId: string, signal?: AbortSignal) =>
  read<DatasetAnnotationStats>(`${datasetPath(datasetId)}/annotation-stats`, signal);
export const seriesAnnotationStats = (datasetId: string, seriesId: string, signal?: AbortSignal) =>
  read<SeriesAnnotationStats>(`${segmentationPath(datasetId, seriesId)}/stats`, signal);

async function freshHeaders(identity: Identity, signal?: AbortSignal): Promise<Headers> {
  const current = await session(signal);
  if (!current.loggedIn || !current.issuer || !current.subject) throw new HttpError(401, '请重新登录');
  if (current.issuer !== identity.issuer || current.subject !== identity.subject) {
    throw new HttpError(409, '账户已切换，停止发送原账号的操作');
  }
  signal?.throwIfAborted();
  return new Headers({ [current.csrfHeaderName]: current.csrfToken });
}

async function write(
  path: string, method: string, identity: Identity,
  options: { json?: unknown; form?: FormData; signal?: AbortSignal; workspace?: boolean } = {}
): Promise<Response> {
  const headers = await freshHeaders(identity, options.signal);
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form; // Browser generates the multipart boundary.
  } else if (options.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.json);
  }
  if (options.workspace) {
    headers.set('X-Medcollab-Issuer', identity.issuer);
    headers.set('X-Medcollab-Subject', identity.subject);
  }
  options.signal?.throwIfAborted();
  // No automatic retry. An aborted/failed request may already have committed on the server.
  return checked(await fetch(path, {
    method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers, body, signal: options.signal,
  }));
}

export const listDatasets = (signal?: AbortSignal) => read<Items<Dataset>>('/api/datasets', signal);
export const searchUsers = (query: string, signal?: AbortSignal) =>
  read<Items<User>>(`/api/users?${new URLSearchParams({ q: query.trim() })}`, signal);
export const launchContext = (datasetId: string, signal?: AbortSignal) =>
  read<Launch>(`${datasetPath(datasetId)}/workspace`, signal);
export const readLabelmap = (datasetId: string, seriesId: string, signal?: AbortSignal) =>
  read<LabelmapWorkspace>(`${segmentationPath(datasetId, seriesId)}/labelmap`, signal);

export async function createDataset(name: string, identity: Identity, signal?: AbortSignal): Promise<Dataset> {
  const response = await write('/api/datasets', 'POST', identity, { json: { name: name.trim() }, signal });
  return await response.json() as Dataset;
}

export async function importOne(
  datasetId: string, file: File, identity: Identity, signal?: AbortSignal
): Promise<ImportResult> {
  if (!file.size || file.size > MAX_IMPORT_BYTES) throw new Error('文件需非空且不超过 1 GiB');
  // Portal adds a 30-minute import deadline; this example retains the caller's cancellation signal.
  const form = new FormData(); form.append('file', file); form.append('datasetId', datasetId);
  return await (await write('/api/import', 'POST', identity, { form, signal })).json() as ImportResult;
}

/**
 * frozenRequest must ALREADY be durably stored with publishAttempted=true in the caller's IDB draft.
 * Keep precisely the same ID/version/content for an explicit retry after an unknown outcome.
 * Do not generate a new UUID in this function, auto-increment the version, or auto-retry it.
 * Only after success may the caller clear its draft via a CAS tombstone transaction.
 */
export async function sendPreparedPublication(
  datasetId: string, seriesId: string, identity: Identity,
  frozenRequest: Readonly<LabelmapRequest>, signal?: AbortSignal
): Promise<SegmentationStatus> {
  const response = await write(`${segmentationPath(datasetId, seriesId)}/publish-labelmap`, 'POST', identity, {
    json: frozenRequest, signal, workspace: true,
  });
  return await response.json() as SegmentationStatus;
}

/** Return a Blob for the current snapshot; this is NOT publication or a cloud save. */
export async function exportCurrent(
  datasetId: string, seriesId: string, identity: Identity,
  request: LabelmapRequest, signal?: AbortSignal
): Promise<Blob> {
  const response = await write(`${segmentationPath(datasetId, seriesId)}/export-labelmap`, 'POST', identity, {
    json: request, signal, workspace: true,
  });
  if (!response.headers.get('content-type')?.includes('application/dicom')) {
    throw new Error('导出未返回 DICOM；请保留本机内容并核对响应');
  }
  return response.blob();
}

// Authentication uses page navigation, e.g. location.assign('/auth/login') on the unified origin.
// Logout: POST /api/logout with fresh CSRF, clear the UI scope, validate the returned logoutUrl
// against deployment-owned allowed origins, then navigate. Reuse Portal's implementation.
