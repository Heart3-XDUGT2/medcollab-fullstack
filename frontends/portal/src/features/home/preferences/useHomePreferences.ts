import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { PreferenceSession, browserPreferenceEnvironment } from './session';
import type { PreferenceEnvironment, PreferenceSnapshot } from './session';
import type { HomePreferencePatch, PreferenceContext } from './model';

export type HomePreferencesModel = PreferenceSnapshot & {
  update: (patch: HomePreferencePatch) => void;
  reset: () => void;
};
export function useHomePreferences(
  context: PreferenceContext,
  environment: PreferenceEnvironment = browserPreferenceEnvironment
): HomePreferencesModel {
  const issuer = context.mode === 'real' ? context.identity?.issuer : undefined;
  const subject = context.mode === 'real' ? context.identity?.subject : undefined;
  const session = useMemo(() => new PreferenceSession({
    mode: context.mode, identity: issuer && subject ? { issuer, subject } : null,
  }, environment), [context.mode, issuer, subject, environment]);
  // Current-session snapshots are selected during render, before another identity
  // can paint. Layout cleanup invalidates old async work before the next paint.
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useLayoutEffect(() => {
    session.start();
    return () => session.dispose();
  }, [session]);
  return useMemo(() => ({ ...snapshot, update: session.update, reset: session.reset }), [snapshot, session]);
}
