import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { DateRangeProvider } from './DateRangeContext.jsx';
import { AuthProvider, useAuth } from './AuthContext.jsx';
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

const NAV = [
  { to: '/', label: 'Dashboard', icon: '📊', end: true },
  { to: '/upload', label: 'Upload Sheet', icon: '📤' },
  { to: '/sheets', label: 'Daily Sheets', icon: '🗂️' },
  { to: '/machines', label: 'Machines', icon: '🎰' },
  { to: '/expenses', label: 'Expenses', icon: '🧾' },
  { to: '/admin', label: 'Admin — Users', icon: '🛡️' },
  { to: '/profit-split', label: 'Profit Split', icon: '🤝', adminOnly: true },
];

// The date range picker only affects data on these routes
const DATE_RANGE_ROUTES = ['/', '/machines', '/expenses'];

function Topbar() {
  const { pathname } = useLocation();
  if (!DATE_RANGE_ROUTES.includes(pathname)) return <div className="topbar" />;
  return (
    <div className="topbar">
      <DateRangePicker />
    </div>
  );
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

function AppShell() {
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();
  const { isAdmin, authEnabled } = useAuth();
  const showAdminOnly = !authEnabled || isAdmin;

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
          {NAV.filter((item) => !item.adminOnly || showAdminOnly).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
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
          <Route path="/admin" element={<AdminUsers />} />
          <Route path="/profit-split" element={<ProfitSplit />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <DateRangeProvider>
        <StringLights />
        <LoginGate>
          <AppShell />
        </LoginGate>
      </DateRangeProvider>
    </AuthProvider>
  );
}
