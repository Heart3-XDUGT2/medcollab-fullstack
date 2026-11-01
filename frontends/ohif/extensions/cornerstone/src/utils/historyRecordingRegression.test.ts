// Defaults to the installed dependency; the override validates pnpm's isolated patch copy.
const { HistoryMemo } = require(
  process.env.CS_HISTORY_MODULE || '@cornerstonejs/core/utilities/historyMemo'
);

const memo = (name: string, calls: string[] = []) => ({
  restoreMemo: (undo: boolean) => calls.push(`${undo ? 'undo' : 'redo'}:${name}`),
});

describe('annotation history group boundaries', () => {
  test('undo during a group allows the next ROI memo without discarding earlier history', () => {
    const calls = [];
    const history = new HistoryMemo();
    history.push(memo('earlier', calls));
    history.startGroupRecording();
    history.push(memo('arrow', calls));
    history.undo();
    expect(history.isRecordingGrouped).toBe(false);
    expect(() => history.push(memo('livewire', calls))).not.toThrow();
    history.undo();
    history.undo();
    expect(calls).toEqual(['undo:arrow', 'undo:livewire', 'undo:earlier']);
  });

  test('redo closes an empty open group and retains the existing redo branch', () => {
    const calls = [];
    const history = new HistoryMemo();
    history.push(memo('earlier', calls));
    history.undo();
    history.startGroupRecording();
    history.redo();
    expect(history.isRecordingGrouped).toBe(false);
    expect(calls).toEqual(['undo:earlier']);
    expect(history.canRedo).toBe(true);
    history.redo();
    expect(calls).toEqual(['undo:earlier', 'redo:earlier']);
    expect(() => history.push(memo('freehand', calls))).not.toThrow();
  });

  test('undo of an empty in-progress group does not undo an earlier annotation', () => {
    const calls = [];
    const history = new HistoryMemo();
    history.push(memo('earlier', calls));
    const owner = history.startGroupRecording();
    history.undo();
    expect(owner.active).toBe(false);
    expect(calls).toEqual([]);
    expect(history.canUndo).toBe(true);
    history.undo();
    expect(calls).toEqual(['undo:earlier']);
  });

  test('a late owner cannot close a newer operation after undo', () => {
    const history = new HistoryMemo();
    const stale = history.startGroupRecording();
    history.push(memo('arrow'));
    history.undo();
    const current = history.startGroupRecording();
    history.endGroupRecording(stale);
    expect(stale.active).toBe(false);
    expect(current.active).toBe(true);
    expect(history.isRecordingGrouped).toBe(true);
    history.push(memo('livewire'));
    history.endGroupRecording(current);
    expect(history.isRecordingGrouped).toBe(false);
  });

  test('history interruption cancels its owners once, but normal completion does not', () => {
    const history = new HistoryMemo();
    const cancel = jest.fn();
    const owner = history.startGroupRecording(cancel);
    history.undo();
    history.endGroupRecording(owner);
    history.redo();
    expect(cancel).toHaveBeenCalledTimes(1);
    history.startGroupRecording(cancel);
    history.endGroupRecording();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test('empty groups preserve wrapped history and redo across repeated cancellation', () => {
    const calls = [];
    const history = new HistoryMemo('test', 3);
    for (const name of ['a', 'b', 'c', 'd']) history.push(memo(name, calls));
    history.undo();
    for (let i = 0; i < 5; i++) {
      history.startGroupRecording();
      history.endGroupRecording();
    }
    history.redo();
    history.undo(3);
    expect(calls).toEqual(['undo:d', 'redo:d', 'undo:d', 'undo:c', 'undo:b']);
  });

  test('resizing history resets recording state as well as its explicitly reset storage', () => {
    const history = new HistoryMemo();
    history.startGroupRecording();
    history.push(memo('old'));
    history.size = 8;
    expect(history.canUndo).toBe(false);
    expect(history.isRecordingGrouped).toBe(false);
    expect(() => history.push(memo('next ROI'))).not.toThrow();
  });

  test('nested owners form one group and inner completion does not close the outer owner', () => {
    const calls = [];
    const history = new HistoryMemo();
    history.startGroupRecording();
    history.push(memo('outer', calls));
    history.startGroupRecording();
    history.push(memo('inner', calls));
    history.endGroupRecording();
    expect(history.isRecordingGrouped).toBe(true);
    history.push(memo('outer-last', calls));
    history.endGroupRecording();
    history.undo();
    expect(calls).toEqual(['undo:outer-last', 'undo:inner', 'undo:outer']);
    history.redo();
    expect(calls.slice(3)).toEqual(['redo:outer', 'redo:inner', 'redo:outer-last']);
  });

  test('an empty cancelled group preserves prior entries at ring capacity', () => {
    const calls = [];
    const history = new HistoryMemo('test', 3);
    for (const name of ['a', 'b', 'c']) history.push(memo(name, calls));
    history.startGroupRecording();
    history.endGroupRecording();
    history.undo(3);
    expect(calls).toEqual(['undo:c', 'undo:b', 'undo:a']);
  });

  test('new committed drawing invalidates redo; repeated undo/redo preserve group order', () => {
    const calls = [];
    const history = new HistoryMemo();
    history.push(memo('prior', calls));
    history.startGroupRecording();
    history.push(memo('one', calls));
    history.push(memo('two', calls));
    history.endGroupRecording();
    for (let i = 0; i < 3; i++) { history.undo(); history.redo(); }
    expect(calls).toEqual(Array(3).fill(['undo:two', 'undo:one', 'redo:one', 'redo:two']).flat());
    history.undo();
    history.push(memo('new ROI', calls));
    expect(history.canRedo).toBe(false);
  });
});
