import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

const configFile = new URL('../frontends/ohif/platform/app/public/config/medcollab-server.js', import.meta.url);

test('deployed workspace uses Portal branding with explicit light-theme contrast', async () => {
  const context = { window: {}, location: { search: '?datasetId=demo' }, URLSearchParams };
  vm.runInNewContext(await fs.readFile(configFile, 'utf8'), context);
  const React = { createElement: (tag, props, ...children) => ({ tag, props, children }) };
  const logo = context.window.config.whiteLabeling.createLogoComponentFn(React);
  assert.equal(logo.props['data-cy'], 'medcollab-brand');
  assert.equal(logo.props.style.color, '#182524');
  assert.equal(logo.children[0].props.src, '/brand/medcollab-mark.svg');
  assert.equal(logo.children[0].props.alt, '');
  assert.equal(logo.children[1].children[0], 'MedCollab');
  const mark = await fs.readFile(new URL('../frontends/portal/public/brand/medcollab-mark.svg', import.meta.url), 'utf8');
  assert.match(mark, /<title>MedCollab<\/title>/);
  assert.match(mark, /stroke="#263F4B"/);
});
