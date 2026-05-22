// Page: Roadmap-Plan + Fasttrack + ETR — v2
const { useState, Fragment } = React;
const D4 = window.SD_DATA;
const { PageHead: PH3, SecHead: SH3, Status: St3, Priority: Pr3, TKey: TK3, Tag: Tag3, Who: Wh3,
        Filter: Fl3, SegText: Sg3, Stat: Stat3, fmtDate: fd3, ago: ago3, subjClass: sc3 } = window.UI;

// =============== ROADMAP PLAN ===============
function RoadmapPlanPage() {
  const [year, setYear] = useState("2026");
  const jiraCards = D4.INITIATIVES.filter(i => i.yq && i.yq.startsWith(year)).map(i => ({
    id: "jira-" + i.key, type: "jira", quarter: i.yq.split("-")[1],
    title: i.summary, main: i.main, priority: i.priority, project: i.project, ticketKey: i.key,
  }));
  const all = [...jiraCards, ...D4.KEYWORD_CARDS];
  const pool = all.filter(c => !c.quarter);
  const byQ = (q) => all.filter(c => c.quarter === q);

  return (
    <div className="page">
      <PH3
        kicker="Page 06"
        title="로드맵 관리"
        lede={<>1년치 로드맵을 분기 4컬럼 보드로 직접 짜는 작업대입니다. <strong>실선</strong>은 Jira 자동 수집, <strong>점선</strong>은 직접 추가한 키워드 카드.</>}
      />

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 32 }}>
        <Sg3 value={year} onChange={setYear} options={[{ value: "2026", label: "2026" }, { value: "2027", label: "2027" }]} />
        <div style={{ display: "flex", gap: 16, fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          <button className="tlink">＋ 키워드 추가</button>
          <button className="tlink">↓ JSON Export</button>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <Fl3 label="메인주제" multi
          options={D4.SUBJECTS}
          value={new Set(D4.SUBJECTS)}
          onChange={()=>{}} />
      </div>

      <div className="plan-board">
        <div className="plan-col pool">
          <div className="plan-col-h"><span>미배치</span><span className="ct num">{pool.length}</span></div>
          {pool.map(c => <PlanCard key={c.id} card={c} />)}
          <button className="tlink" style={{ alignSelf: "flex-start", marginTop: 4 }}>＋ 키워드 카드</button>
        </div>
        {["Q1","Q2","Q3","Q4"].map(q => (
          <div key={q} className="plan-col">
            <div className="plan-col-h"><span>{year}·{q}</span><span className="ct num">{byQ(q).length}</span></div>
            {byQ(q).map(c => <PlanCard key={c.id} card={c} />)}
          </div>
        ))}
      </div>

      <div className="page-meta">
        <span><span style={{ borderLeft: "2px solid var(--accent)", paddingLeft: 8, marginRight: 14 }}>실선 = Jira 티켓 (read-only)</span>
              <span style={{ borderLeft: "2px dashed var(--accent)", paddingLeft: 8 }}>점선 = 키워드 카드 (편집/저장)</span></span>
        <span className="right">드래그 앤 드롭으로 분기 이동 → Jira는 별도 업데이트</span>
      </div>
    </div>
  );
}

function PlanCard({ card }) {
  const sc = card.main ? sc3(card.main) : "";
  return (
    <div className={"plan-card " + sc + (card.type === "keyword" ? " k" : "")}>
      <h5>{card.title}</h5>
      <div className="pc-meta">
        {card.type === "jira" ? <TK3>{card.ticketKey}</TK3> : <Tag3>키워드</Tag3>}
        <span>{card.main}</span>
        {card.project && <span>· {card.project}</span>}
        {card.priority && <Pr3 value={card.priority} />}
      </div>
      {card.notes && <div className="pc-notes">{card.notes}</div>}
    </div>
  );
}

