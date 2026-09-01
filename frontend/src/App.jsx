import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { DateRangeProvider } from './DateRangeContext.jsx';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import { UploadProvider, useUpload } from './UploadContext.jsx';
import DateRangePicker from './components/DateRangePicker.jsx';
import LoginGate from './components/LoginGate.jsx';
import StringLights from './components/StringLights.jsx';
import CasinoBackdrop from './components/CasinoBackdrop.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Upload from './pages/Upload.jsx';
import Sheets from './pages/Sheets.jsx';
import SheetDetail from './pages/SheetDetail.jsx';
import Machines from './pages/Machines.jsx';
import MachineDetail from './pages/MachineDetail.jsx';
import Expenses from './pages/Expenses.jsx';
import AdminUsers from './pages/AdminUsers.jsx';
import ProfitSplit from './pages/ProfitSplit.jsx';
import Analytics from './pages/Analytics.jsx';
import Activity from './pages/Activity.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '📊', end: true },
  { to: '/upload', label: 'Upload Sheet', icon: '📤' },
  { to: '/sheets', label: 'Daily Sheets', icon: '🗂️' },
  { to: '/machines', label: 'Machines', icon: '🎰' },
  { to: '/expenses', label: 'Expenses', icon: '🧾' },
  { to: '/admin', label: 'Admin — Users', icon: '🛡️', adminOnly: true },
  { to: '/profit-split', label: 'Profit Split', icon: '🤝', adminOnly: true },
  { to: '/analytics', label: 'Analytics', icon: '🔍', adminOnly: true },
  { to: '/activity', label: 'Activity', icon: '📜', ownerOnly: true },
];

// The date range picker only affects data on these routes
const DATE_RANGE_ROUTES = ['/', '/machines', '/expenses', '/activity'];

function Topbar() {
  const { pathname } = useLocation();
  if (!DATE_RANGE_ROUTES.includes(pathname)) return <div className="topbar" />;
  return (
    <div className="topbar">
      <DateRangePicker />
    </div>
  );
}

function UploadBanner() {
  const { isUploading, readySheetId, uploadError, clear } = useUpload();
  const navigate = useNavigate();

  if (isUploading) {
    return (
      <div className="upload-banner upload-banner--loading">
        <span className="upload-banner-spinner" />
        <span>Processing sheet…</span>
      </div>
    );
  }
  if (uploadError) {
    return (
      <div className="upload-banner upload-banner--error">
        <span>⚠ {uploadError}</span>
        <button className="upload-banner-close" onClick={clear}>✕</button>
      </div>
    );
  }
  if (readySheetId) {
    return (
      <div className="upload-banner upload-banner--ready">
        <span>Sheet ready</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="upload-banner-review" onClick={() => navigate(`/sheets/${readySheetId}`)}>Review →</button>
          <button className="upload-banner-close" onClick={clear}>✕</button>
        </div>
      </div>
    );
  }
  return null;
}

function SidebarFooter() {
  const { authEnabled, user, logout } = useAuth();
  if (!authEnabled) return <div className="sidebar-foot">Auth off — local testing</div>;
  if (!user) return null;
  return (
    <div className="sidebar-foot sidebar-user">
      <div className="sidebar-user-name">{user.name}</div>
      <div className="sidebar-user-email">{user.email} · <span className={user.role === 'admin' ? 'role-admin' : ''}>{user.role}</span></div>
      <button className="secondary" onClick={logout} style={{ marginTop: 8, width: '100%' }}>Sign out</button>
    </div>
  );
}

/**
 * Route guard for admin-only pages.
 *
 * Hiding the nav link isn't enough — anyone can type the URL, and the page would otherwise
 * mount, fire its requests and render a frame full of "Admin access required" errors plus
 * stuck spinners. The server is the real boundary (these endpoints already 403); this just
 * makes the refusal a clean, honest screen instead of a broken-looking one.
 */
function OwnerOnly({ children }) {
  const { isOwner, authEnabled } = useAuth();
  if (!authEnabled || isOwner) return children;
  return (
    <div className="panel" style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ fontSize: 34, marginBottom: 12 }}>📜</div>
      <h2 style={{ justifyContent: 'center' }}>Owner access required</h2>
      <p className="muted" style={{ maxWidth: '46ch', margin: '0 auto 20px' }}>
        The activity trail records what every account has done, admins included, so it is
        limited to the account owner.
      </p>
    </div>
  );
}

function AdminOnly({ children }) {
  const { isAdmin, authEnabled } = useAuth();
  if (!authEnabled || isAdmin) return children;
  return (
    <div className="panel" style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ fontSize: 34, marginBottom: 12 }}>🛡️</div>
      <h2 style={{ justifyContent: 'center' }}>Admin access required</h2>
      <p className="muted" style={{ maxWidth: '46ch', margin: '0 auto 20px' }}>
        This page is limited to admin accounts. Ask an admin if you need access to it.
      </p>
      <NavLink className="btn secondary" to="/">Back to dashboard</NavLink>
    </div>
  );
}

function AppShell() {
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();
  const { isAdmin, isOwner, authEnabled } = useAuth();
  const showAdminOnly = !authEnabled || isAdmin;
  const showOwnerOnly = !authEnabled || isOwner;

  // Close the mobile drawer whenever the route changes
  useEffect(() => { setNavOpen(false); }, [pathname]);

  return (
    <div className="layout">
      <div className="mobile-topbar">
        <button className="mobile-menu-btn" aria-label="Open menu" onClick={() => setNavOpen(true)}>
          <span />
          <span />
          <span />
        </button>
        <span className="mobile-topbar-brand">🎰 La Pryor</span>
      </div>

      {navOpen && <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} />}

      <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-icon">🎰</span>
          <div>
            <div className="brand-name">La Pryor</div>
            <div className="brand-sub">Game Room Tracker</div>
          </div>
          <button className="sidebar-close" aria-label="Close menu" onClick={() => setNavOpen(false)}>✕</button>
        </div>
        <nav>
          {NAV.filter((item) => (!item.adminOnly || showAdminOnly) && (!item.ownerOnly || showOwnerOnly)).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <UploadBanner />
        <SidebarFooter />
      </aside>
      <main className="content">
        <CasinoBackdrop />
        <Topbar />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/sheets" element={<Sheets />} />
          <Route path="/sheets/:id" element={<SheetDetail />} />
          <Route path="/machines" element={<Machines />} />
          <Route path="/machines/:number" element={<MachineDetail />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/admin" element={<AdminOnly><AdminUsers /></AdminOnly>} />
          <Route path="/profit-split" element={<AdminOnly><ProfitSplit /></AdminOnly>} />
          <Route path="/analytics" element={<AdminOnly><Analytics /></AdminOnly>} />
          <Route path="/activity" element={<OwnerOnly><Activity /></OwnerOnly>} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <DateRangeProvider>
        <UploadProvider>
          <StringLights />
          <LoginGate>
            <AppShell />
          </LoginGate>
        </UploadProvider>
      </DateRangeProvider>
    </AuthProvider>
  );
}
