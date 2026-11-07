import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet } from 'react-router-dom';
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
import { usePortalMotion } from './portal-motion';

export type PortalShellProps = {
  children: ReactNode;
  activeSection?: 'home' | 'teams';
  primaryNavigation?: ReactNode;
  username?: string;
  mode?: 'real' | 'demo';
  onLogout?: () => void;
  busy?: boolean;
  accountActions?: ReactNode;
  viewKey?: string;
  contentReady?: boolean;
};

type Chrome = Omit<PortalShellProps, 'children'>;
type Registration = { owner: symbol; chrome: Chrome };
const RegisterChrome = createContext<((owner: symbol, chrome: Chrome | null) => void) | null>(null);

function PortalHeader({
  activeSection = 'home',
  primaryNavigation,
  username = '',
  mode = 'real',
  onLogout,
  busy = false,
  accountActions,
}: Chrome) {
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
  );
}

/** Keep only the chrome mounted; route-owned private content unmounts immediately. */
export function PortalLayout() {
  const [registration, setRegistration] = useState<Registration | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const register = useCallback((owner: symbol, chrome: Chrome | null) => {
    setRegistration(current => chrome ? { owner, chrome } : current?.owner === owner ? null : current);
  }, []);
  const chrome = registration?.chrome;
  usePortalMotion(root, chrome?.viewKey || '', chrome?.contentReady === true);
  return (
    <RegisterChrome.Provider value={register}>
      <div ref={root} className="mc-shell mc-shell--top">
        <PortalHeader {...chrome} />
        <div className="mc-shell-main"><Outlet /></div>
      </div>
    </RegisterChrome.Provider>
  );
}

export default function PortalShell({ children, ...chrome }: PortalShellProps) {
  const register = useContext(RegisterChrome);
  const owner = useRef(Symbol('portal-page'));
  useLayoutEffect(() => {
    register?.(owner.current, chrome);
  });
  useLayoutEffect(() => () => register?.(owner.current, null), [register]);
  if (register) return <>{children}</>;
  return (
    <div className="mc-shell mc-shell--top">
      <PortalHeader {...chrome} />
      <div className="mc-shell-main">{children}</div>
    </div>
  );
}
