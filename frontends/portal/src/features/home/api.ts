export type Dataset = {
  id: string;
  name: string;
  access: 'owner' | 'shared' | 'public';
  ownerUsername: string;
  instanceCount: number;
  createdAt: string;
};

export type Session = {
  loggedIn: boolean;
  username: string | null;
  issuer: string | null;
  subject: string | null;
  csrfToken: string;
  csrfHeaderName: string;
};

export type User = { subject: string; username: string };
export type Identity = { issuer: string; subject: string };
export type Instance = { id: string; instanceNumber: string };
export type ImportResult = { status: 'Success' | 'AlreadyStored'; id: string };
export type HomeConfig = {
  apiEnabled: boolean;
  authOrigin: string | null;
  logoutOrigins: string[];
  workspacePath: string | null;
  publicSamplePath: string | null;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public kind?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const nullableString = (value: unknown) => value === null || typeof value === 'string';

function trustedOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      return null;
    return url.origin;
  } catch (_error) {
    return null;
  }
}

function workspacePath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  try {
    const origin = window.location.origin;
    const url = new URL(value, origin);
    if (url.origin !== origin || url.search || url.hash || value.includes('\\')) return null;
    return url.pathname;
  } catch (_error) {
    return null;
  }
}

export function getHomeConfig(): HomeConfig {
  const value = (window as any).config?.medcollab;
  const config = isObject(value) ? value : {};
  return {
    apiEnabled: config.apiEnabled === true,
    authOrigin: trustedOrigin(config.authOrigin),
    logoutOrigins: Array.isArray(config.logoutOrigins)
      ? config.logoutOrigins.map(trustedOrigin).filter((origin): origin is string => !!origin)
      : [],
    workspacePath: workspacePath(config.workspacePath),
    publicSamplePath: workspacePath(config.publicSamplePath),
  };
}

export function identityOf(session: Session): Identity | null {
  return session.loggedIn && nonempty(session.issuer) && nonempty(session.subject)
    ? { issuer: session.issuer, subject: session.subject }
    : null;
}

export function getAuthUrl(config: HomeConfig, kind: 'login' | 'register'): string | null {
  const origin = trustedOrigin(config.authOrigin);
  if (!origin || !['login', 'register'].includes(kind)) return null;
  return new URL(`/auth/${kind}`, origin).href;
}

export function getPublicSampleUrl(config: HomeConfig): string | null {
  return workspacePath(config.publicSamplePath);
}

export function buildWorkspaceUrl(
  config: HomeConfig,
  dataset: Dataset,
  intent: 'view' | 'annotate' = 'view'
): string | null {
  const pathname = workspacePath(config.workspacePath);
  if (!pathname || !nonempty(dataset.id) || !['view', 'annotate'].includes(intent)) return null;
  const query = new URLSearchParams({
    datasetId: dataset.id,
    access: dataset.access,
    intent,
    returnPath: '/home',
  });
  return `${pathname}?${query.toString()}`;
}

function isDataset(value: unknown): value is Dataset {
  return (
    isObject(value) &&
    nonempty(value.id) &&
    nonempty(value.name) &&
    ['owner', 'shared', 'public'].includes(value.access as string) &&
    typeof value.ownerUsername === 'string' &&
    Number.isInteger(value.instanceCount) &&
    Number(value.instanceCount) >= 0 &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt))
  );
}

function isSession(value: unknown): value is Session {
  return (
    isObject(value) &&
    typeof value.loggedIn === 'boolean' &&
    nullableString(value.username) &&
    nullableString(value.issuer) &&
    nullableString(value.subject) &&
    nonempty(value.csrfToken) &&
    !/[\r\n]/.test(value.csrfToken) &&
    nonempty(value.csrfHeaderName) &&
    /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value.csrfHeaderName) &&
    !/^(authorization|cookie|host|origin|referer|content-type|content-length|connection|sec-.+|proxy-.+)$/i.test(
      value.csrfHeaderName
    ) &&
    (!value.loggedIn || (nonempty(value.issuer) && nonempty(value.subject)))
  );
}

function isUser(value: unknown): value is User {
  return isObject(value) && nonempty(value.subject) && nonempty(value.username);
}

function isInstance(value: unknown): value is Instance {
  return isObject(value) && nonempty(value.id) && typeof value.instanceNumber === 'string';
}

