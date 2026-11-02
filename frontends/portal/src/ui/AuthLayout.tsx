import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import Brand from './Brand';

export default function AuthLayout({
  children,
  className = '',
  dataCY,
  backSearch = '',
  backLabel = '返回首页',
  backDataCY,
}: {
  children: ReactNode;
  className?: string;
  dataCY?: string;
  backSearch?: string;
  backLabel?: string;
  backDataCY?: string;
}) {
  return (
    <div className={`mc-auth ${className}`} data-cy={dataCY}>
      <header className="mc-auth-header">
        <Link to={`/home${backSearch}`} className="mc-auth-brand">
          <Brand compact />
        </Link>
        <Link to={`/home${backSearch}`} className="mc-auth-back" data-cy={backDataCY}>
          <ChevronLeft size={16} />
          {backLabel}
        </Link>
      </header>
      <div className="mc-auth-layout">
        <aside className="mc-auth-identity" aria-label="MedCollab 医学数据资料库">
          <div>
            <img src="/brand/medcollab-mark.svg" alt="" width="120" height="132" />
            <h2>医学数据资料库</h2>
            <p>MedCollab</p>
          </div>
          <footer>MedCollab Research Workspace</footer>
        </aside>
        <main className="mc-auth-main">{children}</main>
      </div>
    </div>
  );
}
