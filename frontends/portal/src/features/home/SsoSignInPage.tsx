import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button, Icons } from '../../ui';
import { getAuthUrl, getHomeConfig, HomeConfig } from './api';
import './sso.css';

type Props = { config?: HomeConfig };

export default function SsoSignInPage({ config: providedConfig }: Props) {
  const config = providedConfig || getHomeConfig();
  const loginUrl = getAuthUrl(config, 'login');
  const registerUrl = getAuthUrl(config, 'register');

  useEffect(() => {
    const previous = document.title;
    document.title = '账号登录 | MedCollab';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="mc-sso" data-cy="mc-sso">
      <header className="mc-sso__header">
        <span className="mc-sso__brand">MedCollab</span>
        <Link className="mc-sso__back" to="/home" data-cy="mc-sso-home">
          <Icons.ChevronLeft aria-hidden="true" />
          返回我的数据集
        </Link>
      </header>
      <main className="mc-sso__main" aria-labelledby="mc-sso-title">
        <h1 id="mc-sso-title">登录 MedCollab</h1>
        <p className="mc-sso__intro">访问并管理你的医学影像数据集。</p>

        {loginUrl ? (
          <Button asChild className="mc-sso__primary" dataCY="mc-sso-login">
            <a href={loginUrl} referrerPolicy="no-referrer">
              使用平台账号登录
            </a>
          </Button>
        ) : (
          <Button
            type="button"
            className="mc-sso__primary"
            dataCY="mc-sso-login"
            disabled
            aria-describedby="mc-sso-status"
          >
            使用平台账号登录
          </Button>
        )}

        {!loginUrl && (
          <p id="mc-sso-status" className="mc-sso__status" data-cy="mc-sso-status">
            账号服务尚未接入，暂时无法登录。
          </p>
        )}

        <div className="mc-sso__registration">
          <span>还没有平台账号？</span>
          {registerUrl ? (
            <a
              className="mc-sso__text-link"
              href={registerUrl}
              referrerPolicy="no-referrer"
              data-cy="mc-sso-register"
            >
              注册平台账号
            </a>
          ) : (
            <Button
              type="button"
              variant="link"
              className="mc-sso__registration-disabled"
              dataCY="mc-sso-register"
              disabled
              aria-describedby="mc-sso-status"
            >
              注册平台账号
            </Button>
          )}
        </div>

        <Link className="mc-sso__preview" to="/sign-in?lng=zh" data-cy="mc-sso-preview">
          密码表单外观预览
          <Icons.ChevronRight aria-hidden="true" />
        </Link>
      </main>
    </div>
  );
}
