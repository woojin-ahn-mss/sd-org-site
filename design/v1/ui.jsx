// Shared UI atoms & sidebar for SD Org Dashboard
const { useState, useMemo, useEffect, useRef, Fragment } = React;
const D = window.SD_DATA;

// ---------- Icons (inline SVG, 1.5 stroke, currentColor) ----------
const Icon = ({ name, size = 14 }) => {
  const s = size;
  const paths = {
    home: <><path d="M3 11l9-8 9 8"/><path d="M5 9.5V20a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V9.5"/></>,
    gantt: <><rect x="3" y="4" width="14" height="3" rx="1"/><rect x="6" y="10" width="13" height="3" rx="1"/><rect x="4" y="16" width="10" height="3" rx="1"/></>,
    rocket: <><path d="M4.5 16.5c-1.5 1.5-2 5-2 5s3.5-.5 5-2c.86-.86.96-2.21.21-3.18a2.06 2.06 0 00-3.21.18z"/><path d="M12 15l-3-3a13 13 0 013-6 7 7 0 016-3 7 7 0 01-3 6 13 13 0 01-6 3"/><path d="M14.5 8.5l1 1"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0112 0"/><circle cx="17" cy="6" r="2.5"/><path d="M15 14a4 4 0 016 3.5"/></>,
    chart: <><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-7"/></>,
    board: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/></>,
    bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>,
    inbox: <><path d="M3 13l3-8h12l3 8"/><path d="M3 13v6a2 2 0 002 2h14a2 2 0 002-2v-6"/><path d="M3 13h5l2 3h4l2-3h5"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></>,
    moon: <path d="M21 13A9 9 0 1111 3a7 7 0 0010 10z"/>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.5 4.5l1.4 1.4M18.1 18.1l1.4 1.4M4.5 19.5l1.4-1.4M18.1 5.9l1.4-1.4"/></>,
    bell: <><path d="M18 16v-5a6 6 0 00-12 0v5l-2 2h16l-2-2z"/><path d="M10 20a2 2 0 004 0"/></>,
    chevron: <path d="M9 6l6 6-6 6"/>,
    external: <><path d="M14 4h6v6"/><path d="M10 14L20 4"/><path d="M19 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h5"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    filter: <path d="M3 5h18l-7 8v6l-4-2v-4z"/>,
    columns: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/></>,
    download: <><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M3 21h18"/></>,
    arrowUp: <><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></>,
    arrowDown: <><path d="M12 5v14"/><path d="M5 12l7 7 7-7"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    flag: <><path d="M5 21V4M5 4l12 4-3 4 3 4-12-1"/></>,
    warn: <><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></>,
    check: <path d="M5 12l5 5L20 6"/>,
  };
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
};

// ---------- Avatar ----------
const Avatar = ({ name, size = "" }) => {
  const p = D.PEOPLE.find(x => x.name === name);
  const color = p?.color || "#7c9cff";
  const initials = p?.initials || (name?.slice(0, 1) || "?");
  const sz = size === "s" ? 18 : size === "l" ? 28 : 22;
  return (
    <span className={"avatar" + (size ? " " + size : "")} style={{ background: `linear-gradient(135deg, ${color}, ${color}88)`, width: sz, height: sz }}>{initials}</span>
  );
};

const Assignee = ({ name, size }) => (
  <span className="assignee"><Avatar name={name} size={size} /> <span>{name}</span></span>
);

// ---------- Status / Priority ----------
const Status = ({ name }) => {
  const cat = D.STATUS_STYLES[name] || "slate";
  return <span className={"st st-" + cat}><span className="chip-dot" style={{ background: "currentColor" }}></span>{name}</span>;
};

const Priority = ({ value }) => {
  const cls = "pri-" + (value || "P3").toLowerCase();
  return <span className={"pri " + cls}><span className="pri-mark">{value}</span></span>;
};

const Chip = ({ children, color }) => (
  <span className="chip" style={color ? { color } : undefined}>
    {color && <span className="chip-dot" style={{ background: color }}></span>}
    {children}
  </span>
);

// ---------- Sidebar ----------
const NAV = [
  { id: "home", label: "홈", icon: "home" },
  { id: "roadmap", label: "로드맵", icon: "gantt" },
  { id: "progress", label: "진행 현황", icon: "rocket" },
  { id: "resource", label: "리소스", icon: "users" },
  { id: "performance", label: "성과", icon: "chart" },
  { id: "roadmap-plan", label: "로드맵 관리", icon: "board" },
  { id: "fasttrack", label: "패스트트랙", icon: "bolt", badge: 5 },
  { id: "etr", label: "ETR", icon: "inbox", badge: 3 },
];

