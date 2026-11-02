import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import AuthLayout from '../../ui/AuthLayout';
import {
  Button,
  Input,
  Label,
  Icons,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../ui';
import { SignInAdapter, SignInErrors, unconfiguredSignInAdapter, validateSignIn } from './auth';
import './sign-in.css';

type HelpKind = 'register' | 'forgot';
type Props = { adapter?: SignInAdapter };

export default function SignInPage({ adapter = unconfiguredSignInAdapter }: Props) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [errors, setErrors] = useState<SignInErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serviceError, setServiceError] = useState('');
  const [help, setHelp] = useState<HelpKind | null>(null);
  const pending = useRef(false);
  const identifierRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const helpTrigger = useRef<HTMLButtonElement | null>(null);
  const location = useLocation();
  const locale = new URLSearchParams(location.search).get('lng');
  const backSearch = locale ? `?${new URLSearchParams({ lng: locale }).toString()}` : '';

  useEffect(() => {
    const previousTitle = document.title;
    document.title = '登录 | MedCollab';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const nextErrors = validateSignIn({ identifier, password });
    setErrors(nextErrors);
    setServiceError('');
    if (nextErrors.identifier || nextErrors.password) {
      (nextErrors.identifier ? identifierRef : passwordRef).current?.focus();
      return;
    }
    pending.current = true;
    setSubmitting(true);
    try {
      await adapter.signIn({ identifier: identifier.trim(), password });
      setServiceError('登录服务尚未接入，账号和密码未发送。');
    } catch (_error) {
      setServiceError('当前无法登录，请稍后重试。');
    } finally {
      pending.current = false;
      setSubmitting(false);
      setPassword('');
      setVisible(false);
    }
  }

  function showHelp(kind: HelpKind, trigger: HTMLButtonElement) {
    helpTrigger.current = trigger;
    setHelp(kind);
  }

  return (
    <AuthLayout
      className="medcollab-sign-in"
      dataCY="medcollab-sign-in"
      backSearch={backSearch}
      backDataCY="sign-in-home"
    >
      <section className="medcollab-sign-in__form-region" aria-labelledby="medcollab-sign-in-title">
        <div className="medcollab-sign-in__intro">
          <h1 id="medcollab-sign-in-title">登录 MedCollab</h1>
          <p>密码表单外观预览，不发送账号或密码。</p>
        </div>
        <form onSubmit={submit} noValidate data-cy="sign-in-form" aria-busy={submitting}>
          <div className="medcollab-sign-in__field">
            <div className="medcollab-sign-in__label-row">
              <Label htmlFor="medcollab-identifier">邮箱或账号</Label>
            </div>
            <Input
              id="medcollab-identifier"
              ref={identifierRef}
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={identifier}
              disabled={submitting}
              aria-invalid={Boolean(errors.identifier)}
              aria-describedby={errors.identifier ? 'medcollab-identifier-error' : undefined}
              data-cy="sign-in-identifier"
              className="medcollab-sign-in__input"
              placeholder="请输入邮箱或账号"
              onChange={(event) => {
                setIdentifier(event.target.value);
                setErrors((current) => ({ ...current, identifier: undefined }));
                setServiceError('');
              }}
            />
            <p
              className="medcollab-sign-in__field-error"
              id="medcollab-identifier-error"
              data-cy="sign-in-identifier-error"
              aria-live="polite"
            >
              {errors.identifier}
            </p>
          </div>
          <div className="medcollab-sign-in__field">
            <div className="medcollab-sign-in__label-row">
              <Label htmlFor="medcollab-password">密码</Label>
              <Button
                type="button"
                variant="link"
                className="medcollab-sign-in__text-action"
                dataCY="sign-in-forgot"
                onClick={(event) => showHelp('forgot', event.currentTarget)}
              >
                忘记密码？
              </Button>
            </div>
            <div className="medcollab-sign-in__password">
              <Input
                id="medcollab-password"
                ref={passwordRef}
                name="password"
                type={visible ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                disabled={submitting}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'medcollab-password-error' : undefined}
                data-cy="sign-in-password"
                className="medcollab-sign-in__input"
                placeholder="请输入密码"
                onChange={(event) => {
                  setPassword(event.target.value);
                  setErrors((current) => ({ ...current, password: undefined }));
                  setServiceError('');
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="medcollab-sign-in__password-toggle"
                dataCY="sign-in-password-toggle"
                aria-label={visible ? '隐藏密码' : '显示密码'}
                aria-pressed={visible}
                title={visible ? '隐藏密码' : '显示密码'}
                disabled={submitting}
                onClick={() => setVisible((current) => !current)}
              >
                {visible ? (
                  <Icons.EyeHidden aria-hidden="true" />
                ) : (
                  <Icons.EyeVisible aria-hidden="true" />
                )}
              </Button>
            </div>
            <p
              className="medcollab-sign-in__field-error"
              id="medcollab-password-error"
              data-cy="sign-in-password-error"
              aria-live="polite"
            >
              {errors.password}
            </p>
          </div>
          <Button
            type="submit"
            className="medcollab-sign-in__submit"
            dataCY="sign-in-submit"
            disabled={submitting}
          >
            {submitting ? '处理中…' : '登录'}
          </Button>
          <p
            className="medcollab-sign-in__service-error"
            role="alert"
            aria-atomic="true"
            data-cy="sign-in-service-error"
          >
            {serviceError}
          </p>
        </form>
        <div className="medcollab-sign-in__register">
          <span>还没有账号？</span>
          <Button
            type="button"
            variant="link"
            className="medcollab-sign-in__text-action"
            dataCY="sign-in-register"
            onClick={(event) => showHelp('register', event.currentTarget)}
          >
            注册账号
          </Button>
        </div>
      </section>
      <Dialog
        open={Boolean(help)}
        onOpenChange={(open) => {
          if (!open) setHelp(null);
        }}
      >
        <DialogContent
          className="medcollab-auth-dialog"
          data-cy="sign-in-help-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            helpTrigger.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{help === 'register' ? '注册尚未开放' : '暂时无法找回密码'}</DialogTitle>
            <DialogDescription>
              {help === 'register'
                ? '账号服务尚未接入，暂时无法创建账号。'
                : '密码找回服务尚未接入，暂时无法发送重置邮件。'}
            </DialogDescription>
          </DialogHeader>
          <Button
            className="medcollab-auth-dialog__close"
            dataCY="sign-in-help-close"
            onClick={() => setHelp(null)}
          >
            知道了
          </Button>
        </DialogContent>
      </Dialog>
    </AuthLayout>
  );
}
