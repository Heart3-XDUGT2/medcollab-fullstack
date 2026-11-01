import type { EditState } from '../types';
import {
  formatBlockRange,
  formatLeaseRemaining,
  formatPersistedAt,
  formatRole,
  formatSaveState,
  formatWorkspaceError,
  isConflictCode,
  isMedCollabPath,
  parseBlockRange,
  readBlockRange,
  readLeaseExpiry,
  shortId,
  stateSignature,
} from './status';

describe('parseBlockRange', () => {
  it('parses the supported textual range formats', () => {
    expect(parseBlockRange('1-40')).toEqual({ start: 1, end: 40 });
    expect(parseBlockRange('1–40')).toEqual({ start: 1, end: 40 });
    expect(parseBlockRange(' 41 至 80 ')).toEqual({ start: 41, end: 80 });
    expect(parseBlockRange('81..120')).toEqual({ start: 81, end: 120 });
    expect(parseBlockRange('121~160')).toEqual({ start: 121, end: 160 });
  });

  it('parses JSON range payloads written by the assignment UI', () => {
    expect(parseBlockRange('{"start":1,"end":40}')).toEqual({ start: 1, end: 40 });
    expect(parseBlockRange('{"from":41,"to":80}')).toEqual({ start: 41, end: 80 });
    expect(parseBlockRange('[81,120]')).toEqual({ start: 81, end: 120 });
    expect(parseBlockRange('{"start":"121","end":"160"}')).toEqual({ start: 121, end: 160 });
  });

  it('rejects missing, malformed and inverted ranges', () => {
    const invalid = [
      '',
      '   ',
      '40-1',
      '0-40',
      '1-0',
      'a-b',
      '{}',
      '{"start":1}',
      null,
      undefined,
      42,
    ];
    invalid.forEach(value => expect(parseBlockRange(value)).toBeNull());
  });
});

describe('formatBlockRange', () => {
  it('renders the assigned range and the fallback', () => {
    expect(formatBlockRange({ start: 1, end: 40 })).toBe('我的区块 1–40');
    expect(formatBlockRange(null)).toBe('区块未分配');
    expect(formatBlockRange(undefined)).toBe('区块未分配');
  });
});

describe('formatLeaseRemaining', () => {
  const now = Date.parse('2026-11-01T00:00:00Z');

  it('formats minutes and hours without inventing lease data', () => {
    expect(formatLeaseRemaining(new Date(now + 90_000).toISOString(), now)).toBe('租约剩余 01:30');
    expect(formatLeaseRemaining(now + 3_661_000, now)).toBe('租约剩余 1:01:01');
    expect(formatLeaseRemaining(new Date(now - 1_000), now)).toBe('租约已到期');
  });

  it('returns null when no usable expiry is available', () => {
    expect(formatLeaseRemaining(null, now)).toBeNull();
    expect(formatLeaseRemaining(undefined, now)).toBeNull();
    expect(formatLeaseRemaining('', now)).toBeNull();
    expect(formatLeaseRemaining('not-a-date', now)).toBeNull();
  });
});

describe('readLeaseExpiry', () => {
  const base: EditState = {
    caseId: 'case-a',
    sessionId: 'session-a',
    intent: 'edit',
    versionId: null,
    ready: true,
    dirty: false,
    saving: false,
    leaseValid: true,
    readOnly: false,
  };
  const expiresAt = Date.parse('2026-11-01T00:05:00Z');

  it('reads an expiry only when the adapter marks the lease valid', () => {
    expect(
      readLeaseExpiry({ ...base, leaseExpiresAt: new Date(expiresAt).toISOString() } as EditState)
    ).toBe(expiresAt);
    expect(readLeaseExpiry({ ...base, leaseValid: false })).toBeNull();
    expect(readLeaseExpiry({ ...base })).toBeNull();
  });

  it('falls back to an optional workspace lease getter', () => {
    expect(
      readLeaseExpiry(
        { ...base },
        { getLease: () => ({ expiresAt: new Date(expiresAt).toISOString() }) }
      )
    ).toBe(expiresAt);
    expect(
      readLeaseExpiry(
        { ...base },
        {
          getLeaseExpiry: () => {
            throw new Error('boom');
          },
        }
      )
    ).toBeNull();
  });
});

describe('formatSaveState', () => {
  it('maps adapter saving/dirty state to the three labels', () => {
    expect(formatSaveState({ saving: true, dirty: true })).toEqual({
      label: '保存中…',
      tone: 'saving',
    });
    expect(formatSaveState({ saving: false, dirty: true })).toEqual({
      label: '未保存',
      tone: 'dirty',
    });
    expect(formatSaveState({ saving: false, dirty: false })).toEqual({
      label: '已保存',
      tone: 'saved',
    });
    expect(formatSaveState(null)).toEqual({ label: '已保存', tone: 'saved' });
  });
});

