export const HOME_MODULES = Object.freeze([
  'continue',
  'favorites',
  'recent',
  'library',
  'teams',
] as const);
export type HomeModule = (typeof HOME_MODULES)[number];
export type HomeEntry = 'work' | 'library';
export const HOME_MODULE_LABELS: Record<HomeModule, string> = {
  continue: '继续工作',
  favorites: '我的收藏',
  recent: '最近打开',
  library: '资料库入口',
  teams: '我的团队',
};
export type HomeComposition = Readonly<{
  defaultEntry: HomeEntry;
  order: readonly HomeModule[];
  hidden: readonly HomeModule[];
}>;
export function homeModuleGroups(composition: HomeComposition, includeHidden = false) {
  const visible = composition.order.filter(module => includeHidden || !composition.hidden.includes(module));
  return {
    primary: visible.filter(module => module === 'continue' || module === 'library'),
    reference: visible.filter(module => module !== 'continue' && module !== 'library'),
  };
}
export const DEFAULT_HOME_COMPOSITION: HomeComposition = Object.freeze({
  defaultEntry: 'work',
  order: Object.freeze(['continue', 'library', 'recent', 'favorites', 'teams'] as const),
  hidden: Object.freeze([]),
});
export type HomePreferences = Readonly<{
  layout: 'rows' | 'list' | 'cards';
  density: 'comfortable' | 'compact';
  groupBy: 'none' | 'source';
  fields: Readonly<{ owner: boolean; instances: boolean; createdAt: boolean }>;
  home: HomeComposition;
}>;
export type HomePreferencePatch = Partial<Omit<HomePreferences, 'fields'>> & {
  fields?: Partial<HomePreferences['fields']>;
};
export type PreferenceContext = {
  mode: 'real' | 'demo' | 'anonymous';
  identity?: { issuer: string; subject: string } | null;
};
export type PreferenceScope = 'account' | 'anonymous' | 'demo';
export type PersistenceState = 'loading' | 'local' | 'ephemeral' | 'unavailable' | 'recovered';
export const PREFERENCE_STORAGE_PREFIX = 'medcollab.home.display.v1.';
export const PREFERENCE_VERSION = 1;
const MAX_STORED_CHARACTERS = 2048;

function freeze(value: HomePreferences): HomePreferences {
  return Object.freeze({
    layout: value.layout,
    density: value.density,
    groupBy: value.groupBy,
    fields: Object.freeze({
      owner: value.fields.owner,
      instances: value.fields.instances,
      createdAt: value.fields.createdAt,
    }),
    home: Object.freeze({
      defaultEntry: value.home.defaultEntry,
      order: Object.freeze([...value.home.order]),
      hidden: Object.freeze([...value.home.hidden]),
    }),
  });
}
export const DEFAULT_HOME_PREFERENCES: HomePreferences = freeze({
  layout: 'rows',
  density: 'comfortable',
  groupBy: 'none',
  fields: { owner: true, instances: true, createdAt: true },
  home: DEFAULT_HOME_COMPOSITION,
});
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const only = (value: Record<string, unknown>, names: string[]) =>
  Object.keys(value).every((key) => names.includes(key));
function valid(value: unknown): value is HomePreferences {
  return (
    record(value) &&
    only(value, ['layout', 'density', 'groupBy', 'fields', 'home']) &&
    ['rows', 'list', 'cards'].includes(value.layout as string) &&
    ['comfortable', 'compact'].includes(value.density as string) &&
    ['none', 'source'].includes(value.groupBy as string) &&
    record(value.fields) &&
    only(value.fields, ['owner', 'instances', 'createdAt']) &&
    ['owner', 'instances', 'createdAt'].every(
      (key) => typeof (value.fields as Record<string, unknown>)[key] === 'boolean'
    ) &&
    validComposition(value.home)
  );
}
function validComposition(value: unknown): value is HomeComposition {
  if (
    !record(value) ||
    !only(value, ['defaultEntry', 'order', 'hidden']) ||
    !['work', 'library'].includes(value.defaultEntry as string)
  )
    return false;
  const modules = (input: unknown): input is HomeModule[] =>
    Array.isArray(input) &&
    input.every((item) => HOME_MODULES.includes(item)) &&
    new Set(input).size === input.length;
  return (
    modules(value.order) && value.order.length === HOME_MODULES.length && modules(value.hidden)
  );
}
export function decodePreferences(raw: string | null): {
  preferences: HomePreferences;
  recovered: boolean;
} {
  if (raw === null) return { preferences: DEFAULT_HOME_PREFERENCES, recovered: false };
  try {
    if (typeof raw !== 'string' || raw.length > MAX_STORED_CHARACTERS) throw new Error();
    const value: unknown = JSON.parse(raw);
    if (
      !record(value) ||
      !only(value, ['version', 'preferences']) ||
      value.version !== PREFERENCE_VERSION ||
      !record(value.preferences)
    )
      throw new Error();
    // Existing v1 records keep their library entry and every saved display choice.
    const preferences =
      'home' in value.preferences
        ? value.preferences
        : {
            ...value.preferences,
            home: { ...DEFAULT_HOME_COMPOSITION, defaultEntry: 'library' },
          };
    if (!valid(preferences)) throw new Error();
    return { preferences: freeze(preferences), recovered: false };
  } catch {
    return { preferences: DEFAULT_HOME_PREFERENCES, recovered: true };
  }
}
export function encodePreferences(preferences: HomePreferences): string {
  if (!valid(preferences)) throw new Error('Invalid display preferences');
  return JSON.stringify({ version: PREFERENCE_VERSION, preferences: freeze(preferences) });
}
export function samePreferences(a: HomePreferences, b: HomePreferences): boolean {
  return (
    a.layout === b.layout &&
    a.density === b.density &&
    a.groupBy === b.groupBy &&
    a.home.defaultEntry === b.home.defaultEntry &&
    a.home.order.join(',') === b.home.order.join(',') &&
    a.home.hidden.join(',') === b.home.hidden.join(',') &&
    a.fields.owner === b.fields.owner &&
    a.fields.instances === b.fields.instances &&
    a.fields.createdAt === b.fields.createdAt
  );
}
export function applyPreferencePatch(current: HomePreferences, patch: unknown): HomePreferences {
  try {
    if (!record(patch) || !only(patch, ['layout', 'density', 'groupBy', 'fields', 'home']))
      return current;
    if (
      'fields' in patch &&
      (!record(patch.fields) || !only(patch.fields, ['owner', 'instances', 'createdAt']))
    )
      return current;
    const next = {
      ...current,
      ...patch,
      fields: { ...current.fields, ...((patch.fields as object) || {}) },
    };
    if (!valid(next)) return current;
    return samePreferences(next, current) ? current : freeze(next);
  } catch {
    return current;
  }
}
export function preferenceScope(context: PreferenceContext): PreferenceScope {
  if (context.mode === 'demo') return 'demo';
  const identity = context.identity;
  return context.mode === 'real' &&
    identity &&
    [identity.issuer, identity.subject].every(
      (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 4096
    )
    ? 'account'
    : 'anonymous';
}
export async function createAccountStorageKey(
  identity: { issuer: string; subject: string },
  subtle: Pick<SubtleCrypto, 'digest'> | undefined = globalThis.crypto?.subtle
): Promise<string> {
  if (!subtle) throw new Error('Private account key derivation unavailable');
  const bytes = new TextEncoder().encode(
    JSON.stringify(['medcollab-display-v1', identity.issuer, identity.subject])
  );
  const digest = await subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );
  return PREFERENCE_STORAGE_PREFIX + hex;
}
