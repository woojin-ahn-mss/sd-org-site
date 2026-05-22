// Shared UI atoms — v2 (editorial / mono-led)
const { useState, useMemo, useEffect, Fragment } = React;
const D = window.SD_DATA;

// ---------- Sidebar (text TOC only) ----------
const NAV = [
  { id: "home", label: "홈" },
  { id: "roadmap", label: "로드맵" },
  { id: "progress", label: "진행 현황" },
  { id: "resource", label: "리소스" },
  { id: "performance", label: "성과" },
  { id: "roadmap-plan", label: "로드맵 관리" },
  { id: "fasttrack", label: "패스트트랙" },
  { id: "etr", label: "ETR" },
];

const Sidebar = ({ active, onNav, theme, setTheme }) => (
  <aside className="sb">
    <div className="sb-brand">
      <span className="sb-mark"></span>
      <span className="sb-brand-name">SD/Console</span>
    </div>
    <p className="sb-org">Search &amp; Discovery 실</p>

    <div className="sb-section">Pages</div>
    <div className="sb-list">
      {NAV.map(n => (
        <button
          key={n.id}
          className={"sb-link" + (active === n.id ? " active" : "")}
          onClick={() => onNav(n.id)}
        >
          <span className="grow">{n.label}</span>
        </button>
      ))}
    </div>

    <div className="sb-section">Docs</div>
    <div className="sb-list">
      <a className="sb-link" href="Design System.html">
        <span className="grow">디자인 시스템</span>
      </a>
    </div>

    <div className="sb-foot">
      <p><span className="mono">last sync</span><br/><span className="num mono">{D.META.lastSync}</span></p>
      <p><span className="mono">next</span><br/><span className="num mono">{D.META.nextSync}</span></p>
      <div className="sb-theme">
        <button className={theme === "dark" ? "on" : ""} onClick={() => setTheme("dark")}>Dark</button>
        <button className={theme === "light" ? "on" : ""} onClick={() => setTheme("light")}>Light</button>
      </div>
    </div>
  </aside>
);

// ---------- Page head ----------
const PageHead = ({ kicker, title, lede, meta }) => (
  <header>
    {kicker && <div className="page-kicker">{kicker}</div>}
    <h1 className="page-title">{title}</h1>
    {lede && <p className="page-lede">{lede}</p>}
    {meta && <div className="page-meta">{meta}</div>}
  </header>
);

const SecHead = ({ children, actions, count }) => (
  <div className="sec-head">
    <h2>{children}</h2>
    {count !== undefined && <small className="mono">{count}</small>}
    {actions && <div className="actions">{actions}</div>}
  </div>
);

// ---------- Status / Priority / Key ----------
const STMAP = {
  "발의": "prop", "검토중": "review", "Tech 검토 대기 중": "review",
  "매니저 승인 대기": "review", "In Progress": "progress",
  "대기": "wait", "완료": "done", "검토완료-우선착수": "fast", "반려": "rejected",
};
const Status = ({ name }) => <span className={"st st-" + (STMAP[name] || "wait")}>{name}</span>;

const Priority = ({ value }) => <span className={"pri pri-" + (value || "p3").toLowerCase()}>{value}</span>;

const TKey = ({ children }) => <span className="key mono">{children}</span>;
const Tag = ({ children }) => <span className="tag mono">{children}</span>;

// ---------- Person (text only, tiny dot) ----------
const Who = ({ name }) => {
  const p = D.PEOPLE.find(x => x.name === name);
  return (
    <span className="who">
      <span className="who-dot" style={{ background: p?.color || "var(--dim)" }}></span>
      {name}
    </span>
  );
};

// ---------- Filter (text chips with underline) ----------
const Filter = ({ label, options, value, onChange, multi = false }) => (
  <div className="filters">
    {label && <span className="flabel">{label}</span>}
    {options.map(o => {
      const v = typeof o === "string" ? o : o.value;
      const l = typeof o === "string" ? o : o.label;
      const on = multi ? value.has(v) : value === v;
      return (
        <button key={v} className={"fchip" + (on ? " on" : "")} onClick={() => onChange(v)}>{l}</button>
      );
    })}
  </div>
);

// ---------- Text seg (used as tabs) ----------
const SegText = ({ value, onChange, options }) => (
  <div className="seg-text">
    {options.map(o => (
      <button key={o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>{o.label}</button>
    ))}
  </div>
);

// ---------- Sparkline ----------
const Sparkline = ({ values, w = 70, h = 26, color = "var(--accent)" }) => {
  if (!values?.length) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return [x, y];
  });
  const d = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="imp-spark">
      <path d={d} className="spark" stroke={color} />
    </svg>
  );
};

// ---------- Stat (inline, no card) ----------
const Stat = ({ label, value, unit, foot, footTone, spark, sparkColor }) => (
  <div className="imp-stat">
    <div className="imp-label">{label}</div>
    <div className="imp-val num">{value}{unit && <span className="u">{unit}</span>}</div>
    {foot && <div className={"imp-delta" + (footTone ? " " + footTone : "")}>{foot}</div>}
    {spark && <Sparkline values={spark} color={sparkColor || "var(--accent)"} />}
  </div>
);

// ---------- Helpers ----------
const fmtDate = (s) => s ? s.replace(/-/g, ".").slice(2) : "—";
const fmtDateShort = (s) => s ? s.split("-").slice(1).join("/") : "—";
const ago = (s) => {
  if (!s) return "";
  const today = new Date("2026-05-22");
  const d = new Date(s);
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return "오늘";
  if (diff === 1) return "어제";
  if (diff < 7) return `${diff}일 전`;
  if (diff < 30) return `${Math.floor(diff / 7)}주 전`;
  return fmtDate(s);
};
const subjClass = (subject) => {
  const idx = D.SUBJECTS.indexOf(subject);
  return ["s-rec", "s-srch", "s-rank", "s-pers", "s-disc"][idx] || "s-rec";
};
const barClass = (subject) => {
  const idx = D.SUBJECTS.indexOf(subject);
  return ["b-rec", "b-srch", "b-rank", "b-pers", "b-disc"][idx] || "b-rec";
};

window.UI = {
  Sidebar, PageHead, SecHead, Status, Priority, TKey, Tag, Who,
  Filter, SegText, Sparkline, Stat,
  fmtDate, fmtDateShort, ago, subjClass, barClass,
};