describe('formatRole', () => {
  it('shows edit only for writable edit sessions', () => {
    expect(formatRole({ intent: 'edit', readOnly: false })).toBe('编辑');
    expect(formatRole({ intent: 'edit', readOnly: true })).toBe('只读');
    expect(formatRole({ intent: 'review', readOnly: false })).toBe('只读');
    expect(formatRole(null)).toBe('只读');
  });
});

describe('formatPersistedAt', () => {
  const now = new Date(2026, 10, 1, 15, 30, 0).getTime();

  it('shows the time for today and the date for other days', () => {
    expect(formatPersistedAt(new Date(2026, 10, 1, 14, 5, 0).toISOString(), now)).toBe('14:05');
    expect(formatPersistedAt(new Date(2026, 9, 31, 23, 59, 0).toISOString(), now)).toBe(
      '10-31 23:59'
    );
  });

  it('returns null for missing or invalid timestamps', () => {
    expect(formatPersistedAt(null, now)).toBeNull();
    expect(formatPersistedAt('nope', now)).toBeNull();
  });
});

describe('shortId', () => {
  it('truncates long identifiers and keeps short ones intact', () => {
    expect(shortId('abcdefghijklmnop', 8)).toBe('abcdefgh…');
    expect(shortId('case-1', 8)).toBe('case-1');
    expect(shortId('', 8)).toBe('');
    expect(shortId(null)).toBe('');
  });
});

describe('readBlockRange', () => {
  it('reads the block range from the provided storage', () => {
    const storage = {
      getItem: (key: string) => (key === 'medcollab.blockRange' ? '1-40' : null),
    };
    expect(readBlockRange(storage)).toEqual({ start: 1, end: 40 });
    expect(readBlockRange(null)).toBeNull();
  });

  it('does not throw when storage access is denied', () => {
    const storage = {
      getItem: () => {
        throw new Error('denied');
      },
    };
    expect(readBlockRange(storage)).toBeNull();
  });
});

describe('isConflictCode', () => {
  it('recognises lease/version conflicts and HTTP conflict statuses', () => {
    expect(isConflictCode('REVISION_MISMATCH')).toBe(true);
    expect(isConflictCode('LEASE_EXPIRED')).toBe(true);
    expect(isConflictCode('CASE_BUSY')).toBe(true);
    expect(isConflictCode('CONFLICT')).toBe(true);
    expect(isConflictCode('HTTP_409')).toBe(true);
    expect(isConflictCode('HTTP_423')).toBe(true);
    expect(isConflictCode('SAVE_FAILED')).toBe(false);
    expect(isConflictCode(undefined)).toBe(false);
  });
});

describe('formatWorkspaceError', () => {
  it('extracts adapter codes and suppresses duplicate messages', () => {
    expect(
      formatWorkspaceError({ code: 'REVISION_MISMATCH', message: 'REVISION_MISMATCH' })
    ).toEqual({ code: 'REVISION_MISMATCH', message: '', conflict: true });
  });

  it('falls back to the generic error message', () => {
    expect(formatWorkspaceError(new Error('network'))).toEqual({
      code: 'UNKNOWN',
      message: 'network',
      conflict: false,
    });
    expect(formatWorkspaceError(null)).toEqual({ code: 'UNKNOWN', message: '', conflict: false });
  });
});

describe('isMedCollabPath', () => {
  it('matches only /medcollab and its child routes', () => {
    expect(isMedCollabPath('/medcollab')).toBe(true);
    expect(isMedCollabPath('/medcollab/')).toBe(true);
    expect(isMedCollabPath('/medcollab/ohif')).toBe(true);
    expect(isMedCollabPath('/viewer')).toBe(false);
    expect(isMedCollabPath('/medcollab2')).toBe(false);
    expect(isMedCollabPath(null)).toBe(false);
  });
});

describe('stateSignature', () => {
  const base: EditState = {
    caseId: 'case-a',
    sessionId: 'session-a',
    intent: 'edit',
    versionId: null,
    ready: true,
    dirty: false,
    saving: false,
    leaseValid: true,
    readOnly: false,
  };

  it('is stable for equal state and changes with relevant fields', () => {
    expect(stateSignature(base)).toBe(stateSignature({ ...base }));
    expect(stateSignature({ ...base, readOnly: true })).not.toBe(stateSignature(base));
    expect(stateSignature({ ...base, dirty: true })).not.toBe(stateSignature(base));
    expect(stateSignature(null)).toBe('');
  });
});
