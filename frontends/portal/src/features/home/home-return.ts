import type { Identity } from './api';

export type HomeReturnState = {
  search: string;
  workSearch?: string;
  sort: string;
  selectedId: string | null;
  scrollY: number;
};
let pending: { identity: Identity; state: HomeReturnState } | null = null;
const same = (a: Identity, b: Identity) => a.issuer === b.issuer && a.subject === b.subject;

/** One in-memory route return, never a persisted recent/history record or request cache. */
export function rememberHomeReturn(identity: Identity, state: HomeReturnState) {
  pending = { identity: { issuer: identity.issuer, subject: identity.subject }, state: { ...state } };
}
export function clearHomeReturn() { pending = null; }
export function checkHomeReturnIdentity(identity: Identity | null) {
  if (pending && (!identity || !same(pending.identity, identity))) pending = null;
}
export function takeHomeReturn(identity: Identity): HomeReturnState | null {
  const value = pending;
  pending = null;
  return value && same(value.identity, identity) ? { ...value.state } : null;
}
