// Page: Progress + Resource + Performance — v2
const { useState, Fragment } = React;
const D3 = window.SD_DATA;
const { PageHead: PH2, SecHead: SH2, Status: St2, Priority: Pr2, TKey: TK2, Who: Wh2,
        Filter: Fl2, SegText: Sg2, Stat: Stat2, Sparkline: Spk2, fmtDate: fd2 } = window.UI;

// =============== PROGRESS ===============
function ProgressPage() {
  const dist = [
    { name: "발의",       value: 12, color: "var(--faint)",    cls: "prop" },
    { name: "검토중",     value: 18, color: "var(--info)",     cls: "review" },
    { name: "In Progress",value: 24, color: "var(--accent)",   cls: "progress" },
    { name: "대기",       value: 9,  color: "var(--faintest)", cls: "wait" },
    { name: "완료",       value: 11, color: "var(--success)",  cls: "done" },
    { name: "반려",       value: 3,  color: "var(--alert)",    cls: "block" },
  ];
  const total = dist.reduce((s,d) => s + d.value, 0);

  const flow = [
    { proj: "CBP",     ip:8, rv:5, wt:2, pp:3, dn:4 },
    { proj: "TM",      ip:6, rv:4, wt:1, pp:2, dn:3 },
    { proj: "PBO",     ip:4, rv:3, wt:2, pp:1, dn:1 },
    { proj: "PEL",     ip:3, rv:2, wt:2, pp:2, dn:1 },
    { proj: "MSSCXTF", ip:2, rv:2, wt:1, pp:2, dn:1 },
    { proj: "TF",      ip:1, rv:1, wt:1, pp:1, dn:1 },
    { proj: "SNDPRD",  ip:0, rv:1, wt:0, pp:1, dn:0 },
    { proj: "CMALL",   ip:0, rv:0, wt:0, pp:0, dn:0 },
  ];

  const overdue = [
    { key: "PBO-820",  summary: "홈피드 이벤트 모듈 v1",    project: "PBO", status: "In Progress", assignee: "박서연", due: "2026-05-10", stale: 12 },
    { key: "TM-2188",  summary: "검색 결과 그리드 모듈화",  project: "TM",  status: "검토중",       assignee: "정하늘", due: "2026-05-15", stale: 7 },
    { key: "CBP-1318", summary: "추천 결과 fallback 정책", project: "CBP", status: "In Progress", assignee: "김민서", due: "2026-05-18", stale: 4 },
  ];
  const upcoming = [
    { key: "MSSCXTF-71", summary: "랭킹 모델 A/B 실험 파이프라인", project: "MSSCXTF", status: "In Progress", assignee: "송재현", due: "2026-06-10" },
    { key: "CBP-1342",   summary: "추천 다양성 알고리즘 v2",       project: "CBP",     status: "In Progress", assignee: "김민서", due: "2026-06-28" },
    { key: "TM-2210",    summary: "검색 의도 분류기 리뉴얼",       project: "TM",      status: "In Progress", assignee: "최지훈", due: "2026-06-30" },
    { key: "SNDPRD-22",  summary: "신상품 디스커버리 모듈",        project: "SNDPRD",  status: "In Progress", assignee: "최지훈", due: "2026-06-30" },
  ];
  const stale = [
    { key: "PEL-410",  summary: "검색결과 무한스크롤 실험",  project: "PEL", status: "In Progress", assignee: "한승우", stale: 42 },
    { key: "CBP-1290", summary: "추천 다양성 점수 측정 지표", project: "CBP", status: "In Progress", assignee: "이도윤", stale: 38 },
    { key: "TF-487",   summary: "랭킹 후처리 알고리즘 검증",  project: "TF",  status: "In Progress", assignee: "송재현", stale: 33 },
  ];

  return (
    <div className="page">
      <PH2
        kicker="Page 03"
        title="진행 현황"
        lede={<>전체 <span className="num">{total}건</span> 중 진행 중 <span className="num">{dist[2].value}건</span>, 마감 초과 <span className="num">{overdue.length}건</span>, 30일 이상 정체 <span className="num">{stale.length}건</span>이 있습니다.</>}
      />

      <div className="impact-stats" style={{ marginTop: 32 }}>
        <Stat2 label="In Progress" value={dist[2].value} unit="건" foot="지난주 +3" footTone="up" />
        <Stat2 label="이번 주 신규" value={9} unit="건" foot="지난주 +2" footTone="up" />
        <Stat2 label="이번 주 완료" value={6} unit="건" foot="지난주 +1" footTone="up" />
        <Stat2 label="마감 초과" value={overdue.length} unit="건" foot="확인 필요" footTone="down" />
      </div>

      <SH2>상태 분포</SH2>
      <div className="summary-bar">
        {dist.map(d => (
          <span key={d.name} style={{ width: (d.value / total * 100) + "%", background: d.color, color: d.cls === "wait" ? "var(--text)" : "var(--bg)" }}>
            {d.value > 4 ? d.value : ""}
          </span>
        ))}
      </div>
      <ul className="summary-legend" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {dist.map(d => (
          <li key={d.name}>
            <span className="sw" style={{ background: d.color }}></span>
            <span>{d.name}</span>
            <span className="ct num">{d.value}</span>
          </li>
        ))}
      </ul>

      <SH2 count={flow.length}>프로젝트별 흐름</SH2>
      <div className="row-list">
        {flow.map(p => {
          const t = p.ip + p.rv + p.wt + p.pp + p.dn;
          const pct = (v) => t ? (v / t * 100) + "%" : "0%";
          return (
            <div key={p.proj} className="bar-row">
              <span className="proj">{p.proj}</span>
              <div className="bar-stack">
                <span style={{ width: pct(p.ip), background: "var(--accent)" }}></span>
                <span style={{ width: pct(p.rv), background: "var(--info)" }}></span>
                <span style={{ width: pct(p.wt), background: "var(--faintest)" }}></span>
                <span style={{ width: pct(p.pp), background: "var(--faint)" }}></span>
                <span style={{ width: pct(p.dn), background: "var(--success)" }}></span>
              </div>
              <span className="num">{t}</span>
            </div>
          );
        })}
      </div>

      <SH2 count={overdue.length}>리스크 · 마감 초과</SH2>
      <RiskList rows={overdue} stale />
      <SH2 count={upcoming.length}>리스크 · 임박 마감 (7일)</SH2>
      <RiskList rows={upcoming} />
      <SH2 count={stale.length}>리스크 · 장기 정체 (30일+)</SH2>
      <RiskList rows={stale} stale noDue />
    </div>
  );
}

