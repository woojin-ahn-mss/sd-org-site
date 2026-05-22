// Page: Roadmap-Plan + Fasttrack + ETR
const D4 = window.SD_DATA;
const { Icon: Ic3, Avatar: Av3, Assignee: As3, Status: St3, Priority: Pr3, Chip: Ch3, PageHead: PH3, Seg: Sg3, FilterPill: Fp3, KpiCard: Kp3, fmtDate: fd3 } = window.UI;
const { useState: _us3 } = React;

// =============== ROADMAP PLAN ===============
function RoadmapPlanPage() {
  const [year, setYear] = useState("2026");
  // Combine jira initiatives with year-quarter into "Jira cards"
  const jiraCards = D4.INITIATIVES.filter(i => i.yq && i.yq.startsWith(year)).map(i => ({
    id: "jira-" + i.key, type: "jira", quarter: i.yq.split("-")[1], title: i.summary,
    main: i.main, priority: i.priority, project: i.project, ticketKey: i.key,
  }));
  const keywordCards = D4.KEYWORD_CARDS;
  const all = [...jiraCards, ...keywordCards];

  const pool = all.filter(c => !c.quarter);
  const byQ = (q) => all.filter(c => c.quarter === q);
  const quarters = ["Q1","Q2","Q3","Q4"];

  return (
    <div className="page">
      <PH3 title="로드맵 관리" sub="1년 분기 보드 — Jira 티켓 + 키워드 카드 혼합" actions={
        <>
          <div className="seg">
            <button className="on">{year}</button>
            <button>2027</button>
          </div>
          <button className="btn ghost"><Ic3 name="plus" /> 키워드 카드</button>
          <button className="btn"><Ic3 name="download" /> Export JSON</button>
        </>
      } />

      <div className="filter-bar">
        <span className="filter-label">메인주제</span>
        {D4.SUBJECTS.map(s => <Fp3 key={s} active>{s}</Fp3>)}
        <span className="filter-divider"></span>
        <span className="filter-label">우선순위</span>
        {["P0","P1","P2"].map(p => <Fp3 key={p} active>{p}</Fp3>)}
      </div>

      <div className="qboard">
        <div className="qcol pool">
          <div className="qcol-head">
            <h4>미배치 풀</h4><small>{pool.length}</small>
          </div>
          {pool.map(c => <PlanCard key={c.id} card={c} />)}
          <button className="btn ghost sm" style={{ marginTop: 4 }}><Ic3 name="plus" size={12} /> 키워드 추가</button>
        </div>
        {quarters.map(q => (
          <div key={q} className="qcol">
            <div className="qcol-head">
              <h4>{year} {q}</h4>
              <small>{byQ(q).length}</small>
            </div>
            {byQ(q).map(c => <PlanCard key={c.id} card={c} />)}
          </div>
        ))}
      </div>

      <div className="flex gap-12" style={{ marginTop: 14, fontSize: 11, color: "var(--text-faint)", flexWrap: "wrap" }}>
        <span>실선 = Jira 티켓 (자동 수집, read-only)</span>
        <span>·</span>
        <span>점선 = 키워드 카드 (편집 가능, localStorage)</span>
        <span style={{ marginLeft: "auto" }}>드래그 앤 드롭으로 분기 이동 (Jira는 별도 업데이트 필요)</span>
      </div>
    </div>
  );
}

function PlanCard({ card }) {
  const subjClass = card.main ? "s" + card.main.split(".")[0] : "s01";
  return (
    <div className={"pcard " + subjClass + (card.type === "keyword" ? " dashed" : "")}>
      <h5>{card.title}</h5>
      <div className="pcard-meta">
        {card.type === "jira" && <span className="pcard-key">{card.ticketKey}</span>}
        {card.main && <span>{card.main}</span>}
        {card.project && <span>· {card.project}</span>}
        {card.priority && <Pr3 value={card.priority} />}
      </div>
      {card.notes && <div className="pcard-notes">{card.notes}</div>}
    </div>
  );
}

