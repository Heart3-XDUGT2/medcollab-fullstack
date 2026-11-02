/** @jest-environment jsdom */
import { SliceEditGate } from './SliceEditGate';

async function settle() { for (let i=0;i<8;i++) await Promise.resolve(); }
function setup() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  let grant!: () => void;
  const options = { scope: jest.fn(() => ['slice-a']), holds: jest.fn(() => false),
    touch: jest.fn(), error: jest.fn(), acquire: jest.fn(() => new Promise<void>(resolve => { grant = resolve; })) };
  const gate = new SliceEditGate(options);
  const events: string[] = [];
  for (const type of ['mousedown','mousemove','mouseup']) target.addEventListener(type, () => events.push(type));
  const send = (type: string, buttons=1) => target.dispatchEvent(new MouseEvent(type, {bubbles:true,cancelable:true,button:0,buttons}));
  return {target,options,gate,events,send,grant:()=>grant()};
}
test('holds and then replays the complete first stroke only after acquiring the slice', async () => {
  const f=setup();
  try {
    f.send('mousedown');f.send('mousemove');f.send('mouseup',0);
    expect(f.events).toEqual([]);
    f.grant();await settle();
    expect(f.events).toEqual(['mousedown','mousemove','mouseup']);
    expect(f.options.error).not.toHaveBeenCalled();
  } finally { f.gate.destroy();f.target.remove(); }
});
test('a locked CT slice prevents every brush event from reaching the canvas', async () => {
  const f=setup();
  f.options.acquire.mockImplementation(() => Promise.reject(new Error('切片正在编辑')));
  try {
    f.send('mousedown');f.send('mousemove');f.send('mouseup',0);await settle();
    expect(f.events).toEqual([]);
    expect(f.options.error).toHaveBeenCalled();
  } finally { f.gate.destroy();f.target.remove(); }
});
test('switching slices during acquisition never replays a stroke onto the new image', async () => {
  const f=setup();
  try {
    f.send('mousedown');f.send('mouseup',0);
    f.options.scope.mockReturnValue(['slice-b']);f.grant();await settle();
    expect(f.events).toEqual([]);
    expect(f.options.error).toHaveBeenCalled();
  } finally { f.gate.destroy();f.target.remove(); }
});