// =============== FASTTRACK ===============
function FasttrackPage() {
  const [open, setOpen] = useState({ "ETR-3775": true });
  const data = D4.FASTTRACK;
  const active = data.filter(d => d.progress.done < d.progress.total).length;

  return (
    <div className="page">
      <PH3
        kicker="Page 07"
        title="패스트트랙"
        lede={<>임원이 직접 의뢰한 ETR + <span className="num">one</span> 레이블 요청 <span className="num">{data.length}건</span>. 진행 중 <span className="num">{active}건</span>, 행을 누르면 연결된 Jira 티켓이 펼쳐집니다.</>}
      />

      <div className="impact-stats" style={{ marginTop: 32 }}>
        <Stat3 label="전체" value={data.length} unit="건" />
        <Stat3 label="진행 중" value={active} unit="건" foot="+1 이번주" footTone="up" />
        <Stat3 label="완료" value={data.length - active} unit="건" />
        <Stat3 label="요청자" value={new Set(data.map(d=>d.reporter)).size} unit="명" />
      </div>

      <SH3 count={data.length}>요청 목록</SH3>
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 90 }}>키</th>
            <th>요약</th>
            <th style={{ width: 140 }}>요청자</th>
            <th style={{ width: 160 }}>상태</th>
            <th style={{ width: 100 }}>진척</th>
            <th style={{ width: 80 }}>요청</th>
            <th style={{ width: 80 }}>마감</th>
            <th style={{ width: 20 }}></th>
          </tr>
        </thead>
        <tbody>
          {data.map(f => (
            <Fragment key={f.key}>
              <tr onClick={() => setOpen({...open, [f.key]: !open[f.key]})}>
                <td><TK3>{f.key}</TK3></td>
                <td style={{ fontWeight: 500 }}>{f.summary}</td>
                <td><Wh3 name={f.reporter} /></td>
                <td><St3 name={f.status} /></td>
                <td>
                  <span className="prog num">
                    {f.progress.done}/{f.progress.total}
                    <span className="prog-bar"><span style={{ width: (f.progress.done/f.progress.total*100) + "%" }}></span></span>
                  </span>
                </td>
                <td className="date num">{fd3(f.created)}</td>
                <td className="date num">{fd3(f.duedate)}</td>
                <td><span className={"caret" + (open[f.key] ? " open" : "")}>›</span></td>
              </tr>
              {open[f.key] && (
                <tr>
                  <td colSpan="8" style={{ padding: 0 }}>
                    <div className="expand">
                      <div className="expand-label">연결 티켓 · {f.linked.length}건</div>
                      {f.linked.map(l => (
                        <div key={l.key} className="linked-row">
                          <TK3>{l.key}</TK3>
                          <span>{l.summary}</span>
                          <St3 name={l.status} />
                          <Wh3 name={l.assignee} />
                          <span className="prog num">
                            {l.pct}%
                            <span className="prog-bar"><span style={{ width: l.pct + "%" }}></span></span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =============== ETR ===============
function EtrPage() {
  const [filter, setFilter] = useState("전체");
  const all = D4.ETR_MINE;
  const need = all.filter(e => e.needCheck);
  const inProg = all.filter(e => e.stCat === "amber" || e.stCat === "blue");
  const done = all.filter(e => e.stCat === "green");
  const rejected = all.filter(e => e.stCat === "red");

  const filterMap = {
    "전체": all,
    "확인 필요": need,
    "진행 중": inProg,
    "완료": done,
    "반려": rejected,
  };
  const filtered = filterMap[filter];

  return (
    <div className="page">
      <PH3
        kicker="Page 08"
        title="ETR"
        lede={
          <>외부 조직 요청 중 본인 담당 <span className="num">{all.length}건</span>.
            지금 <strong style={{ color: "var(--alert)" }}>확인이 필요한 요청 {need.length}건</strong>이 있습니다.</>
        }
      />

      {/* alert */}
      <div className="alert" style={{ marginTop: 28 }}>
        <div className="alert-head">⚠ 확인 필요 · {need.length}건</div>
        <div className="alert-list">
          {need.map(e => (
            <div key={e.key} className="alert-row">
              <TK3>{e.key}</TK3>
              <div className="row-title">{e.summary}</div>
              <St3 name={e.status} />
              <Wh3 name={e.reporter} />
              <span className="ago now mono" style={{ textAlign: "right" }}>{ago3(e.created)}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 32 }}>
        <Fl3
          label="상태"
          options={["전체","확인 필요","진행 중","완료","반려"]}
          value={filter}
          onChange={setFilter}
        />
      </div>

      <SH3 count={filtered.length}>전체 담당</SH3>
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 90 }}>키</th>
            <th>요약</th>
            <th style={{ width: 170 }}>상태</th>
            <th style={{ width: 160 }}>요청자</th>
            <th style={{ width: 80 }}>마감</th>
            <th style={{ width: 100 }}>최근 업데이트</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(e => (
            <tr key={e.key}>
              <td><TK3>{e.key}</TK3></td>
              <td style={{ fontWeight: 500 }}>{e.summary}</td>
              <td><St3 name={e.status} /></td>
              <td><Wh3 name={e.reporter} /></td>
              <td className="date num">{fd3(e.duedate)}</td>
              <td className="date num">{fd3(e.updated)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="page-meta">
        <span><span className="num">1–{filtered.length}</span> of <span className="num">{all.length}</span></span>
        <span className="right">페이지네이션 · 50건 단위</span>
      </div>
    </div>
  );
}

Object.assign(window, { RoadmapPlanPage, FasttrackPage, EtrPage });