function items<T>(value: unknown, validate: (item: unknown) => item is T): T[] {
  if (
    !isObject(value) ||
    !Array.isArray(value.items) ||
    value.total !== value.items.length ||
    !value.items.every(validate)
  ) {
    throw new ApiError('服务器返回的数据格式不符合接口约定', 0, 'protocol');
  }
  return value.items;
}

function validated<T>(value: unknown, validate: (item: unknown) => item is T): T {
  if (!validate(value)) throw new ApiError('服务器返回的数据格式不符合接口约定', 0, 'protocol');
  return value;
}

function validateName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 200) {
    throw new ApiError('名称去除首尾空白后需为 1–200 个字符', 400, 'validation');
  }
  return trimmed;
}

function validateId(value: string): string {
  if (!nonempty(value)) throw new ApiError('缺少有效的资源编号', 400, 'validation');
  return encodeURIComponent(value);
}

const errorMessages: Record<number, string> = {
  400: '请求内容不符合服务端要求，请检查后重试',
  401: '登录已失效，请重新登录后确认操作',
  403: '操作未获授权或会话校验已失效，请刷新会话后确认',
  404: '资源不存在或已失去访问权限',
  409: '内容存在冲突，请核对服务器状态后再决定是否重试',
  413: '文件超过 64 MiB 限制',
  415: '服务器不支持此文件或请求格式',
  500: '服务器处理失败，请保留当前操作并稍后重试',
  502: '影像服务返回异常，请稍后重试',
  503: '服务暂时不可用，请稍后重试',
  504: '服务响应超时，请先核对服务器状态',
};