function RiskList({ rows, stale, noDue }) {
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th style={{ width: 90 }}>키</th>
          <th>요약</th>
          <th style={{ width: 90 }}>프로젝트</th>
          <th style={{ width: 130 }}>상태</th>
          <th style={{ width: 110 }}>담당</th>
          {!noDue && <th style={{ width: 80 }}>기한</th>}
          {stale && <th style={{ width: 60, textAlign: "right" }}>정체</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.key}>
            <td><TK2>{r.key}</TK2></td>
            <td>{r.summary}</td>
            <td><span className="mono dim" style={{ fontSize: 11.5 }}>{r.project}</span></td>
            <td><St2 name={r.status} /></td>
            <td><Wh2 name={r.assignee} /></td>
            {!noDue && <td className="date num">{fd2(r.due)}</td>}
            {stale && (
              <td className="right num" style={{ color: r.stale > 30 ? "var(--alert)" : "var(--accent)", fontWeight: 500 }}>
                {r.stale > 0 ? `${r.stale}d` : "—"}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// =============== RESOURCE ===============
function ResourcePage() {
  const projects = ["CBP","PBO","PEL","TM","MSSCXTF","TF","SNDPRD","CMALL"];
  const load = [
    { proj: "CBP",    count: 11, people: 4, p0: 2 },
    { proj: "TM",     count: 9,  people: 3, p0: 2 },
    { proj: "PBO",    count: 7,  people: 2, p0: 1 },
    { proj: "PEL",    count: 6,  people: 3, p0: 0 },
    { proj: "MSSCXTF",count: 5,  people: 2, p0: 1 },
    { proj: "TF",     count: 3,  people: 2, p0: 0 },
    { proj: "SNDPRD", count: 2,  people: 1, p0: 0 },
    { proj: "CMALL",  count: 1,  people: 1, p0: 0 },
  ];
  const maxCount = Math.max(...load.map(l => l.count));

  const heatPeople = ["김민서","이도윤","박서연","최지훈","정하늘","한승우","오은채","송재현","윤다은","안우진"];
  const heat = {
    "김민서": [4,0,0,1,1,2,0,0],
    "이도윤": [3,1,2,0,0,0,0,0],
    "박서연": [2,3,0,0,0,0,0,1],
    "최지훈": [1,0,0,3,1,0,2,0],
    "정하늘": [0,0,1,3,0,1,0,0],
    "한승우": [0,0,3,1,0,0,1,0],
    "오은채": [1,1,0,2,0,0,0,1],
    "송재현": [0,0,0,0,4,2,0,0],
    "윤다은": [0,0,0,1,3,0,1,0],
    "안우진": [1,1,1,1,1,0,0,0],
  };

  const overload = [
    { name: "김민서", total: 8, p0: 2, p1: 3, soonDue: "2026-06-10", level: "high" },
    { name: "최지훈", total: 6, p0: 1, p1: 3, soonDue: "2026-06-15", level: "warn" },
    { name: "송재현", total: 5, p0: 1, p1: 2, soonDue: "2026-06-30", level: "warn" },
  ];

  return (
    <div className="page">
      <PH2
        kicker="Page 04"
        title="리소스"
        lede={<>10명 · 8개 프로젝트 · 진행 중 <span className="num">{load.reduce((s,l)=>s+l.count,0)}건</span>. 과부하 의심 <span className="num">{overload.length}명</span>입니다.</>}
      />

      <SH2 count={load.length}>프로젝트별 부하</SH2>
      <div className="row-list">
        {load.map(l => (
          <div key={l.proj} className="bar-row" style={{ gridTemplateColumns: "110px 1fr 60px 80px" }}>
            <span className="proj">{l.proj}</span>
            <div className="bar-stack" style={{ height: 14 }}>
              <span style={{ width: (l.count/maxCount*100) + "%", background: "var(--accent)" }}></span>
            </div>
            <span className="num">{l.count}건</span>
            <span className="num" style={{ textAlign: "right", color: "var(--faint)", fontSize: 11 }}>{l.people}명 · P0 {l.p0}</span>
          </div>
        ))}
      </div>

      <SH2>담당자 × 프로젝트</SH2>
      <div className="heat" style={{ gridTemplateColumns: "120px repeat(8, 1fr)" }}>
        <div></div>
        {projects.map(p => <div key={p} className="heat-collabel">{p}</div>)}
        {heatPeople.map(person => (
          <Fragment key={person}>
            <div className="heat-rowlabel"><Wh2 name={person} /></div>
            {heat[person].map((v, i) => (
              <div key={i} className={"heat-cell" + (v > 0 ? " l" + v : "")}>{v > 0 ? v : ""}</div>
            ))}
          </Fragment>
        ))}
      </div>
      <div className="flex gap-8" style={{ marginTop: 14, fontSize: 11, color: "var(--faint)", fontFamily: "JetBrains Mono, monospace", letterSpacing: "0.08em" }}>
        <span>LOAD</span>
        {[0,1,2,3,4].map(l => (
          <div key={l} className={"heat-cell" + (l ? " l" + l : "")} style={{ width: 28, height: 20, fontSize: 10 }}>{l || ""}</div>
        ))}
        <span>0 → 4+</span>
      </div>

      <SH2 count={overload.length}>과부하 알림</SH2>
      <table className="tbl">
        <thead>
          <tr>
            <th>담당자</th>
            <th className="right" style={{ width: 100 }}>진행 중</th>
            <th className="right" style={{ width: 80 }}>P0</th>
            <th className="right" style={{ width: 80 }}>P1</th>
            <th style={{ width: 110 }}>가장 임박</th>
            <th style={{ width: 90 }}>레벨</th>
          </tr>
        </thead>
        <tbody>
          {overload.map(o => (
            <tr key={o.name}>
              <td><Wh2 name={o.name} /></td>
              <td className="right num" style={{ fontWeight: 600, fontSize: 13 }}>{o.total}건</td>
              <td className="right num">{o.p0}</td>
              <td className="right num">{o.p1}</td>
              <td className="date num">{fd2(o.soonDue)}</td>
              <td>
                <span className="st" style={{ color: o.level === "high" ? "var(--alert)" : "var(--accent)" }}>
                  {o.level === "high" ? "HIGH" : "WARN"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =============== PERFORMANCE ===============
function PerformancePage() {
  const [quarter, setQuarter] = useState("2026-Q2");
  const kpis = D3.QUARTER_KPIS[quarter] || [];
  const launches = D3.LAUNCHES[quarter] || [];
  const quarters = ["2025-Q3","2025-Q4","2026-Q1","2026-Q2"];

  return (
    <div className="page">
      <PH2
        kicker="Page 05"
        title="성과"
        lede={<>분기별 출시 과제와 임팩트를 정리합니다. 상위 보고용 화면이며, 분기 데이터는 출시 완료 후 자동 집계됩니다.</>}
      />

      <div style={{ marginTop: 32 }}>
        <Sg2
          value={quarter} onChange={setQuarter}
          options={quarters.map(q => ({ value: q, label: q }))}
        />
      </div>

      <SH2>분기 임팩트</SH2>
      <div className="impact-stats">
        {kpis.map((k, i) => (
          <div key={i} className="imp-stat">
            <div className="imp-label">{k.name}</div>
            <div className="imp-val num">{k.value}<span className="u">{k.unit}</span></div>
            <div className={"imp-delta" + (k.deltaPrev > 0 ? " up" : k.deltaPrev < 0 ? " down" : "")}>
              {k.deltaPrev > 0 ? "▲" : k.deltaPrev < 0 ? "▼" : "—"} {Math.abs(k.deltaPrev)}{k.unit === "건" ? "건" : "p"} vs 전 분기
            </div>
            <Spk2 values={k.spark} w={70} h={26} color={k.deltaPrev >= 0 ? "var(--success)" : "var(--alert)"} />
          </div>
        ))}
      </div>

      <SH2 count={launches.length} actions={<button className="tlink">↓ PDF</button>}>분기 하이라이트</SH2>
      <div>
        {launches.map(l => (
          <div key={l.key} className="entry">
            <div className="entry-date">
              {fd2(l.date)}
              <TK2>{l.key}</TK2>
            </div>
            <div>
              <h3>{l.title}</h3>
              <p>{l.desc}</p>
              <div className="impact-line">{l.impact}</div>
            </div>
          </div>
        ))}
      </div>

      <SH2>분기 타임라인</SH2>
      <PerfTimeline launches={launches} quarter={quarter} />
    </div>
  );
}

function PerfTimeline({ launches, quarter }) {
  const QM = { "2026-Q2": [4,5,6], "2026-Q1": [1,2,3], "2025-Q4": [10,11,12], "2025-Q3": [7,8,9] };
  const months = QM[quarter] || [4,5,6];
  return (
    <div style={{ padding: "24px 0 40px", borderTop: "1px solid var(--rule)", borderBottom: "1px solid var(--rule)", position: "relative", marginTop: 4 }}>
      <div style={{ height: 1, background: "var(--rule-strong)", position: "relative", margin: "30px 0" }}>
        {months.map((m, i) => (
          <Fragment key={m}>
            <span style={{ position: "absolute", left: ((i/(months.length-1))*100) + "%", top: -4, width: 1, height: 9, background: "var(--rule-strong)" }}></span>
            <span style={{ position: "absolute", left: ((i/(months.length-1))*100) + "%", top: -22, transform: "translateX(-50%)", fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--faint)" }}>{m}월</span>
          </Fragment>
        ))}
        {launches.map(l => {
          const [y, m, d] = l.date.split("-").map(Number);
          const idx = months.indexOf(m);
          if (idx < 0) return null;
          const monthPct = (d - 1) / 30;
          const pct = ((idx + monthPct) / (months.length - 1)) * 100;
          return (
            <Fragment key={l.key}>
              <div style={{ position: "absolute", left: pct + "%", top: -5, transform: "translateX(-50%)", width: 10, height: 10, background: "var(--accent)", border: "2px solid var(--bg)" }} title={l.title}></div>
              <div style={{ position: "absolute", left: pct + "%", top: 12, transform: "translateX(-50%)", fontSize: 11, color: "var(--dim)", whiteSpace: "nowrap" }}>{l.title.slice(0, 16)}{l.title.length > 16 ? "…" : ""}</div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { ProgressPage, ResourcePage, PerformancePage });
