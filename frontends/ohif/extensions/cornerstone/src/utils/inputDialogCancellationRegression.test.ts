const path = require('path');

jest.mock('@cornerstonejs/tools/utilities', () => ({ setAnnotationLabel: jest.fn() }));
jest.mock('@cornerstonejs/tools', () => ({ annotation: {} }));
jest.mock('@ohif/ui-next', () => ({ LabellingFlow: jest.fn(), InputDialog: jest.fn() }));

const { callInputDialog } = require(
  process.env.OHIF_INPUT_DIALOG_MODULE ||
  path.resolve(__dirname, '../../../default/src/utils/callInputDialog.tsx')
);

describe('arrow input dialog cancellation contract', () => {
  const setup = (onCancel = jest.fn()) => {
    const service = { show: jest.fn(), hide: jest.fn() };
    const result = callInputDialog({ uiDialogService: service, onCancel });
    return { service, result, onCancel, dialog: service.show.mock.calls[0][0] };
  };

  test.each(['Cancel', 'Escape', 'close button'])('%s settles the opted-in caller once', async () => {
    const { service, result, onCancel, dialog } = setup();
    // ManagedDialog funnels all three UI paths through the same onClose callback.
    // The browser spec exercises the distinct buttons/keyboard path themselves.
    dialog.onClose();
    dialog.onClose();
    await expect(result).resolves.toBe('');
    expect(service.hide).toHaveBeenCalledWith('dialog-enter-annotation');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('save followed by hide does not also report cancellation', async () => {
    const { result, onCancel, dialog } = setup();
    dialog.contentProps.onSave('accepted');
    dialog.onClose();
    await expect(result).resolves.toBe('accepted');
    expect(onCancel).not.toHaveBeenCalled();
  });

  test('callers that did not opt in keep their existing cancellation contract', async () => {
    const service = { show: jest.fn(), hide: jest.fn() };
    let settled = false;
    callInputDialog({ uiDialogService: service }).then(() => { settled = true; });
    service.show.mock.calls[0][0].onClose();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(service.hide).toHaveBeenCalledWith('dialog-enter-annotation');
  });
});
