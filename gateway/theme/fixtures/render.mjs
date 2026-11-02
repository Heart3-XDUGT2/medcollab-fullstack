// Static style fixtures only: not a FreeMarker renderer or an authentication endpoint.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const resources = '../medcollab-portal/login/resources';
const styles = ['fonts', 'styles', 'ui', 'sign-in', 'keycloak-adapter', 'auth'];
const field = (label, name, type = 'text', error = '') =>
  `<div class="medcollab-sign-in__field"><div class="medcollab-sign-in__label-row"><label for="${name}">${label}</label></div><input class="portal-input" id="${name}" name="${name}" type="${type}" readonly value="${type === 'password' ? '' : '样式验证账号'}" placeholder="${type === 'password' ? '固定只读字段' : ''}" aria-invalid="${!!error}" aria-describedby="${name}-error" autocomplete="off"><p class="medcollab-sign-in__field-error" id="${name}-error">${error}</p></div>`;
for (const screen of ['login', 'register', 'reset']) {
  const title = screen === 'login' ? '登录 MedCollab' : screen === 'register' ? '注册账号' : '找回密码';
  const fields = screen === 'register'
    ? field('账号', 'username') + field('邮箱', 'email', 'email') + field('密码', 'password', 'password') + field('确认密码', 'password-confirm', 'password', '两次输入的密码不一致')
    : screen === 'reset' ? field('邮箱或账号', 'username') : field('邮箱或账号', 'username') + field('密码', 'password', 'password', '账号或密码不正确，请重新确认');
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隔离样式验证 · ${title}</title>${styles.map(name => `<link rel="stylesheet" href="${resources}/css/${name}.css">`).join('')}<style>.fixture-marker{position:fixed;top:0;left:0;right:0;z-index:10;padding:5px 16px;background:#eaf2f5;color:#425c67;font:11px/20px sans-serif}.mc-kc{padding-top:30px}.fixture-marker a{color:inherit;margin-left:14px}</style></head><body><div class="fixture-marker">隔离主题样式验证 · 不连接账号服务<a href="login.html">登录</a><a href="register.html">注册</a><a href="reset.html">找回</a></div><div class="mc-kc"><aside class="mc-kc-brand"><a class="mc-kc-wordmark" href="login.html"><img src="${resources}/brand/medcollab-mark.svg" alt="">MedCollab</a><div class="mc-kc-identity"><img src="${resources}/brand/medcollab-mark.svg" alt=""><h2>医学数据资料库</h2><p>MedCollab</p></div><footer>MedCollab Research Workspace</footer></aside><main class="mc-kc-main"><a class="medcollab-sign-in__back" href="login.html">返回首页</a><section class="medcollab-sign-in__form-region"><div class="medcollab-sign-in__intro"><h1>${title}</h1></div><form>${fields}<button class="portal-button medcollab-sign-in__submit" type="button">${screen === 'reset' ? '发送重置邮件' : screen === 'register' ? '注册账号' : '登录'}</button></form><div class="medcollab-sign-in__register"><a class="medcollab-sign-in__text-action" href="${screen === 'login' ? 'register' : 'login'}.html">${screen === 'login' ? '注册账号' : '返回登录'}</a></div></section></main></div><script>document.addEventListener('submit',event=>event.preventDefault())</script></body></html>`;
  await fs.writeFile(path.join(root, `${screen}.html`), html);
}
console.log('Isolated readonly auth style fixtures generated (no real FreeMarker/SSO validation).');
