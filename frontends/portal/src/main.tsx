import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import './styles.css';
import './ui/ui.css';
import HomePage from './features/home/HomePage';
import SsoSignInPage from './features/home/SsoSignInPage';
import SignInPage from './features/sign-in/SignInPage';
import TeamsPage from './features/teams/TeamsPage';
import { PortalLayout } from './ui/PortalShell';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Navigate to="/home" replace />} />
      <Route element={<PortalLayout />}>
        <Route path="/home" element={<HomePage />} />
        <Route path="/teams" element={<TeamsPage />} />
      </Route>
      <Route path="/account/sign-in" element={<SsoSignInPage />} />
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  </BrowserRouter>
);
