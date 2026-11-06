import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { UserRound, ChevronDown, LogOut } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './index';
import Brand from './Brand';
import './portal-top.css';

export type PortalShellProps = {
  children: ReactNode;
  activeSection?: 'home' | 'teams';
  primaryNavigation?: ReactNode;
  username?: string;
  mode?: 'real' | 'demo';
  onLogout?: () => void;
  busy?: boolean;
  accountActions?: ReactNode;
};

export default function PortalShell({
  children,
  activeSection = 'home',
  primaryNavigation,
  username = '',
  mode = 'real',
  onLogout,
  busy = false,
  accountActions,
}: PortalShellProps) {
  const avatar = (
    <span className="mc-account-avatar" aria-hidden="true">
      {mode === 'demo' ? '研' : username.trim().slice(0, 1) || <UserRound size={17} />}
    </span>
  );
  const account = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="mc-top-account-trigger"
          aria-label="账号菜单"
          title="账号菜单"
        >
          {avatar}
          <strong data-cy="home-account">
            {mode === 'demo' ? '示例空间' : username || '未登录'}
          </strong>
          <ChevronDown size={15} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="mc-common-menu mc-top-account-menu" align="end">
        <div className="mc-top-account-identity">
          <strong>{mode === 'demo' ? '示例空间' : username || '未登录'}</strong>
          <span>{mode === 'demo' ? '刷新或退出后重置' : '平台账号'}</span>
        </div>
        {onLogout ? (
          <DropdownMenuItem onSelect={onLogout} disabled={busy} data-cy="home-logout">
            <LogOut size={16} />
            {mode === 'demo' ? '退出示例' : '退出登录'}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem asChild>
            <Link to="/account/sign-in">平台账号登录</Link>
          </DropdownMenuItem>
        )}
        {accountActions}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <div className="mc-shell mc-shell--top">
      <header className="mc-topbar">
        <div className="mc-topbar-inner">
          <Link to="/home" className="mc-top-brand">
            <Brand compact />
          </Link>
          <nav className="mc-top-primary" aria-label="主导航">
            {primaryNavigation || (
              <>
                <Link to="/home?view=work">工作首页</Link>
                <Link to="/home?view=library">完整资料库</Link>
                <Link to="/teams" aria-current={activeSection === 'teams' ? 'page' : undefined}>
                  团队影像库
                </Link>
              </>
            )}
          </nav>
          <div className="mc-top-account">{account}</div>
        </div>
      </header>
      <div className="mc-shell-main">{children}</div>
    </div>
  );
}
