document.querySelectorAll('[data-password-toggle]').forEach(button => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.getAttribute('aria-controls'));
    if (!input) return;
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(visible));
    button.setAttribute('aria-label', visible ? '隐藏密码' : '显示密码');
    button.title = visible ? '隐藏密码' : '显示密码';
  });
});
const login = document.querySelector('[data-portal-login]');
if (login) {
  const identifier = login.elements.username;
  const password = login.elements.password;
  const setError = (input, text) => {
    if (!input) return;
    input.setAttribute('aria-invalid', String(Boolean(text)));
    document.getElementById(input.getAttribute('aria-describedby')).textContent = text;
  };
  [identifier, password].filter(Boolean).forEach(input => input.addEventListener('input', () => {
    setError(input, '');
    login.querySelector('[role="alert"]').textContent = '';
  }));
  login.addEventListener('submit', event => {
    const account = identifier?.value.trim();
    let identifierError = '';
    if (identifier) {
      if (!account) identifierError = '请填写邮箱或账号';
      else if (account.includes('@') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) identifierError = '请填写有效的邮箱地址';
      else if (/\s/.test(account)) identifierError = '账号不能包含空格';
    }
    const passwordError = password.value ? '' : '请填写密码';
    setError(identifier, identifierError);
    setError(password, passwordError);
    if (identifierError || passwordError) {
      event.preventDefault();
      (identifierError ? identifier : password).focus();
      return;
    }
    if (identifier) identifier.value = account;
    const submit = login.querySelector('[type="submit"]');
    if (submit.disabled) { event.preventDefault(); return; }
    submit.disabled = true;
    submit.textContent = '处理中…';
    login.setAttribute('aria-busy', 'true');
  });
}
const help = document.querySelector('[data-cy="sign-in-help-dialog"]');
const overlay = document.querySelector('[data-help-overlay]');
let helpTrigger;
const closeHelp = () => {
  help.hidden = overlay.hidden = true;
  helpTrigger?.focus();
};
document.querySelector('[data-help-dialog]')?.addEventListener('click', event => {
  helpTrigger = event.currentTarget;
  help.hidden = overlay.hidden = false;
  help.querySelector('button').focus();
});
document.querySelectorAll('[data-help-close]').forEach(button => button.addEventListener('click', closeHelp));
overlay?.addEventListener('click', closeHelp);
help?.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); closeHelp(); }
  if (event.key === 'Tab') {
    const buttons = [...help.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement);
    event.preventDefault();
    buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
  }
});
window.addEventListener('pageshow', () => {
  login?.removeAttribute('aria-busy');
  const submit = login?.querySelector('[type="submit"]');
  if (submit) { submit.disabled = false; submit.textContent = '登录'; }
});
