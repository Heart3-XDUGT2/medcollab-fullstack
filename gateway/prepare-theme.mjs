import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const root = path.dirname(fileURLToPath(import.meta.url));
const portal = path.resolve(root, '../frontends/portal');
const require = createRequire(path.join(portal, 'package.json'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { Eye, EyeOff } = require('lucide-react');
const theme = path.join(root, 'theme/medcollab-portal/login');
for (const sub of ['resources/css', 'resources/fonts', 'resources/js']) await fs.mkdir(path.join(theme, sub), { recursive: true });
const files = [['src/styles.css', 'styles.css'], ['src/ui/ui.css', 'ui.css'], ['src/features/sign-in/sign-in.css', 'sign-in.css']];
const evidence = [];
for (const [source, destination] of files) {
  const content = await fs.readFile(path.join(portal, source));
  await fs.writeFile(path.join(theme, 'resources/css', destination), content);
  evidence.push({ source, destination, sha256: createHash('sha256').update(content).digest('hex') });
}
let fontCss = '';
for (const weight of [400, 500, 600, 700]) {
  const name = `inter-latin-${weight}-normal.woff2`;
  await fs.copyFile(path.join(portal, 'node_modules/@fontsource/inter/files', name), path.join(theme, 'resources/fonts', name));
  fontCss += `@font-face { font-family: Inter; font-style: normal; font-weight: ${weight}; font-display: swap; src: url('../fonts/${name}') format('woff2'); }\n`;
}
await fs.writeFile(path.join(theme, 'resources/css/fonts.css'), fontCss);
const icon = (component, name) => renderToStaticMarkup(React.createElement(component, { className: name, 'aria-hidden': true }));
await fs.writeFile(path.join(theme, 'icons.ftl'), `<#macro eye>\n${icon(Eye, 'mc-eye-visible')}\n${icon(EyeOff, 'mc-eye-hidden')}\n</#macro>\n`);
await fs.copyFile(path.join(portal, 'LICENSE'), path.join(root, 'theme/medcollab-portal/PORTAL-LICENSE'));
await fs.writeFile(path.join(root, 'theme-style-provenance.json'), JSON.stringify({ portal: 'frontends/portal', files: evidence, icons: 'Existing Portal lucide-react Eye/EyeOff', fonts: 'Existing Portal @fontsource/inter' }, null, 2));
console.log('Portal CSS copied unchanged; existing fonts and icons prepared.');
