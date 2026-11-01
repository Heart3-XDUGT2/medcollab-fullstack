const path = require('path');
const arrowModule =
  process.env.CS_ARROW_MODULE ||
  require.resolve('@cornerstonejs/tools/tools/annotation/ArrowAnnotateTool');
const { HistoryMemo } = require(
  process.env.CS_HISTORY_MODULE || '@cornerstonejs/core/utilities/historyMemo'
);
const history = new HistoryMemo();
const annotations = new Map();
let nextUID = 0;

const dependency = (relative: string) => path.resolve(path.dirname(arrowModule), relative);
const mockDependency = (relative: string, factory: () => object) =>
  jest.doMock(dependency(relative), factory);

// Exercise the shipped Arrow class and HistoryMemo. Image/render collaborators
// are stubs here; the separate browser spec verifies their real integration.
jest.doMock('@cornerstonejs/core', () => ({
  utilities: { HistoryMemo: { DefaultHistoryMemo: history } },
  getEnabledElement: () => ({ viewport: {}, renderingEngine: {} }),
  getEnabledElementByViewportId: jest.fn(),
}));
mockDependency('../base/index.js', () => ({
  AnnotationTool: class {
    configuration: any;
    memo: any;
    constructor(props, defaults) {
      this.configuration = { ...defaults.configuration, ...props.configuration };
    }
    getToolName() {
      return 'ArrowAnnotate';
    }
    createAnnotation(evt, points, options) {
      return {
        annotationUID: `arrow-${++nextUID}`,
        data: { handles: { ...options.data.handles, points }, label: '' },
      };
    }
    createMemo(element, annotation, options) {
      if (this.memo) return;
      let present = true;
      this.memo = {
        restoreMemo() {
          present = !present;
          if (present) annotations.set(annotation.annotationUID, annotation);
          else annotations.delete(annotation.annotationUID);
        },
      };
      expect(options.newAnnotation).toBe(true);
      history.push(this.memo);
    }
    doneEditMemo() {
      this.memo = null;
    }
  },
}));
mockDependency('../../stateManagement/annotation/annotationState.js', () => ({
  addAnnotation: annotation => annotations.set(annotation.annotationUID, annotation),
  removeAnnotation: uid => annotations.delete(uid),
  getAnnotations: () => [...annotations.values()],
}));
mockDependency('../../enums/index.js', () => ({
  ChangeTypes: { HandlesUpdated: 'HandlesUpdated' },
  Events: {},
}));
mockDependency('../../stateManagement/annotation/annotationLocking.js', () => ({
  isAnnotationLocked: () => false,
}));
mockDependency('../../utilities/math/line/index.js', () => ({}));
mockDependency('../../drawingSvg/index.js', () => ({}));
mockDependency('../../store/state.js', () => ({ state: {} }));
mockDependency('../../utilities/viewportFilters/index.js', () => ({
  getViewportIdsWithToolToRender: () => ['test'],
}));
mockDependency('../../utilities/triggerAnnotationRenderForViewportIds.js', () => ({
  __esModule: true,
  default: jest.fn(),
}));
mockDependency('../../stateManagement/annotation/helpers/state.js', () => ({
  triggerAnnotationCompleted: jest.fn(),
  triggerAnnotationModified: jest.fn(),
}));
mockDependency('../../cursors/elementCursor.js', () => ({
  resetElementCursor: jest.fn(),
  hideElementCursor: jest.fn(),
}));
mockDependency('../../stateManagement/annotation/annotationVisibility.js', () => ({
  isAnnotationVisible: () => true,
}));
mockDependency('../../utilities/index.js', () => ({ setAnnotationLabel: jest.fn() }));
mockDependency('../../stateManagement/annotation/config/helpers.js', () => ({
  getStyleProperty: jest.fn(),
}));

const ArrowAnnotateTool = require(arrowModule).default;

const element = {
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
};
const event = () => ({
  detail: {
    element,
    currentPoints: { world: [1, 2, 3] },
    deltaPoints: { world: [0, 0, 0] },
  },
  preventDefault: jest.fn(),
});
const pendingArrow = tool => {
  const annotation = tool.addNewAnnotation(event());
  tool._dragCallback(event());
  tool._endCallback(event());
  return annotation;
};

describe('Arrow annotation history ownership', () => {
  beforeEach(() => {
    history.size = 50;
    annotations.clear();
  });

  test('empty text creates no memo, and redo cannot resurrect a cancelled arrow', () => {
    let done;
    const tool = new ArrowAnnotateTool({
      configuration: { getTextCallback: callback => { done = callback; } },
    });
    pendingArrow(tool);
    done('');
    expect(annotations.size).toBe(0);
    expect(history.isRecordingGrouped).toBe(false);
    expect(history.canUndo).toBe(false);
    history.undo();
    history.redo();
    expect(annotations.size).toBe(0);
  });

  test('undo of pending text preserves prior history and rejects late text', () => {
    let done;
    const earlier = jest.fn();
    history.push({ restoreMemo: earlier });
    const tool = new ArrowAnnotateTool({
      configuration: { getTextCallback: callback => { done = callback; } },
    });
    const arrow = pendingArrow(tool);
    history.undo();
    expect(earlier).not.toHaveBeenCalled();
    expect(annotations.size).toBe(0);
    expect(tool.isDrawing).toBe(false);
    const newer = history.startGroupRecording();
    done('late text');
    expect(arrow.data.label).toBe('');
    expect(newer.active).toBe(true);
    expect(history.isRecordingGrouped).toBe(true);
    history.endGroupRecording(newer);
    history.undo();
    expect(earlier).toHaveBeenCalledTimes(1);
  });

  test.each(['cancel', 'onSetToolPassive', 'onSetToolDisabled'])(
    '%s closes an unfinished arrow without leaving a creation memo',
    action => {
      const tool = new ArrowAnnotateTool();
      tool.addNewAnnotation(event());
      tool._dragCallback(event());
      tool[action](element);
      expect(annotations.size).toBe(0);
      expect(history.isRecordingGrouped).toBe(false);
      expect(history.canUndo).toBe(false);
      expect(tool.editData).toBeNull();
      history.redo();
      expect(annotations.size).toBe(0);
    }
  );

  test('a throwing text provider propagates its error and closes the group', () => {
    const failure = new Error('text provider failed');
    const tool = new ArrowAnnotateTool({
      configuration: { getTextCallback: () => { throw failure; } },
    });
    expect(() => pendingArrow(tool)).toThrow(failure);
    expect(history.isRecordingGrouped).toBe(false);
    expect(annotations.size).toBe(0);
    expect(() => history.push({ restoreMemo() {} })).not.toThrow();
  });

  test('successful arrow supports repeated undo/redo with one creation memo', () => {
    const tool = new ArrowAnnotateTool({
      configuration: { getTextCallback: callback => callback('accepted') },
    });
    const arrow = pendingArrow(tool);
    expect(arrow.data.label).toBe('accepted');
    expect(history.isRecordingGrouped).toBe(false);
    for (let i = 0; i < 3; i++) {
      history.undo();
      expect(annotations.size).toBe(0);
      history.redo();
      expect(annotations.size).toBe(1);
    }
  });
});
