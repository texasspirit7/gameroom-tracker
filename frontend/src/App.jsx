import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { PeriodProvider, usePeriod, PERIODS } from './PeriodContext.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Upload from './pages/Upload.jsx';
import Sheets from './pages/Sheets.jsx';
import SheetDetail from './pages/SheetDetail.jsx';
import Machines from './pages/Machines.jsx';
import MachineDetail from './pages/MachineDetail.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '📊', end: true },
  { to: '/upload', label: 'Upload Sheet', icon: '📤' },
  { to: '/sheets', label: 'Daily Sheets', icon: '🗂️' },
  { to: '/machines', label: 'Machines', icon: '🎰' },
];

// The period switch only changes data on these routes
const PERIOD_ROUTES = ['/', '/machines'];

function PeriodSwitch() {
  const { period, setPeriod } = usePeriod();
  const { pathname } = useLocation();
  const relevant = PERIOD_ROUTES.includes(pathname);
  if (!relevant) return null;
  return (
    <div className="segmented" role="tablist" aria-label="View period">
      {PERIODS.map(([key, label]) => (
        <button
          key={key}
          role="tab"
          aria-selected={period === key}
          className={period === key ? 'seg-active' : ''}
          onClick={() => setPeriod(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  return (
    <PeriodProvider>
      <div className="layout">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-icon">🎰</span>
            <div>
              <div className="brand-name">La Pryor</div>
              <div className="brand-sub">Game Room Tracker</div>
            </div>
          </div>
          <nav>
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}>
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-foot">Auth off — local testing</div>
        </aside>
        <main className="content">
          <div className="topbar">
            <PeriodSwitch />
          </div>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/sheets" element={<Sheets />} />
            <Route path="/sheets/:id" element={<SheetDetail />} />
            <Route path="/machines" element={<Machines />} />
            <Route path="/machines/:number" element={<MachineDetail />} />
          </Routes>
        </main>
      </div>
    </PeriodProvider>
  );
}
