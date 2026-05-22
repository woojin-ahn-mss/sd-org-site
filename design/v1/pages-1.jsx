// Page: Home + Roadmap (Gantt)
const { useState: _u1, useMemo: _u2, useEffect: _u3, Fragment: _u4 } = React;
const D2 = window.SD_DATA;
const { Icon, Avatar, Assignee, Status, Priority, Chip, PageHead, Seg, FilterPill, Donut, Sparkline, KpiCard, fmtDate } = window.UI;

// =============== HOME ===============
function HomePage({ onNav }) {
  const todayLabel = "2026-05-22 (목)";
  return (
    <div className="page">
      <PageHead
        title="홈"
        sub={`${todayLabel} · 오늘 확인할 사항 ${D2.ETR_MINE.filter(e => e.needCheck).length}건`}
        actions={
          <>
            <button className="btn ghost"><Icon name="bell" /> 알림</button>
            <button className="btn primary"><Icon name="external" /> Jira 대시보드</button>
          </>
        }
      />

      {/* KPI */}
      <div className="kpi-grid">
        <KpiCard label="이번 분기 진척률" value="62" unit="%" pct={62} />
        <KpiCard label="P0 처리율" value="58" unit="%" pct={58} />
        <KpiCard label="임박 마감 (7일)" value="4" unit="건" delta={1} deltaText="지난주 +1" />
        <KpiCard label="확인 필요 (ETR)" value="3" unit="건" delta={-1} deltaText="어제 −1" />
        <KpiCard label="패스트트랙 진행" value="3" unit="/5" delta={0} deltaText="변동 없음" />
        <KpiCard label="다음 동기화" value="14" unit="h" delta={0} deltaText="06:00 KST" />
      </div>

      <div className="section-head"><h2>오늘의 액션</h2><small>각 영역 상위 5건</small></div>
      <div className="row3">
        <HomeWidget title="확인 필요 (ETR)" badge={D2.ETR_MINE.filter(e=>e.needCheck).length} onMore={()=>onNav("etr")}>
          {D2.ETR_MINE.filter(e=>e.needCheck).slice(0,5).map(e => (
            <div key={e.key} className="mini-row" onClick={()=>onNav("etr")}>
              <div className="grow">
                <div className="title">{e.summary}</div>
                <div className="meta"><span className="tkt">{e.key}</span> · {e.reporter}</div>
              </div>
              <Status name={e.status} />
            </div>
          ))}
        </HomeWidget>

        <HomeWidget title="패스트트랙 최근 업데이트" badge={D2.FASTTRACK.length} onMore={()=>onNav("fasttrack")}>
          {D2.FASTTRACK.slice(0,5).map(f => (
            <div key={f.key} className="mini-row" onClick={()=>onNav("fasttrack")}>
              <div className="grow">
                <div className="title">{f.summary}</div>
                <div className="meta">
                  <span className="tkt">{f.key}</span>
                  <span>· {f.reporter}</span>
                  <span>· {f.progress.done}/{f.progress.total}</span>
                </div>
              </div>
              <div className="progress" style={{ width: 60 }}>
                <span style={{ width: (f.progress.done/f.progress.total*100) + "%" }}></span>
              </div>
            </div>
          ))}
        </HomeWidget>

        <HomeWidget title="이번 주 마감" badge={4} onMore={()=>onNav("roadmap")}>
          {D2.INITIATIVES.filter(i=>i.due && i.due >= "2026-05-22" && i.due <= "2026-06-15").slice(0,5).map(i => (
            <div key={i.key} className="mini-row" onClick={()=>onNav("roadmap")}>
              <div className="grow">
                <div className="title">{i.summary}</div>
                <div className="meta">
                  <span className="tkt">{i.key}</span>
                  <span>· {i.main}</span>
                  <span>· {fmtDate(i.due)}</span>
                </div>
              </div>
              <Priority value={i.priority} />
            </div>
          ))}
        </HomeWidget>
      </div>

      <div className="section-head"><h2>모든 페이지</h2></div>
      <div className="tile-grid">
        {[
          { id:"roadmap", icon:"gantt", h:"로드맵 (간트)", p:"메인주제별 Initiative 타임라인" },
          { id:"progress", icon:"rocket", h:"진행 현황", p:"상태 분포 · 흐름 · 지연 · 리스크" },
          { id:"resource", icon:"users", h:"리소스", p:"프로젝트·담당자별 부하 분배" },
          { id:"performance", icon:"chart", h:"성과", p:"분기별 출시 + 임팩트 (보고용)" },
          { id:"roadmap-plan", icon:"board", h:"로드맵 관리", p:"1년 분기 보드 — Jira + 키워드" },
          { id:"fasttrack", icon:"bolt", h:"패스트트랙", p:"임원 요청(ETR+one) 추적" },
          { id:"etr", icon:"inbox", h:"ETR", p:"외부 조직 요청, 본인 담당" },
          { id:"home", icon:"home", h:"홈", p:"이 화면" },
        ].map(t => (
          <div key={t.id} className="tile" onClick={()=>onNav(t.id)}>
            <span className="ico"><Icon name={t.icon} size={18} /></span>
            <h4>{t.h}</h4>
            <p>{t.p}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function HomeWidget({ title, badge, children, onMore }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}{badge !== undefined && <span className="chip" style={{ marginLeft: 4 }}>{badge}</span>}</h3>
        <button className="btn ghost sm" onClick={onMore}>전체보기 <Icon name="chevron" size={11} /></button>
      </div>
      <div>{children}</div>
    </div>
  );
}

// =============== ROADMAP (GANTT) ===============
function RoadmapPage() {
  const [tab, setTab] = useState("quarter"); // "quarter" | "month"
  const [openGroups, setOpenGroups] = useState(() => Object.fromEntries(D2.SUBJECTS.map(s => [s, true])));
  const [filterSubjects, setFilterSubjects] = useState(new Set(D2.SUBJECTS));
  const [filterPriority, setFilterPriority] = useState(new Set(["P0","P1","P2","P3"]));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [extraCols, setExtraCols] = useState({ assignee: false, labels: false, start: false });

  const Q_LABELS = ["2025-Q4","2026-Q1","2026-Q2","2026-Q3","2026-Q4","2027-Q1"];
  const M_LABELS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
  const currentIdx = tab === "quarter" ? 2 : 4; // Q2 or May

  const filtered = D2.INITIATIVES.filter(i => filterSubjects.has(i.main) && filterPriority.has(i.priority));
  const grouped = D2.SUBJECTS.map(s => ({ subject: s, items: filtered.filter(i => i.main === s) })).filter(g => g.items.length);

  const toggleSubject = (s) => {
    const n = new Set(filterSubjects);
    n.has(s) ? n.delete(s) : n.add(s);
    setFilterSubjects(n);
  };
  const togglePri = (p) => {
    const n = new Set(filterPriority);
    n.has(p) ? n.delete(p) : n.add(p);
    setFilterPriority(n);
  };

  // Column widths
  const metaW = 360 + (extraCols.assignee ? 100 : 0) + (extraCols.labels ? 110 : 0) + (extraCols.start ? 90 : 0);
  const cells = tab === "quarter" ? Q_LABELS.length : M_LABELS.length;
  const cellW = tab === "quarter" ? 170 : 90;
  const gridTemplate = `${metaW}px repeat(${cells}, ${cellW}px)`;

  const altColor = (subj) => ["alt-1","alt-2","alt-3","alt-4",""][D2.SUBJECTS.indexOf(subj) % 5];

  // Bar position for quarter view: single quarter cell
  const renderBar = (i) => {
    if (tab === "quarter") {
      const idx = Q_LABELS.indexOf(i.yq);
      if (idx < 0) return null;
      return (
        <div className={"gantt-bar " + altColor(i.main)} style={{ left: idx * cellW + 8, width: cellW - 16 }}>
          {i.key}
        </div>
      );
    }
    // month view
    if (i.start && i.due) {
      const [sy, sm] = i.start.split("-").map(Number);
      const [dy, dm] = i.due.split("-").map(Number);
      // map only 2026 months
      if (sy !== 2026 || dy !== 2026) return null;
      const left = (sm - 1) * cellW + 4;
      const w = (dm - sm + 1) * cellW - 8;
      return <div className={"gantt-bar " + altColor(i.main)} style={{ left, width: w }}>{i.key}</div>;
    }
    if (!i.start && i.due) {
      const [dy, dm] = i.due.split("-").map(Number);
      if (dy !== 2026) return null;
      const right = dm * cellW - 4;
      const w = cellW * 0.6;
      return <div className={"gantt-bar fade " + altColor(i.main)} style={{ left: right - w, width: w }}>{i.key}</div>;
    }
    return null;
  };

  return (
    <div className="page">
      <PageHead
        title="로드맵"
        sub="메인주제별 Initiative 타임라인 — 분기 6개 / 월 12개 토글"
        actions={
          <>
            <Seg
              options={[{ value:"quarter", label:"분기 보기" },{ value:"month", label:"월 보기" }]}
              value={tab} onChange={setTab}
            />
            <button className="btn ghost"><Icon name="columns" /> 컬럼</button>
            <button className="btn ghost"><Icon name="download" /> 내보내기</button>
          </>
        }
      />

      <div className="filter-bar">
        <span className="filter-label">메인주제</span>
        {D2.SUBJECTS.map(s => (
          <FilterPill key={s} active={filterSubjects.has(s)} onClick={()=>toggleSubject(s)}>{s}</FilterPill>
        ))}
        <span className="filter-divider"></span>
        <span className="filter-label">우선순위</span>
        {["P0","P1","P2","P3"].map(p => (
          <FilterPill key={p} active={filterPriority.has(p)} onClick={()=>togglePri(p)}>{p}</FilterPill>
        ))}
        <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={()=>setShowAdvanced(!showAdvanced)}>
          <Icon name="filter" size={12} /> 고급 필터 {showAdvanced ? "↑" : "↓"}
        </button>
      </div>

      {showAdvanced && (
        <div className="filter-bar">
          <span className="filter-label">상태</span>
          {["발의","검토중","In Progress","대기","완료"].map(s => (
            <FilterPill key={s}>{s}</FilterPill>
          ))}
          <span className="filter-divider"></span>
          <span className="filter-label">담당자</span>
          {["김민서","이도윤","최지훈","송재현","정하늘"].map(p => (
            <FilterPill key={p}>{p}</FilterPill>
          ))}
        </div>
      )}

      <div className="gantt">
        <div className="gantt-scroll">
          <div className="gantt-grid" style={{ gridTemplateColumns: gridTemplate, minWidth: metaW + cells * cellW }}>
            {/* Head row */}
            <div className="gantt-head meta-head" style={{ display: "grid", gridTemplateColumns: `1fr ${extraCols.assignee?"100px ":""}${extraCols.labels?"110px ":""}${extraCols.start?"90px ":""}70px 80px`, gap: 0 }}>
              <div style={{ alignSelf: "center" }}>Initiative</div>
              {extraCols.assignee && <div style={{ alignSelf: "center" }}>담당자</div>}
              {extraCols.labels && <div style={{ alignSelf: "center" }}>레이블</div>}
              {extraCols.start && <div style={{ alignSelf: "center" }}>시작</div>}
              <div style={{ alignSelf: "center" }}>P</div>
              <div style={{ alignSelf: "center" }}>기한</div>
            </div>
            {(tab === "quarter" ? Q_LABELS : M_LABELS).map((lbl, i) => (
              <div key={i} className={"time-head" + (i === currentIdx ? " current" : "")}>{lbl}</div>
            ))}

            {/* Body */}
            {grouped.map(g => (
              <Fragment key={g.subject}>
                <div className="gantt-row group" onClick={()=>setOpenGroups({...openGroups, [g.subject]: !openGroups[g.subject]})}>
                  <div>
                    <span className={"caret" + (openGroups[g.subject] ? " open" : "")}><Icon name="chevron" size={12}/></span>
                    {g.subject}
                    <span className="chip" style={{ marginLeft: 8 }}>{g.items.length}</span>
                  </div>
                  {Array.from({length: cells}).map((_,i) => <div key={i} className={"gantt-cell" + (i === currentIdx ? " current" : "")}></div>)}
                </div>
                {openGroups[g.subject] && g.items.map(i => (
                  <div key={i.key} className="gantt-row">
                    <div className="meta" style={{ display: "grid", gridTemplateColumns: `1fr ${extraCols.assignee?"100px ":""}${extraCols.labels?"110px ":""}${extraCols.start?"90px ":""}70px 80px`, gap: 0, padding: 0 }}>
                      <div className="gantt-meta" style={{ padding: "0 10px" }}>
                        <span className="key">{i.key}</span>
                        <span className="sum">{i.summary}</span>
                      </div>
                      {extraCols.assignee && <div style={{ padding: "0 6px" }}><Avatar name={i.assignee} size="s" /></div>}
                      {extraCols.labels && <div style={{ padding: "0 6px", display:"flex", gap: 4 }}>{i.labels.map(l => <Chip key={l}>{l}</Chip>)}</div>}
                      {extraCols.start && <div style={{ padding: "0 6px", fontSize: 11, color: "var(--text-dim)" }}>{fmtDate(i.start)}</div>}
                      <div style={{ padding: "0 6px" }}><Priority value={i.priority} /></div>
                      <div style={{ padding: "0 10px", fontSize: 11, color: "var(--text-dim)" }}>{fmtDate(i.due)}</div>
                    </div>
                    {Array.from({length: cells}).map((_,idx) => (
                      <div key={idx} className={"gantt-cell" + (idx === currentIdx ? " current" : "")}>
                        {idx === 0 && renderBar(i)}
                      </div>
                    ))}
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-12" style={{ marginTop: 12, fontSize: 11, color: "var(--text-faint)" }}>
        <span className="flex gap-6"><span style={{ width: 14, height: 8, background: "var(--blue)", borderRadius: 2 }}></span> 01.추천</span>
        <span className="flex gap-6"><span style={{ width: 14, height: 8, background: "var(--green)", borderRadius: 2 }}></span> 02.검색</span>
        <span className="flex gap-6"><span style={{ width: 14, height: 8, background: "var(--orange)", borderRadius: 2 }}></span> 03.랭킹</span>
        <span className="flex gap-6"><span style={{ width: 14, height: 8, background: "var(--purple)", borderRadius: 2 }}></span> 04.개인화</span>
        <span className="flex gap-6"><span style={{ width: 14, height: 8, background: "var(--accent)", borderRadius: 2 }}></span> 05.디스커버리</span>
        <span style={{ marginLeft: "auto" }}>총 {filtered.length} 건 · 그룹 {grouped.length}개</span>
      </div>
    </div>
  );
}

Object.assign(window, { HomePage, RoadmapPage });