export function createHomeApi(config: HomeConfig, fetchImpl?: typeof fetch) {
  const fetcher = fetchImpl || globalThis.fetch;
  const enabled = config.apiEnabled === true;
  const allowedLogoutOrigins = new Set(
    [trustedOrigin(config.authOrigin), ...config.logoutOrigins.map(trustedOrigin)].filter(
      (origin): origin is string => !!origin
    )
  );

  async function request(
    pathname: string,
    options: {
      method?: string;
      json?: unknown;
      body?: FormData;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    } = {}
  ): Promise<unknown> {
    if (!enabled) throw new ApiError('后端尚未配置，当前不能读取或写入云端影像', 0, 'unconfigured');
    if (options.signal?.aborted) throw new ApiError('请求已取消，请核对已完成的操作', 0, 'aborted');
    if (typeof fetcher !== 'function') throw new ApiError('当前无法连接服务', 0, 'network');
    const headers: Record<string, string> = { ...options.headers };
    let body: string | FormData | undefined = options.body;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    }
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      pathname === '/api/import' ? 90000 : 15000
    );
    const connectionFailure = (error: unknown) => {
      if (timedOut) return new ApiError('请求超时，请先核对服务器状态', 0, 'timeout');
      if (options.signal?.aborted || (error as Error)?.name === 'AbortError') {
        return new ApiError('请求已取消，请核对已完成的操作', 0, 'aborted');
      }
      return new ApiError('无法连接服务，请保留当前操作并检查连接', 0, 'network');
    };
    try {
      const response = await fetcher(pathname, {
        method: options.method || 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers,
        body,
        signal: controller.signal,
      }).catch((error) => {
        throw connectionFailure(error);
      });
      if (response.status !== 200) {
        throw new ApiError(
          errorMessages[response.status] || `请求失败（HTTP ${response.status}）`,
          response.status,
          'http'
        );
      }
      return await response.json().catch((error) => {
        if (timedOut || options.signal?.aborted) throw connectionFailure(error);
        throw new ApiError('服务器没有返回有效的 JSON 响应', 0, 'protocol');
      });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }

  async function getSession(signal?: AbortSignal): Promise<Session> {
    return validated(await request('/api/session', { signal }), isSession);
  }

  async function write(
    pathname: string,
    method: string,
    identity: Identity,
    options: { json?: unknown; body?: FormData; signal?: AbortSignal } = {}
  ) {
    // Tokens are used for this request only, never cached or persisted.
    const current = await getSession(options.signal);
    const freshIdentity = identityOf(current);
    if (!freshIdentity) throw new ApiError('请先登录后再继续操作', 401, 'signed-out');
    if (
      !identity ||
      freshIdentity.issuer !== identity.issuer ||
      freshIdentity.subject !== identity.subject
    ) {
      throw new ApiError('登录账号已变化，请重新载入本账号的影像', 401, 'identity-changed');
    }
    return await request(pathname, {
      ...options,
      method,
      headers: { [current.csrfHeaderName]: current.csrfToken },
    });
  }

  const datasetPath = (id: string) => `/api/datasets/${validateId(id)}`;
  const success = (value: unknown): value is { success: true } =>
    isObject(value) && value.success === true;

  return {
    getSession,
    async listDatasets(signal?: AbortSignal): Promise<Dataset[]> {
      return items(await request('/api/datasets', { signal }), isDataset);
    },
    async listInstances(id: string, signal?: AbortSignal): Promise<Instance[]> {
      return items(await request(`${datasetPath(id)}/instances`, { signal }), isInstance);
    },
    async listUsers(query: string, signal?: AbortSignal): Promise<User[]> {
      const q = query.trim();
      if (q.length < 2 || q.length > 100)
        throw new ApiError('账号搜索需为 2–100 个字符', 400, 'validation');
      return items(await request(`/api/users?${new URLSearchParams({ q })}`, { signal }), isUser);
    },
    async listShares(id: string, signal?: AbortSignal): Promise<User[]> {
      return items(await request(`${datasetPath(id)}/shares`, { signal }), isUser);
    },
    async createDataset(name: string, identity: Identity, signal?: AbortSignal): Promise<Dataset> {
      return validated(
        await write('/api/datasets', 'POST', identity, {
          json: { name: validateName(name) },
          signal,
        }),
        isDataset
      );
    },
    async renameDataset(
      id: string,
      name: string,
      identity: Identity,
      signal?: AbortSignal
    ): Promise<Dataset> {
      return validated(
        await write(datasetPath(id), 'PATCH', identity, {
          json: { name: validateName(name) },
          signal,
        }),
        isDataset
      );
    },
    async addShare(
      id: string,
      subject: string,
      identity: Identity,
      signal?: AbortSignal
    ): Promise<void> {
      validateId(subject);
      validated(
        await write(`${datasetPath(id)}/shares`, 'PUT', identity, {
          json: { subject },
          signal,
        }),
        success
      );
    },
    /** @deprecated Server returns 409: confirmed personal sharing is irrevocable. */
    async removeShare(
      id: string,
      subject: string,
      identity: Identity,
      signal?: AbortSignal
    ): Promise<void> {
      validated(
        await write(`${datasetPath(id)}/shares/${validateId(subject)}`, 'DELETE', identity, {
          signal,
        }),
        success
      );
    },
    async importFile(
      id: string,
      file: File,
      identity: Identity,
      signal?: AbortSignal
    ): Promise<ImportResult> {
      validateId(id);
      if (!(file instanceof File) || !file.size)
        throw new ApiError('请选择非空 DICOM 文件', 400, 'validation');
      if (file.size > 64 * 1024 * 1024)
        throw new ApiError('单文件不能超过 64 MiB', 413, 'validation');
      const body = new FormData();
      body.append('file', file);
      body.append('datasetId', id);
      const result = await write('/api/import', 'POST', identity, { body, signal });
      return validated(
        result,
        (value): value is ImportResult =>
          isObject(value) &&
          ['Success', 'AlreadyStored'].includes(value.status as string) &&
          nonempty(value.id)
      );
    },
    async logout(identity: Identity, signal?: AbortSignal): Promise<{ logoutUrl: string }> {
      const result = await write('/api/logout', 'POST', identity, { signal });
      try {
        if (!isObject(result) || typeof result.logoutUrl !== 'string') throw new Error();
        const url = new URL(result.logoutUrl, window.location.origin);
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          !allowedLogoutOrigins.has(url.origin)
        )
          throw new Error();
        return { logoutUrl: url.href };
      } catch (_error) {
        // Java may already have cleared its session; the caller must clear local data.
        throw new ApiError(
          '服务器已处理退出，但单点退出地址未获信任；本页不会跳转',
          200,
          'unsafe-redirect'
        );
      }
    },
  };
}

export type HomeApi = ReturnType<typeof createHomeApi>;