// =============== FASTTRACK ===============
function FasttrackPage() {
  const [open, setOpen] = useState({ "ETR-3775": true });
  const data = D4.FASTTRACK;
  const total = data.length;
  const inProg = data.filter(d => d.stCat === "amber" || d.stCat === "blue").length;
  const done = data.filter(d => d.stCat === "green").length;
  const wait = data.filter(d => d.stCat === "purple").length;

  return (
    <div className="page">
      <PH3 title="패스트트랙" sub={`임원 요청(ETR + one) — ${total}건`} actions={
        <>
          <button className="btn ghost"><Ic3 name="filter" /> 필터</button>
          <button className="btn primary"><Ic3 name="external" /> Jira 검색</button>
        </>
      } />

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <Kp3 label="전체" value={total} unit="건" deltaText="활성" />
        <Kp3 label="진행 중" value={inProg} unit="건" delta={1} deltaText="+1 이번주" />
        <Kp3 label="대기/발의" value={wait} unit="건" />
        <Kp3 label="완료" value={done} unit="건" />
      </div>

      <div className="filter-bar">
        <span className="filter-label">상태</span>
        {["전체","검토중","검토완료-우선착수","발의","완료"].map((s, i) => <Fp3 key={s} active={i===0}>{s}</Fp3>)}
        <span className="filter-divider"></span>
        <span className="filter-label">요청자</span>
        {["조만호 의장","박준모 CTO","한상미 부사장"].map(r => <Fp3 key={r}>{r}</Fp3>)}
        <span className="filter-divider"></span>
        <span className="filter-label">기간</span>
        {["최근 1개월","3개월","전체"].map((s, i) => <Fp3 key={s} active={i===0}>{s}</Fp3>)}
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 100 }}>ETR 키</th>
              <th>요약</th>
              <th style={{ width: 140 }}>요청자</th>
              <th style={{ width: 170 }}>상태</th>
              <th style={{ width: 130 }}>진척률</th>
              <th style={{ width: 100 }}>요청일</th>
              <th style={{ width: 100 }}>마감</th>
              <th style={{ width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {data.map(f => (
              <React.Fragment key={f.key}>
                <tr onClick={() => setOpen({ ...open, [f.key]: !open[f.key] })}>
                  <td><span className="tkt">{f.key}</span></td>
                  <td style={{ fontWeight: 500 }}>{f.summary}</td>
                  <td className="dim">{f.reporter}</td>
                  <td><St3 name={f.status} /></td>
                  <td>
                    <div className="flex gap-8">
                      <div className="progress" style={{ flex: 1, minWidth: 50 }}>
                        <span style={{ width: (f.progress.done / f.progress.total * 100) + "%" }}></span>
                      </div>
                      <span style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums", minWidth: 28 }}>
                        {f.progress.done}/{f.progress.total}
                      </span>
                    </div>
                  </td>
                  <td className="dim" style={{ fontVariantNumeric: "tabular-nums" }}>{fd3(f.created)}</td>
                  <td className="dim" style={{ fontVariantNumeric: "tabular-nums" }}>{fd3(f.duedate)}</td>
                  <td><span className={"caret" + (open[f.key] ? " open" : "")}><Ic3 name="chevron" size={12}/></span></td>
                </tr>
                {open[f.key] && (
                  <tr>
                    <td colSpan="8" style={{ padding: 0 }}>
                      <div className="expand-panel">
                        <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
                          연결 티켓 {f.linked.length}건
                        </div>
                        <div className="linked-list">
                          {f.linked.map(l => (
                            <div key={l.key} className="linked-row">
                              <span className="tkt">{l.key}</span>
                              <span style={{ fontSize: 12 }}>{l.summary}</span>
                              <St3 name={l.status} />
                              <As3 name={l.assignee} size="s" />
                              <div className="progress" style={{ minWidth: 50 }}>
                                <span style={{ width: l.pct + "%" }}></span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
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

  const filtered = filter === "확인 필요" ? need
    : filter === "진행 중" ? inProg
    : filter === "완료" ? done
    : filter === "반려" ? rejected
    : all;

  return (
    <div className="page">
      <PH3 title="ETR" sub={
        <span>외부 조직 요청 · 본인 담당
          <span className="chip" style={{ marginLeft: 8, background: "color-mix(in srgb, var(--orange) 16%, transparent)", color: "var(--orange)", borderColor: "color-mix(in srgb, var(--orange) 35%, transparent)" }}>
            {need.length}건 확인 필요
          </span>
        </span>
      } actions={
        <>
          <button className="btn ghost"><Ic3 name="bell" /> 알림 설정</button>
          <button className="btn primary"><Ic3 name="external" /> Jira 새 ETR</button>
        </>
      } />

      {/* Need check alert */}
      <div className="alert-box">
        <h3><Ic3 name="warn" size={14} /> 지금 확인 필요 — {need.length}건</h3>
        <div className="alert-grid">
          {need.map(e => (
            <div key={e.key} className="alert-card">
              <div className="row">
                <span className="tkt">{e.key}</span>
                <St3 name={e.status} />
                <span className="dim" style={{ marginLeft: "auto", fontSize: 11 }}>{fd3(e.created)}</span>
              </div>
              <div className="sum">{e.summary}</div>
              <div className="row">
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>요청자 · {e.reporter}</span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--orange)", fontWeight: 600 }}>확인하러 가기 →</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="filter-bar" style={{ marginTop: 14 }}>
        <span className="filter-label">상태</span>
        {["전체","확인 필요","진행 중","완료","반려"].map(s => (
          <Fp3 key={s} active={filter === s} onClick={() => setFilter(s)}>{s}</Fp3>
        ))}
        <span className="filter-divider"></span>
        <span className="filter-label">정렬</span>
        <Fp3 active>최근 업데이트</Fp3>
        <Fp3>마감 가까운 순</Fp3>
        <Fp3>생성일</Fp3>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-faint)" }}>총 {filtered.length}건</span>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 100 }}>키</th>
              <th>요약</th>
              <th style={{ width: 170 }}>상태</th>
              <th style={{ width: 160 }}>요청자</th>
              <th style={{ width: 110 }}>마감</th>
              <th style={{ width: 130 }}>최근 업데이트</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(e => (
              <tr key={e.key}>
                <td><span className="tkt">{e.key}</span></td>
                <td style={{ fontWeight: 500 }}>{e.summary}</td>
                <td><St3 name={e.status} /></td>
                <td className="dim">{e.reporter}</td>
                <td className="dim" style={{ fontVariantNumeric: "tabular-nums" }}>{fd3(e.duedate)}</td>
                <td className="dim" style={{ fontVariantNumeric: "tabular-nums" }}>{fd3(e.updated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-faint)", display: "flex", justifyContent: "space-between" }}>
          <span>1–{filtered.length} / {all.length}</span>
          <span>페이지네이션 (50건 단위)</span>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { RoadmapPlanPage, FasttrackPage, EtrPage });
