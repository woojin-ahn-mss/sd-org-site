// Page: Home + Roadmap (Gantt) — v2 editorial
const { useState, Fragment } = React;
const D2 = window.SD_DATA;
const { PageHead, SecHead, Status, Priority, TKey, Who, Filter, SegText, Stat, Sparkline,
        fmtDate, fmtDateShort, ago, subjClass, barClass } = window.UI;

// =============== HOME ===============
function HomePage({ onNav }) {
  const needCheck = D2.ETR_MINE.filter(e => e.needCheck);
  const dueSoon = D2.INITIATIVES.filter(i => i.due && i.due >= "2026-05-22" && i.due <= "2026-06-15");
  const fasttrackActive = D2.FASTTRACK.filter(f => f.progress.done < f.progress.total).length;

  return (
    <div className="page">
      <PageHead
        kicker="2026.05.22 (목) — Search & Discovery 실"
        title="오늘."
        lede={
          <>
            확인이 필요한 ETR이 <span className="num">{needCheck.length}건</span>, 이번 주 마감이 <span className="num">{dueSoon.length}건</span> 있습니다.
            패스트트랙은 <span className="num">5건 중 {fasttrackActive}건</span> 진행 중이고, 이번 분기 진척률은 <strong>62%</strong>입니다.
          </>
        }
      />

      {/* Top stats — inline, no cards */}
      <div className="impact-stats" style={{ marginTop: 32 }}>
        <Stat label="Quarter Progress" value="62" unit="%" foot="P0 처리율 58%" />
        <Stat label="Due in 7 days" value={dueSoon.length} unit="건" foot="지난주 +1" footTone="up" />
        <Stat label="ETR Awaiting" value={needCheck.length} unit="건" foot="어제 −1" footTone="down" />
        <Stat label="Fast-Track Active" value={fasttrackActive} unit="/5" foot="변동 없음" />
      </div>

      {/* Need-check ETR */}
      <SecHead count={needCheck.length} actions={<button className="tlink" onClick={() => onNav("etr")}>전체 →</button>}>
        확인 필요 · ETR
      </SecHead>
      <div className="row-list">
        {needCheck.map(e => (
          <div key={e.key} className="row" style={{ gridTemplateColumns: "90px 1fr 160px 70px" }} onClick={() => onNav("etr")}>
            <TKey>{e.key}</TKey>
            <div className="row-main">
              <span className="row-title">{e.summary}</span>
              <span className="row-sub">
                <Who name={e.reporter} />
                <span className="sep">·</span>
                <span className="ago now">{ago(e.created)}</span>
              </span>
            </div>
            <Status name={e.status} />
            <span className="date right num">{fmtDate(e.duedate)}</span>
          </div>
        ))}
      </div>

      {/* Due this week */}
      <SecHead count={dueSoon.length} actions={<button className="tlink" onClick={() => onNav("roadmap")}>전체 →</button>}>
        이번 주 ~ 6월 중순 마감
      </SecHead>
      <div className="row-list">
        {dueSoon.slice(0, 5).map(i => (
          <div key={i.key} className="row" style={{ gridTemplateColumns: "90px 1fr 130px 50px 70px" }} onClick={() => onNav("roadmap")}>
            <TKey>{i.key}</TKey>
            <div className="row-main">
              <span className="row-title">{i.summary}</span>
              <span className="row-sub">
                <span>{i.main}</span>
                <span className="sep">·</span>
                <Who name={i.assignee} />
              </span>
            </div>
            <Status name={i.status} />
            <Priority value={i.priority} />
            <span className="date right num">{fmtDate(i.due)}</span>
          </div>
        ))}
      </div>

      {/* Fasttrack snapshot */}
      <SecHead count={D2.FASTTRACK.length} actions={<button className="tlink" onClick={() => onNav("fasttrack")}>전체 →</button>}>
        패스트트랙 · 최근
      </SecHead>
      <div className="row-list">
        {D2.FASTTRACK.slice(0, 3).map(f => (
          <div key={f.key} className="row" style={{ gridTemplateColumns: "90px 1fr 160px 110px" }} onClick={() => onNav("fasttrack")}>
            <TKey>{f.key}</TKey>
            <div className="row-main">
              <span className="row-title">{f.summary}</span>
              <span className="row-sub"><Who name={f.reporter} /><span className="sep">·</span><span>{ago(f.created)}</span></span>
            </div>
            <Status name={f.status} />
            <span className="prog num">
              {f.progress.done}/{f.progress.total}
              <span className="prog-bar"><span style={{ width: (f.progress.done/f.progress.total*100) + "%" }}></span></span>
            </span>
          </div>
        ))}
      </div>

      {/* Pages TOC */}
      <SecHead>모든 페이지</SecHead>
      <div className="toc-grid">
        {[
          { id:"roadmap", h:"로드맵 (간트)", d:"메인주제별 Initiative 타임라인", n:"02" },
          { id:"progress", h:"진행 현황", d:"상태 분포 · 흐름 · 지연 · 리스크", n:"03" },
          { id:"resource", h:"리소스", d:"프로젝트·담당자별 부하 분배", n:"04" },
          { id:"performance", h:"성과", d:"분기별 출시 + 임팩트 (보고용)", n:"05" },
          { id:"roadmap-plan", h:"로드맵 관리", d:"1년 분기 보드 — Jira + 키워드", n:"06" },
          { id:"fasttrack", h:"패스트트랙", d:"임원 요청(ETR+one) 추적", n:"07" },
          { id:"etr", h:"ETR", d:"외부 조직 요청 · 본인 담당", n:"08" },
          { id:"home", h:"홈", d:"이 화면 · 오늘의 브리핑", n:"01" },
        ].map(t => (
          <div key={t.id} className="toc-row" onClick={() => onNav(t.id)}>
            <div>
              <div className="toc-h">{t.h}</div>
              <div className="toc-d">{t.d}</div>
            </div>
            <span className="toc-num">{t.n} →</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============== ROADMAP ===============
function RoadmapPage() {
  const [tab, setTab] = useState("quarter");
  const [openGroups, setOpenGroups] = useState(() => Object.fromEntries(D2.SUBJECTS.map(s => [s, true])));
  const [filterSubjects, setFilterSubjects] = useState(new Set(D2.SUBJECTS));
  const [filterPri, setFilterPri] = useState(new Set(["P0","P1","P2","P3"]));

  const Q = ["25-Q4","26-Q1","26-Q2","26-Q3","26-Q4","27-Q1"];
  const QFULL = ["2025-Q4","2026-Q1","2026-Q2","2026-Q3","2026-Q4","2027-Q1"];
  const M = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
  const currentIdx = tab === "quarter" ? 2 : 4;

  const filtered = D2.INITIATIVES.filter(i => filterSubjects.has(i.main) && filterPri.has(i.priority));
  const grouped = D2.SUBJECTS.map(s => ({ subject: s, items: filtered.filter(i => i.main === s) })).filter(g => g.items.length);

  const toggle = (set, setter, v) => {
    const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); setter(n);
  };

  const cells = tab === "quarter" ? 6 : 12;
  const cellW = tab === "quarter" ? 150 : 80;
  const metaW = 380;
  const gridTemplate = `${metaW}px repeat(${cells}, ${cellW}px)`;

  const renderBar = (i) => {
    const bc = barClass(i.main);
    if (tab === "quarter") {
      const idx = QFULL.indexOf(i.yq);
      if (idx < 0) return null;
      return <div className={"g-bar " + bc} style={{ left: idx * cellW + 6, width: cellW - 12 }}>{i.key}</div>;
    }
    if (i.start && i.due) {
      const [sy, sm] = i.start.split("-").map(Number);
      const [dy, dm] = i.due.split("-").map(Number);
      if (sy !== 2026 || dy !== 2026) return null;
      const left = (sm - 1) * cellW + 3;
      const w = (dm - sm + 1) * cellW - 6;
      return <div className={"g-bar " + bc} style={{ left, width: w }}>{i.key}</div>;
    }
    if (!i.start && i.due) {
      const [dy, dm] = i.due.split("-").map(Number);
      if (dy !== 2026) return null;
      const right = dm * cellW - 3;
      const w = cellW * 0.6;
      return <div className={"g-bar fade " + bc} style={{ left: right - w, width: w }}>{i.key}</div>;
    }
    return null;
  };

  return (
    <div className="page">
      <PageHead
        kicker="Page 02"
        title="로드맵"
        lede={<>S&amp;D 실의 Initiative <span className="num">{D2.INITIATIVES.length}건</span>을 메인주제별로 분기·월 단위 타임라인으로 봅니다.</>}
      />

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 32 }}>
        <SegText
          value={tab} onChange={setTab}
          options={[{ value:"quarter", label:"분기 6개" },{ value:"month", label:"월 12개" }]}
        />
        <div style={{ display: "flex", gap: 16, fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          <span>{filtered.length} of {D2.INITIATIVES.length}</span>
          <button className="tlink">⚙ 컬럼</button>
          <button className="tlink">↓ Export</button>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <Filter
          label="메인주제" multi
          options={D2.SUBJECTS}
          value={filterSubjects}
          onChange={(v) => toggle(filterSubjects, setFilterSubjects, v)}
        />
        <Filter
          label="우선순위" multi
          options={["P0","P1","P2","P3"]}
          value={filterPri}
          onChange={(v) => toggle(filterPri, setFilterPri, v)}
        />
      </div>

      <div className="gantt" style={{ marginTop: 8 }}>
        <div className="g-grid" style={{ gridTemplateColumns: gridTemplate, minWidth: metaW + cells * cellW }}>
          {/* Head */}
          <div className="g-head" style={{ display: "contents" }}>
            <div className="gh-meta">Initiative · P · 기한</div>
            {(tab === "quarter" ? Q : M).map((lbl, i) => (
              <div key={i} className={"gh-time" + (i === currentIdx ? " current" : "")}>{lbl}</div>
            ))}
          </div>

          {grouped.map(g => (
            <Fragment key={g.subject}>
              <div className="g-row g-group" onClick={() => setOpenGroups({...openGroups, [g.subject]: !openGroups[g.subject]})}>
                <div>
                  <span className={"caret" + (openGroups[g.subject] ? " open" : "")}>›</span>
                  <span style={{ marginLeft: 8 }}>{g.subject}</span>
                  <span className="ct mono">{g.items.length}</span>
                </div>
                {Array.from({length: cells}).map((_,i) => <div key={i} className={"g-cell" + (i === currentIdx ? " current" : "")}></div>)}
              </div>
              {openGroups[g.subject] && g.items.map(i => (
                <div key={i.key} className="g-row">
                  <div className="g-meta" style={{ display: "grid", gridTemplateColumns: "80px 1fr 32px 64px", gap: 10, alignItems: "center" }}>
                    <TKey>{i.key}</TKey>
                    <span style={{ fontSize: 12.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.summary}</span>
                    <Priority value={i.priority} />
                    <span className="date num right" style={{ fontSize: 11 }}>{i.due ? fmtDate(i.due) : "—"}</span>
                  </div>
                  {Array.from({length: cells}).map((_,idx) => (
                    <div key={idx} className={"g-cell" + (idx === currentIdx ? " current" : "")}>
                      {idx === 0 && renderBar(i)}
                    </div>
                  ))}
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      </div>

      <div className="page-meta">
        <span>총 <span className="num">{filtered.length}</span> 건 · 그룹 <span className="num">{grouped.length}</span>개</span>
        <span style={{ display: "flex", gap: 18 }}>
          {D2.SUBJECTS.map(s => (
            <span key={s} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <span style={{
                width: 12, height: 6, display: "inline-block",
                background: s === "01.추천" ? "var(--accent)" : s === "02.검색" ? "#cbb88f" : s === "03.랭킹" ? "#d68a5a" : s === "04.개인화" ? "#b89a78" : "#9c9c9c"
              }}></span>
              {s}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

Object.assign(window, { HomePage, RoadmapPage });
