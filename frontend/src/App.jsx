import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { DateRangeProvider } from './DateRangeContext.jsx';
import DateRangePicker from './components/DateRangePicker.jsx';
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

// The date range picker only affects data on these routes
const DATE_RANGE_ROUTES = ['/', '/machines'];

function Topbar() {
  const { pathname } = useLocation();
  if (!DATE_RANGE_ROUTES.includes(pathname)) return <div className="topbar" />;
  return (
    <div className="topbar">
      <DateRangePicker />
    </div>
  );
}

export default function App() {
  return (
    <DateRangeProvider>
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
          <Topbar />
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
    </DateRangeProvider>
  );
}