const Sidebar = ({ active, onNav, theme, setTheme }) => (
  <aside className="sidebar">
    <div className="sb-brand">
      <div className="sb-mark"></div>
      <div className="sb-title">
        S&D Console
        <small>Search & Discovery 실</small>
      </div>
    </div>

    <div className="sb-search">
      <Icon name="search" size={13} />
      <input placeholder="검색 또는 점프..." readOnly />
      <span className="kbd">⌘K</span>
    </div>

    <div className="sb-section">PAGES</div>
    <nav className="sb-nav">
      {NAV.map(n => (
        <button key={n.id} className={"sb-link" + (active === n.id ? " active" : "")} onClick={() => onNav(n.id)}>
          <span className="sb-ico"><Icon name={n.icon} size={14} /></span>
          <span className="grow">{n.label}</span>
          {n.badge && <span className="badge">{n.badge}</span>}
        </button>
      ))}
    </nav>

    <div className="sb-foot">
      <div className="sb-sync">
        <div className="sb-sync-dot"></div>
        <div className="grow">
          <strong>{D.META.lastSync}</strong>
          <small>다음: {D.META.nextSync}</small>
        </div>
      </div>
      <div className="sb-theme">
        <button className={theme === "dark" ? "on" : ""} onClick={() => setTheme("dark")}>
          <Icon name="moon" size={12} /> 다크
        </button>
        <button className={theme === "light" ? "on" : ""} onClick={() => setTheme("light")}>
          <Icon name="sun" size={12} /> 라이트
        </button>
      </div>
    </div>
  </aside>
);

// ---------- Page head ----------
const PageHead = ({ title, sub, actions }) => (
  <div className="page-head">
    <div>
      <h1 className="page-title">{title}</h1>
      {sub && <div className="page-sub">{sub}</div>}
    </div>
    {actions && <div className="page-actions">{actions}</div>}
  </div>
);

// ---------- Segmented ----------
const Seg = ({ options, value, onChange }) => (
  <div className="seg">
    {options.map(o => (
      <button key={o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>{o.label}</button>
    ))}
  </div>
);

// ---------- Filter pill ----------
const FilterPill = ({ active, onClick, children }) => (
  <button className={"filter-pill" + (active ? " active" : "")} onClick={onClick}>{children}</button>
);

// ---------- Donut chart (SVG) ----------
const Donut = ({ data, size = 140, thickness = 16 }) => {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let off = 0;
  return (
    <svg className="donut" viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--bg-elev)" strokeWidth={thickness} />
      {data.map((d, i) => {
        const len = (d.value / total) * c;
        const seg = (
          <circle key={i}
            cx={size/2} cy={size/2} r={r} fill="none"
            stroke={d.color} strokeWidth={thickness}
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-off}
            transform={`rotate(-90 ${size/2} ${size/2})`}
            style={{ transition: "stroke-dasharray 240ms" }}
          />
        );
        off += len;
        return seg;
      })}
      <text x={size/2} y={size/2 - 4} textAnchor="middle" fontSize="20" fontWeight="700" fill="var(--text)" style={{ fontVariantNumeric: "tabular-nums" }}>{total}</text>
      <text x={size/2} y={size/2 + 14} textAnchor="middle" fontSize="10" fill="var(--text-faint)">총 티켓</text>
    </svg>
  );
};

// ---------- Sparkline ----------
const Sparkline = ({ values, w = 60, h = 24, color = "var(--accent)" }) => {
  if (!values || !values.length) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return [x, y];
  });
  const d = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const fillD = d + ` L${w},${h} L0,${h} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="impact-spark" style={{ position: "static", display: "block" }}>
      <path d={fillD} fill={color} opacity="0.14" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

// ---------- KPI Card ----------
const KpiCard = ({ label, value, unit, delta, pct, deltaText }) => (
  <div className="kpi">
    <div className="kpi-label">{label}</div>
    <div className="kpi-value">{value}{unit && <small>{unit}</small>}</div>
    {pct !== undefined ? (
      <div className="kpi-bar"><span style={{ width: pct + "%" }}></span></div>
    ) : (
      <div className={"kpi-delta " + (delta > 0 ? "up" : delta < 0 ? "down" : "")}>
        {delta !== undefined && (delta > 0 ? <Icon name="arrowUp" size={11} /> : delta < 0 ? <Icon name="arrowDown" size={11} /> : null)}
        {deltaText}
      </div>
    )}
  </div>
);

// ---------- Helpers ----------
const fmtDate = (s) => s ? s.replace(/-/g, ".").slice(2) : "—";  // 26.05.22

const cls = (...xs) => xs.filter(Boolean).join(" ");

window.UI = { Icon, Avatar, Assignee, Status, Priority, Chip, Sidebar, PageHead, Seg, FilterPill, Donut, Sparkline, KpiCard, fmtDate, cls };
