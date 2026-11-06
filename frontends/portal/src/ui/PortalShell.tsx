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
import './portal-top.css';

export type PortalShellProps = {
  children: ReactNode;
  activeSection?: 'home' | 'teams';
  homeNavigation?: ReactNode;
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
  homeNavigation,
  primaryNavigation,
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
          <Button
            ref={navigationTrigger}
            variant="ghost"
            size="icon"
            className="mc-icon-button mc-top-nav-toggle"
            aria-label="打开导航"
            dataCY="home-navigation-toggle"
            onClick={() => setNavOpen(true)}
          >
            <Menu size={21} />
          </Button>
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
          <nav
            className="mc-shell-nav"
            aria-label="数据集分类"
            onClick={(event) => {
              if ((event.target as HTMLElement).closest('a,button')) setNavOpen(false);
            }}
          >
            {homeNavigation ||
              personalNavigation.map(({ id, label, icon: Icon }) => (
                <Link key={id} to={id === 'all' ? '/home?view=library' : `/home?scope=${id}`}>
                  <Icon size={18} />
                  <span>{label}</span>
                </Link>
              ))}
          </nav>
          <Link className="mc-top-drawer-team" to="/teams" onClick={() => setNavOpen(false)}>
            <UsersRound size={18} />
            团队影像库
          </Link>
        </DialogContent>
      </Dialog>
    </div>
  );
}
