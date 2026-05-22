// Page: Progress + Resource + Performance
const D3 = window.SD_DATA;
const { Icon: Ic2, Avatar: Av2, Assignee: As2, Status: St2, Priority: Pr2, Chip: Ch2, PageHead: PH2, Seg: Sg2, FilterPill: Fp2, Donut: Dn2, Sparkline: Sp2, KpiCard: Kp2, fmtDate: fd2 } = window.UI;

// =============== PROGRESS ===============
function ProgressPage() {
  // Mock status distribution
  const statusDist = [
    { name: "발의", value: 12, color: "var(--purple)" },
    { name: "검토중", value: 18, color: "var(--amber)" },
    { name: "In Progress", value: 24, color: "var(--blue)" },
    { name: "대기", value: 9, color: "var(--slate)" },
    { name: "완료 (이번 분기)", value: 11, color: "var(--green)" },
    { name: "반려", value: 3, color: "var(--red)" },
  ];

  const projectFlow = [
    { proj: "CBP",    inProg: 8, review: 5, wait: 2, prop: 3, done: 4 },
    { proj: "TM",     inProg: 6, review: 4, wait: 1, prop: 2, done: 3 },
    { proj: "PBO",    inProg: 4, review: 3, wait: 2, prop: 1, done: 1 },
    { proj: "PEL",    inProg: 3, review: 2, wait: 2, prop: 2, done: 1 },
    { proj: "MSSCXTF",inProg: 2, review: 2, wait: 1, prop: 2, done: 1 },
    { proj: "TF",     inProg: 1, review: 1, wait: 1, prop: 1, done: 1 },
    { proj: "SNDPRD", inProg: 0, review: 1, wait: 0, prop: 1, done: 0 },
    { proj: "CMALL",  inProg: 0, review: 0, wait: 0, prop: 0, done: 0 },
  ];

  const overdue = [
    { key: "PBO-820", summary: "홈피드 이벤트 모듈 v1", project: "PBO", status: "In Progress", assignee: "박서연", due: "2026-05-10", stale: 12 },
    { key: "TM-2188", summary: "검색 결과 그리드 모듈화", project: "TM", status: "검토중", assignee: "정하늘", due: "2026-05-15", stale: 7 },
    { key: "CBP-1318", summary: "추천 결과 fallback 정책", project: "CBP", status: "In Progress", assignee: "김민서", due: "2026-05-18", stale: 4 },
  ];

  const upcoming = [
    { key: "MSSCXTF-71", summary: "랭킹 모델 A/B 실험 파이프라인", project: "MSSCXTF", status: "In Progress", assignee: "송재현", due: "2026-06-10", stale: 0 },
    { key: "CBP-1342", summary: "추천 다양성 알고리즘 v2", project: "CBP", status: "In Progress", assignee: "김민서", due: "2026-06-28", stale: 0 },
    { key: "TM-2210", summary: "검색 의도 분류기 리뉴얼", project: "TM", status: "In Progress", assignee: "최지훈", due: "2026-06-30", stale: 0 },
    { key: "SNDPRD-22", summary: "신상품 디스커버리 모듈", project: "SNDPRD", status: "In Progress", assignee: "최지훈", due: "2026-06-30", stale: 0 },
  ];

  const stale = [
    { key: "PEL-410", summary: "검색결과 무한스크롤 실험", project: "PEL", status: "In Progress", assignee: "한승우", due: null, stale: 42 },
    { key: "CBP-1290", summary: "추천 다양성 점수 측정 지표", project: "CBP", status: "In Progress", assignee: "이도윤", due: null, stale: 38 },
    { key: "TF-487", summary: "랭킹 후처리 알고리즘 검증", project: "TF", status: "In Progress", assignee: "송재현", due: null, stale: 33 },
  ];

  return (
    <div className="page">
      <PH2 title="진행 현황" sub="일감 상태 분포 · 프로젝트별 흐름 · 리스크" actions={
        <>
          <button className="btn ghost"><Ic2 name="filter" /> 필터</button>
          <button className="btn ghost"><Ic2 name="download" /> 내보내기</button>
        </>
      } />

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <Kp2 label="전체 진행 중" value="74" unit="건" delta={3} deltaText="지난주 +3" />
        <Kp2 label="이번 주 신규 발의" value="9" unit="건" delta={2} deltaText="지난주 +2" />
        <Kp2 label="이번 주 완료" value="6" unit="건" delta={1} deltaText="지난주 +1" />
        <Kp2 label="지연 (마감 초과)" value="3" unit="건" delta={1} deltaText="지난주 +1" />
      </div>

      <div className="section-head"><h2>상태 분포 & 프로젝트 흐름</h2></div>
      <div className="row2">
        <div className="card">
          <div className="card-head"><h3>상태 분포</h3><span className="meta">진행 중 + 발의 + 완료</span></div>
          <div className="card-pad">
            <div className="donut-wrap">
              <Dn2 data={statusDist} />
              <ul className="donut-legend">
                {statusDist.map(s => (
                  <li key={s.name}>
                    <span className="sw" style={{ background: s.color }}></span>
                    <span className="lbl">{s.name}</span>
                    <span className="num">{s.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>프로젝트별 흐름</h3><span className="meta">상태 누적</span></div>
          <div className="card-pad">
            {projectFlow.map(p => {
              const total = p.inProg + p.review + p.wait + p.prop + p.done;
              const w = (v) => total ? (v / total * 100) + "%" : "0%";
              return (
                <div key={p.proj} className="bar-row">
                  <span className="proj">{p.proj}</span>
                  <div className="stack-bar">
                    <span style={{ width: w(p.inProg), background: "var(--blue)" }}></span>
                    <span style={{ width: w(p.review), background: "var(--amber)" }}></span>
                    <span style={{ width: w(p.wait), background: "var(--slate)" }}></span>
                    <span style={{ width: w(p.prop), background: "var(--purple)" }}></span>
                    <span style={{ width: w(p.done), background: "var(--green)" }}></span>
                  </div>
                  <span className="num">{total}</span>
                </div>
              );
            })}
            <div className="flex gap-12" style={{ marginTop: 12, fontSize: 11, color: "var(--text-faint)", flexWrap: "wrap" }}>
              <span className="flex gap-6"><span style={{ width: 10, height: 10, background: "var(--blue)", borderRadius: 2 }}></span>In Progress</span>
              <span className="flex gap-6"><span style={{ width: 10, height: 10, background: "var(--amber)", borderRadius: 2 }}></span>검토중</span>
              <span className="flex gap-6"><span style={{ width: 10, height: 10, background: "var(--slate)", borderRadius: 2 }}></span>대기</span>
              <span className="flex gap-6"><span style={{ width: 10, height: 10, background: "var(--purple)", borderRadius: 2 }}></span>발의</span>
              <span className="flex gap-6"><span style={{ width: 10, height: 10, background: "var(--green)", borderRadius: 2 }}></span>완료</span>
            </div>
          </div>
        </div>
      </div>

      <div className="section-head"><h2>리스크 리스트</h2></div>
      <RiskTable title="지연 티켓 (마감 초과)" tone="red" rows={overdue} />
      <div style={{ height: 10 }} />
      <RiskTable title="임박 마감 (7일 이내)" tone="amber" rows={upcoming} />
      <div style={{ height: 10 }} />
      <RiskTable title="장기 정체 (In Progress 30일+)" tone="purple" rows={stale} />
    </div>
  );
}

function RiskTable({ title, tone, rows }) {
  const toneColor = { red: "var(--red)", amber: "var(--amber)", purple: "var(--purple)" }[tone] || "var(--accent)";
  return (
    <div className="card">
      <div className="card-head">
        <h3><span className="chip-dot" style={{ background: toneColor }}></span>{title}</h3>
        <span className="meta">{rows.length}건</span>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 90 }}>키</th>
            <th>요약</th>
            <th style={{ width: 110 }}>프로젝트</th>
            <th style={{ width: 130 }}>상태</th>
            <th style={{ width: 130 }}>담당자</th>
            <th style={{ width: 100 }}>기한</th>
            <th style={{ width: 90, textAlign: "right" }}>정체</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key}>
              <td><span className="tkt">{r.key}</span></td>
              <td>{r.summary}</td>
              <td><Ch2>{r.project}</Ch2></td>
              <td><St2 name={r.status} /></td>
              <td><As2 name={r.assignee} size="s" /></td>
              <td className="dim" style={{ fontVariantNumeric: "tabular-nums" }}>{fd2(r.due)}</td>
              <td style={{ textAlign: "right", color: r.stale > 30 ? "var(--red)" : r.stale > 0 ? "var(--amber)" : "var(--text-faint)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                {r.stale > 0 ? `${r.stale}일` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =============== RESOURCE ===============
function ResourcePage() {
  const projects = ["CBP","PBO","PEL","TM","MSSCXTF","TF","SNDPRD","CMALL"];
  const load = [
    { proj: "CBP",    count: 11, people: 4, p0: 2, p1: 4 },
    { proj: "TM",     count: 9,  people: 3, p0: 2, p1: 3 },
    { proj: "PBO",    count: 7,  people: 2, p0: 1, p1: 3 },
    { proj: "PEL",    count: 6,  people: 3, p0: 0, p1: 3 },
    { proj: "MSSCXTF",count: 5,  people: 2, p0: 1, p1: 2 },
    { proj: "TF",     count: 3,  people: 2, p0: 0, p1: 1 },
    { proj: "SNDPRD", count: 2,  people: 1, p0: 0, p1: 1 },
    { proj: "CMALL",  count: 1,  people: 1, p0: 0, p1: 0 },
  ];
  const maxCount = Math.max(...load.map(l => l.count));

  const heatPeople = ["김민서","이도윤","박서연","최지훈","정하늘","한승우","오은채","송재현","윤다은","안우진"];
  // load level 0-4 per person × project
  const heatData = {
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
      <PH2 title="리소스" sub="프로젝트·담당자별 일감 분배 — 과부하 / 빈 자리 조정" />

      <div className="section-head"><h2>프로젝트별 부하</h2></div>
      <div className="card card-pad">
        {load.map(l => (
          <div key={l.proj} className="bar-row" style={{ gridTemplateColumns: "110px 1fr 60px 70px" }}>
            <span className="proj">{l.proj}</span>
            <div className="stack-bar" style={{ height: 22 }}>
              <span style={{ width: (l.count/maxCount*100) + "%", background: "var(--accent)" }}></span>
            </div>
            <span className="num">{l.count}건</span>
            <span className="dim" style={{ fontSize: 11, textAlign: "right" }}>{l.people}명 · P0 {l.p0}</span>
          </div>
        ))}
      </div>

      <div className="section-head"><h2>담당자 × 프로젝트 히트맵</h2><small>셀 수 = 진행 중 티켓</small></div>
      <div className="card card-pad">
        <div className="heat" style={{ gridTemplateColumns: "120px repeat(8, 1fr)" }}>
          <div></div>
          {projects.map(p => <div key={p} className="heat-collabel">{p}</div>)}
          {heatPeople.map(person => (
            <React.Fragment key={person}>
              <div className="heat-rowlabel"><Av2 name={person} size="s" />{person}</div>
              {heatData[person].map((v, i) => (
                <div key={i} className={"heat-cell l" + v}>{v > 0 ? v : ""}</div>
              ))}
            </React.Fragment>
          ))}
        </div>
        <div className="flex gap-8" style={{ marginTop: 14, fontSize: 10.5, color: "var(--text-faint)" }}>
          부하:
          {[0,1,2,3,4].map(l => (
            <div key={l} className={"heat-cell l" + l} style={{ width: 28, height: 18, fontSize: 9 }}>{l === 0 ? "" : l}</div>
          ))}
          <span>(0 → 4+)</span>
        </div>
      </div>

      <div className="section-head"><h2>과부하 알림</h2><small>5건 이상 In Progress 또는 P0/P1 3건 이상</small></div>
      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>담당자</th>
              <th style={{ width: 130, textAlign: "right" }}>진행 중</th>
              <th style={{ width: 100, textAlign: "right" }}>P0</th>
              <th style={{ width: 100, textAlign: "right" }}>P1</th>
              <th style={{ width: 130 }}>가장 임박</th>
              <th style={{ width: 120 }}>레벨</th>
            </tr>
          </thead>
          <tbody>
            {overload.map(o => (
              <tr key={o.name}>
                <td><As2 name={o.name} size="s" /></td>
                <td style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{o.total}건</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{o.p0}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{o.p1}</td>
                <td className="dim" style={{ fontVariantNumeric: "tabular-nums" }}>{fd2(o.soonDue)}</td>
                <td>
                  {o.level === "high"
                    ? <span className="st st-red"><span className="chip-dot" style={{ background: "currentColor" }}></span>HIGH</span>
                    : <span className="st st-amber"><span className="chip-dot" style={{ background: "currentColor" }}></span>WARN</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
      <PH2 title="성과" sub="분기별 출시 + 임팩트 — 상위 보고용" actions={
        <>
          <button className="btn ghost"><Ic2 name="download" /> PDF 출력</button>
          <button className="btn primary"><Ic2 name="external" /> 보고 모드</button>
        </>
      } />

      <div className="seg" style={{ display: "inline-flex", marginBottom: 16 }}>
        {quarters.map(q => (
          <button key={q} className={quarter === q ? "on" : ""} onClick={() => setQuarter(q)}>{q}</button>
        ))}
      </div>

      <div className="section-head"><h2>분기 임팩트</h2></div>
      <div className="impact-grid">
        {kpis.map((k, i) => (
          <div key={i} className="impact">
            <div className="impact-label">{k.name}</div>
            <div className="impact-val">{k.value}<span className="unit">{k.unit}</span></div>
            <div className={"impact-delta " + (k.deltaPrev > 0 ? "up" : k.deltaPrev < 0 ? "down" : "")}>
              {k.deltaPrev > 0 ? <Ic2 name="arrowUp" size={11} /> : k.deltaPrev < 0 ? <Ic2 name="arrowDown" size={11} /> : null}
              {k.deltaPrev > 0 ? "+" : ""}{k.deltaPrev}{k.unit === "건" ? "건" : "p"} 전 분기 대비
            </div>
            <Sp2 values={k.spark} w={70} h={26} color={i === 0 ? "var(--blue)" : i === 1 ? "var(--green)" : i === 2 ? "var(--orange)" : "var(--purple)"} />
          </div>
        ))}
      </div>

      <div className="section-head"><h2>분기 하이라이트</h2><small>{launches.length}건 출시</small></div>
      <div className="row2">
        {launches.map((l, i) => (
          <div key={l.key} className="launch-card">
            <div className="date">{fd2(l.date)} · <span className="tkt">{l.key}</span></div>
            <h4>{l.title}</h4>
            <p>{l.desc}</p>
            <div className="impact-line">{l.impact}</div>
          </div>
        ))}
      </div>

      <div className="section-head"><h2>분기 출시 타임라인</h2></div>
      <PerfTimeline launches={launches} quarter={quarter} />
    </div>
  );
}

function PerfTimeline({ launches, quarter }) {
  // 3 months per quarter
  const QM = { "2026-Q2": [4,5,6], "2026-Q1": [1,2,3], "2025-Q4": [10,11,12], "2025-Q3": [7,8,9] };
  const months = QM[quarter] || [4,5,6];
  return (
    <div className="timeline">
      <div className="tl-axis"></div>
      {months.map((m, i) => {
        const x = `calc(${(i / (months.length - 1)) * 100}% )`;
        return (
          <Fragment key={m}>
            <span className="tl-tick" style={{ left: `calc(${(i/(months.length-1))*100}%)` }}></span>
            <span className="tl-month" style={{ left: `calc(${(i/(months.length-1))*100}%)` }}>{m}월</span>
          </Fragment>
        );
      })}
      {launches.map((l, i) => {
        const [y, m, d] = l.date.split("-").map(Number);
        const idx = months.indexOf(m);
        if (idx < 0) return null;
        const monthPct = (d - 1) / 30;
        const pct = ((idx + monthPct) / (months.length - 1)) * 100;
        return (
          <Fragment key={l.key}>
            <div className="tl-dot" style={{ left: `${pct}%` }} title={l.title}></div>
            <div className="tl-label" style={{ left: `${pct}%` }}>{l.title.slice(0, 14)}{l.title.length > 14 ? "…" : ""}</div>
          </Fragment>
        );
      })}
    </div>
  );
}

Object.assign(window, { ProgressPage, ResourcePage, PerformancePage });
