import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { UsersRound, UserRound, Menu, ChevronDown, LogOut } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './index';
import Brand from './Brand';
import { personalNavigation } from './navigation';

export type PortalShellProps = {
  children: ReactNode;
  activeSection?: 'home' | 'teams';
  homeNavigation?: ReactNode;
  username?: string;
  mode?: 'real' | 'demo';
  onLogout?: () => void;
  busy?: boolean;
  accountActions?: ReactNode;
};

export default function PortalShell({
  children,
  activeSection = 'home',
  homeNavigation,
  username = '',
  mode = 'real',
  onLogout,
  busy = false,
  accountActions,
}: PortalShellProps) {
  const [navOpen, setNavOpen] = useState(false);
  const navigationTrigger = useRef<HTMLButtonElement>(null);
  const avatar = (
    <span className="mc-account-avatar" aria-hidden="true">
      {mode === 'demo' ? '研' : username.trim().slice(0, 1) || <UserRound size={17} />}
    </span>
  );
  const navigation = (
    <>
      <Link to="/home" className="mc-shell-brand">
        <Brand />
      </Link>
      <p className="mc-shell-nav-label">个人资料</p>
      <nav
        className="mc-shell-nav"
        aria-label="数据集分类"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('a,button')) setNavOpen(false);
        }}
      >
        {homeNavigation ||
          personalNavigation.map(({ id, label, icon: Icon }) => (
            <Link key={id} to={id === 'all' ? '/home' : `/home?scope=${id}`}>
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          ))}
      </nav>
      <nav
        className="mc-shell-nav mc-shell-team-nav"
        aria-label="协作"
        onClick={() => setNavOpen(false)}
      >
        <Link
          to="/teams"
          className={activeSection === 'teams' ? 'is-active' : ''}
          aria-current={activeSection === 'teams' ? 'page' : undefined}
        >
          <UsersRound size={18} />
          <span>团队影像库</span>
        </Link>
      </nav>
      <div className="mc-shell-account">
        <small>{mode === 'demo' ? '本机演示' : '个人空间'}</small>
        <div className="mc-shell-account-row">
          {avatar}
          <span>
            <strong data-cy="home-account">
              {mode === 'demo' ? '示例空间' : username || '未登录'}
            </strong>
            <small>
              {mode === 'demo' ? '刷新或退出后重置' : username ? '平台账号' : '登录后访问资料'}
            </small>
          </span>
          {onLogout ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="账号菜单"
                  title="账号菜单"
                  className="mc-icon-button"
                >
                  <ChevronDown size={15} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="mc-common-menu" side="top" align="end">
                <DropdownMenuItem onSelect={onLogout} disabled={busy} data-cy="home-logout">
                  <LogOut size={16} />
                  {mode === 'demo' ? '退出示例' : '退出登录'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link to="/account/sign-in" className="mc-shell-login">
              登录
            </Link>
          )}
        </div>
        {accountActions}
      </div>
    </>
  );
  return (
    <div className="mc-shell">
      <aside className="mc-shell-sidebar">{navigation}</aside>
      <div className="mc-shell-main">
        <header className="mc-shell-mobile-header">
          <Button
            ref={navigationTrigger}
            variant="ghost"
            size="icon"
            className="mc-icon-button"
            aria-label="打开导航"
            dataCY="home-navigation-toggle"
            onClick={() => setNavOpen(true)}
          >
            <Menu size={21} />
          </Button>
          <Link to="/home">
            <Brand compact />
          </Link>
          {avatar}
        </header>
        {children}
      </div>
      <Dialog open={navOpen} onOpenChange={setNavOpen}>
        <DialogContent
          className="mc-shell-mobile-nav"
          data-cy="home-navigation-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            navigationTrigger.current?.focus({ preventScroll: true });
          }}
        >
          <DialogHeader>
            <DialogTitle className="sr-only">数据集导航</DialogTitle>
            <DialogDescription className="sr-only">个人资料与团队影像库</DialogDescription>
          </DialogHeader>
          {navigation}
        </DialogContent>
      </Dialog>
    </div>
  );
}
