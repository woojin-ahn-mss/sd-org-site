/* =========================================================
   pages/briefing.js — 분기 발표 장표(슬라이드 덱)
   분기(2Q 회고 / 3Q 예고) → 팀(Home & Discovery / PDP & Engagement)
   → 메인주제별 티켓. mainSubject(Jira 필드) 기준이라 로그인 불필요.
   ←/→ 로 넘기고 전체화면 발표.
   ========================================================= */

import { loadJson } from '../fetch-data.js';
import { showError } from '../states.js';
import { jiraUrl, bindJiraLinks } from '../jira-link.js';
import { escapeHtml, escapeAttr } from '../escape.js';
import { loadAll as loadPlanData, joinTicketsWithOverrides } from '../api/roadmap-plan-data.js';
import { loadOutcomes, upsertOutcome, loadHidden, setHidden, loadOrders, saveOrder, loadSubjectTeams, setSubjectTeam } from '../api/briefing-outcomes.js';
import { auth } from '../api/supabase.js';

const YEAR = 2026;

// 분기 발표에서 수동 제외할 Jira 키.
const EXCLUDE_KEYS = new Set(['TM-2685']);

const TABS = [
  { id: 'q2', quarter: '2026-Q2', label: '2026 2Q', tag: '회고' },
  { id: 'q3', quarter: '2026-Q3', label: '2026 3Q', tag: '예고' },
];

// 팀 → 메인주제(접두어 NN. 제거한 이름) 매핑. 순서 = 발표 노출 순서.
const TEAMS = [
  {
    id: 'hd', name: 'Home & Discovery', color: '#4fa3ff',
    subjects: ['추천', '랭킹/세일/커스텀판', '검색/카테고리/필터', '브랜드 인덱스/브랜드샵(홈)', '공통/네비게이션', '광고', '무배당발'],
  },
  {
    id: 'pe', name: 'PDP & Engagement', color: '#ff9f5a',
    subjects: ['콘텐츠/발매/스냅/라이브', 'PDP/후기', '이벤트/앱테크/온보딩', '캠페인', '쿠폰/세일/할인', '상품', '무신사머니'],
  },
];
const ETC = { id: 'etc', name: '기타', color: '#8a93a3' };

// normSubject → teamId
const SUBJ_TEAM = new Map();
for (const t of TEAMS) for (const s of t.subjects) SUBJ_TEAM.set(s, t.id);

const DROPPED = new Set(['철회/반려/취소', 'Dropped', 'DROPPED', '철회', '반려', '취소']);
const isDropped = (it) => DROPPED.has((it.status || '').trim());
const projectOf = (it) => it.project || (typeof it.key === 'string' ? it.key.split('-')[0] : '');
const normSubject = (ms) => (ms || '').replace(/^\s*\d+\s*\.\s*/, '').trim();

// 분기 배치 — Year/Quarter 필드 기준(시작~기한 범위로 인한 과잉 포함 방지).
// MSSCXTF/PEL/FT 는 이슈 완료일(resolutionDate) 기준. 둘 다 없으면 기한(dueDate) 분기.
const RES_PROJECTS = new Set(['MSSCXTF', 'PEL', 'FT']);
function dateToQuarter(ds) {
  if (typeof ds !== 'string' || ds.length < 7) return null;
  const y = ds.slice(0, 4), m = Number(ds.slice(5, 7));
  if (!/^\d{4}$/.test(y) || !(m >= 1 && m <= 12)) return null;
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}
function quarterKeys(it) {
  if (RES_PROJECTS.has(projectOf(it))) {
    const rq = dateToQuarter(it.resolutionDate);
    if (rq) return new Set([rq]);
  }
  const s = new Set();
  for (const yq of (it.yearQuarters || [])) if (yq) s.add(String(yq));
  if (it.yearQuarter) s.add(String(it.yearQuarter));
  if (s.size) return s;
  const dq = dateToQuarter(it.dueDate);
  return dq ? new Set([dq]) : new Set();
}

const state = { byTab: {}, itemsByTab: {}, subjById: new Map(), slides: [], idx: 0, outcomes: {}, hidden: new Set(), orders: {}, subjectTeam: {}, dlg: null };

const TEAM_BY_ID = new Map([...TEAMS, ETC].map(t => [t.id, t]));
const mainSubjectTeam = (it) => SUBJ_TEAM.get(normSubject(it.mainSubject)) || ETC.id;
/** 주제 티켓들의 대표(최다) 메인주제 팀. */
function dominantTeam(items) {
  const cnt = {};
  for (const it of items) { const tid = mainSubjectTeam(it); cnt[tid] = (cnt[tid] || 0) + 1; }
  return Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] || ETC.id;
}
/** 주제의 팀 — 명시 태깅 우선, 없으면 대표 메인주제 팀. */
const subjectTeamOf = (sid, items) => state.subjectTeam[sid] || dominantTeam(items);

/** 저장된 순서 적용 — orders[키]에 있는 순서대로, 없는 키는 기본(날짜) 순서로 뒤에. */
function orderedItems(s, quarter) {
  const ord = state.orders[`${quarter}:${s.id}`];
  if (!ord || !ord.length) return s.items;
  const pos = new Map(ord.map((k, i) => [k, i]));
  return s.items.slice().sort((a, b) =>
    (pos.has(a.key) ? pos.get(a.key) : Infinity) - (pos.has(b.key) ? pos.get(b.key) : Infinity));
}

const visN = (s) => s.items.filter(it => !state.hidden.has(it.key)).length;
function teamVisibleTotal(team) {
  const set = new Set();
  for (const s of team.subjects) for (const it of s.items) if (!state.hidden.has(it.key)) set.add(it.key);
  return set.size;
}
const teamVisibleSubjects = (team) => team.subjects.filter(s => visN(s) > 0).length;

const outcomeKey = (quarter, subjId) => `${quarter}:${subjId}`;
/** 성과 저장 — state 즉시 반영 + Supabase upsert(실패 시 alert). */
function saveOutcome(quarter, subjId, text) {
  const key = outcomeKey(quarter, subjId);
  if (text.trim()) state.outcomes[key] = text; else delete state.outcomes[key];
  upsertOutcome(quarter, subjId, text).catch(err => {
    console.error('[briefing] 성과 저장 실패', err);
    alert('성과 저장 실패 — 로그인 상태인지 확인해주세요.\n' + (err?.message || err));
  });
}

export async function renderBriefing({ rootRel = '' }) {
  const stage = document.getElementById('deck-stage');
  stage.innerHTML = `<div class="slide-loading muted">불러오는 중…</div>`;

  // Supabase 세션 복원(로드맵 주제 매핑 + 성과 인증). 실패해도 degrade.
  try { await auth.init(); } catch (e) { console.warn('[briefing] auth.init 실패', e); }
  [state.outcomes, state.hidden, state.orders, state.subjectTeam] = await Promise.all([
    loadOutcomes().catch(err => { console.warn('[briefing] 성과 로드 실패(미로그인 등):', err); return {}; }),
    loadHidden().catch(err => { console.warn('[briefing] 숨김 목록 로드 실패:', err); return new Set(); }),
    loadOrders().catch(err => { console.warn('[briefing] 순서 로드 실패:', err); return {}; }),
    loadSubjectTeams().catch(err => { console.warn('[briefing] 주제 팀 로드 실패:', err); return {}; }),
  ]);

  let data, planData;
  try {
    [data, planData] = await Promise.all([
      loadJson(`${rootRel}data/jira/initiatives.json`),
      loadPlanData(YEAR).catch(err => {
        console.warn('[briefing] 계위(Supabase) 로드 실패 — 주제 미지정으로 표시:', err);
        return { subjects: [], overrides: [] };
      }),
    ]);
  } catch (err) {
    showError(stage, err);
    return;
  }

  state.subjById = new Map((planData.subjects || []).map(s => [s.id, s.name]));
  const items = joinTicketsWithOverrides(data.items || [], planData.overrides || [], YEAR)
    .filter(it => !isDropped(it) && projectOf(it) !== 'ETR' && !EXCLUDE_KEYS.has(it.key));

  for (const t of TABS) state.itemsByTab[t.id] = items.filter(it => quarterKeys(it).has(t.quarter));
  rebuildTeams();

  buildSlides();
  bindControls();
  render();
}

/** 주제 팀 태깅 변경 시 byTab 재계산. */
function rebuildTeams() {
  for (const t of TABS) state.byTab[t.id] = buildTeams(state.itemsByTab[t.id] || []);
}

/* ----- 데이터: 로드맵 주제 카드 → 팀(주제 태깅) ----- */

function buildTeams(items) {
  // 1) 로드맵 주제 단위로 티켓 모으기. 미매핑 티켓은 메인주제 팀별 '패스트트랙'.
  const bySubject = new Map();             // sid → items[]
  const noneByTeam = new Map();            // teamId → items[] (패스트트랙)
  for (const it of items) {
    const sids = (it.subjectIds || []).filter(id => state.subjById.has(id));
    if (!sids.length) {
      const tid = mainSubjectTeam(it);
      if (!noneByTeam.has(tid)) noneByTeam.set(tid, []);
      noneByTeam.get(tid).push(it);
    } else {
      for (const sid of sids) {
        if (!bySubject.has(sid)) bySubject.set(sid, []);
        bySubject.get(sid).push(it);
      }
    }
  }

  const order = [...TEAMS, ETC];
  const acc = new Map(order.map(t => [t.id, { cards: [], keys: new Set() }]));
  // 2) 각 주제 → 한 팀에 통째로 배치 (명시 태깅 || 대표 메인주제 팀).
  for (const [sid, its] of bySubject) {
    const teamId = subjectTeamOf(sid, its);
    const b = acc.get(teamId) || acc.get(ETC.id);
    b.cards.push({ id: sid, name: state.subjById.get(sid) || '(주제)', items: sortItems(its) });
    for (const it of its) b.keys.add(it.key);
  }
  // 3) 패스트트랙 (미매핑) — 메인주제 팀별.
  for (const [teamId, its] of noneByTeam) {
    const b = acc.get(teamId) || acc.get(ETC.id);
    b.cards.push({ id: '__none__', name: '패스트트랙', items: sortItems(its) });
    for (const it of its) b.keys.add(it.key);
  }

  const teams = [];
  for (const t of order) {
    const b = acc.get(t.id);
    if (!b.keys.size) continue;
    const subjects = b.cards.sort((a, c) =>
      (a.id === '__none__') - (c.id === '__none__')
      || c.items.length - a.items.length
      || a.name.localeCompare(c.name));
    teams.push({ id: t.id, name: t.name, color: t.color, subjects, total: b.keys.size });
  }
  return teams;
}

/** 관리 모드 — 이 주제를 어느 팀에 둘지 선택 (패스트트랙은 제외). */
function teamPickerHtml(s) {
  if (s.id === '__none__') return '';
  const cur = subjectTeamOf(s.id, s.items);
  const btns = [...TEAMS, ETC].map(t =>
    `<button type="button" class="dlg-team-btn${t.id === cur ? ' on' : ''}" data-subj-team="${t.id}"
       style="${t.id === cur ? `background:${t.color};border-color:${t.color};color:#08101f;` : ''}">${escapeHtml(t.name)}</button>`).join('');
  return `<div class="dlg-team"><span class="dlg-team-label">팀</span>${btns}</div>`;
}

/** 주제 팀 변경 → 저장 + byTab 재계산 + 다이얼로그가 같은 주제를 새 팀에서 가리키게 재배치. */
function changeSubjectTeam(sid, teamId) {
  if (sid === '__none__') return;
  const prev = state.subjectTeam[sid];
  state.subjectTeam[sid] = teamId;
  rebuildTeams();
  relocateDlg(sid);
  renderDialogBody();
  setSubjectTeam(sid, teamId).catch(err => {
    console.error('[briefing] 주제 팀 저장 실패', err);
    alert('주제 팀 저장 실패 — 로그인 상태인지 확인해주세요.\n' + (err?.message || err));
    if (prev) state.subjectTeam[sid] = prev; else delete state.subjectTeam[sid];
    rebuildTeams(); relocateDlg(sid); renderDialogBody();
  });
}

/** 재계산 후 다이얼로그의 team/subIdx 를 sid 가 있는 곳으로 갱신. */
function relocateDlg(sid) {
  if (!state.dlg) return;
  for (const team of state.byTab[state.dlg.tabId] || []) {
    const idx = team.subjects.findIndex(x => x.id === sid);
    if (idx >= 0) { state.dlg.team = team; state.dlg.subIdx = idx; return; }
  }
}

function sortItems(items) {
  return items.slice().sort((a, b) => {
    const da = a.resolutionDate || a.dueDate || '';
    const db = b.resolutionDate || b.dueDate || '';
    return da.localeCompare(db) || String(a.key).localeCompare(String(b.key));
  });
}

/* ----- 슬라이드 구성 ----- */

function buildSlides() {
  const slides = [];
  for (const t of TABS) {
    slides.push({ kind: 'cover', tab: t.id });
    for (const team of state.byTab[t.id]) slides.push({ kind: 'team', tab: t.id, team });
  }
  state.slides = slides;
  state.idx = Math.max(0, Math.min(state.idx, slides.length - 1));
}

/* ----- 렌더 ----- */

function render() {
  const stage = document.getElementById('deck-stage');
  const s = state.slides[state.idx];
  if (!s) { stage.innerHTML = ''; return; }
  if (s.kind === 'cover') stage.innerHTML = coverHtml(s.tab);
  else stage.innerHTML = teamHtml(s.team, s.tab);

  // 팀 슬라이드의 주제 카드 → 다이얼로그로 과제 표시.
  if (s.kind === 'team') {
    stage.querySelectorAll('.bf-subj-card').forEach(c => {
      c.addEventListener('click', () => openSubjectDialog(s.team, s.tab, Number(c.dataset.sub)));
    });
  }
  bindJiraLinks(stage);
  const pos = document.getElementById('deck-pos');
  if (pos) pos.textContent = `${state.idx + 1} / ${state.slides.length}`;
}

function tabMeta(tabId) { return TABS.find(t => t.id === tabId); }

function coverHtml(tabId) {
  const t = tabMeta(tabId);
  const teams = state.byTab[tabId] || [];
  const rows = teams.map(tm =>
    `<div class="cover-team">
       <span class="cover-team-dot" style="background:${tm.color};"></span>
       <span class="cover-team-name">${escapeHtml(tm.name)}</span>
       <span class="cover-team-n num">${teamVisibleTotal(tm)}건 · 메인주제 ${teamVisibleSubjects(tm)}</span>
     </div>`).join('');
  return `
    <div class="slide slide-cover">
      <div class="slide-kicker">QUARTERLY BRIEFING · ${escapeHtml(t.tag)}</div>
      <div class="cover-q">${escapeHtml(t.label)}</div>
      <div class="cover-sub">${t.tag === '회고' ? '진행·완료한 일' : '배포 예정'}</div>
      <div class="cover-teams">${rows}</div>
    </div>`;
}

function teamHtml(team, tabId) {
  const t = tabMeta(tabId);
  const cards = team.subjects.map((s, si) => `
    <button type="button" class="bf-subj-card" data-sub="${si}" style="--c:${team.color};">
      <div class="subj-card-top">
        <span class="subj-card-dot" style="background:${team.color};"></span>
        <span class="subj-card-n num">${visN(s)}</span>
      </div>
      <div class="subj-card-name">${escapeHtml(s.name)}</div>
      <div class="subj-card-hint">과제 ${visN(s)}개 보기 →</div>
    </button>`).join('');
  return `
    <div class="slide slide-team">
      <div class="slide-kicker">${escapeHtml(t.label)} · ${escapeHtml(t.tag)} · 주제를 클릭하면 과제가 나옵니다</div>
      <h2 class="slide-h"><span class="team-bar" style="background:${team.color};"></span>${escapeHtml(team.name)} <span class="slide-h-n" style="color:${team.color};">${teamVisibleTotal(team)}건</span></h2>
      <div class="subj-grid">${cards}</div>
    </div>`;
}

/** 주제 카드 클릭 → 성과 입력 + 과제 리스트 다이얼로그. */
function openSubjectDialog(team, tabId, subIdx) {
  const dlg = document.getElementById('subj-dialog');
  if (!dlg || !team.subjects[subIdx]) return;
  state.dlg = { team, tabId, subIdx, manage: false };
  renderDialogBody();
  if (!dlg.open) dlg.showModal();
}

/** 다이얼로그 본문 렌더 — 일반: 노출 티켓만 / 관리: 전체 + 숨기기·보이기 토글. */
function renderDialogBody() {
  const dlg = document.getElementById('subj-dialog');
  if (!dlg || !state.dlg) return;
  const { team, tabId, subIdx, manage } = state.dlg;
  const s = team.subjects[subIdx];
  const quarter = tabMeta(tabId).quarter;
  const oKey = outcomeKey(quarter, s.id);
  const ordered = orderedItems(s, quarter);
  const list = manage ? ordered : ordered.filter(it => !state.hidden.has(it.key));
  dlg.querySelector('[data-dlg-body]').innerHTML = `
    <div class="dlg-head">
      <span class="team-bar" style="background:${team.color};"></span>
      <h3>${escapeHtml(s.name)} <span class="dlg-n" style="color:${team.color};">${visN(s)}건</span></h3>
      <button type="button" class="dlg-manage${manage ? ' on' : ''}" data-dlg-manage>${manage ? '완료' : '관리'}</button>
      <button type="button" class="dlg-close" data-dlg-close aria-label="닫기">✕</button>
    </div>
    <div class="dlg-outcome">
      <div class="dlg-outcome-label" style="color:${team.color};">성과</div>
      <div class="bf-outcome" data-outcome tabindex="0" role="button">${outcomeViewHtml(state.outcomes[oKey] || '')}</div>
    </div>
    ${manage ? teamPickerHtml(s) : ''}
    ${manage ? `<div class="dlg-manage-hint">드래그로 순서 변경 · 숨기기로 발표에서 제외. (자동 저장)</div>` : ''}
    <div class="dlg-list"><ul class="subj-tickets${manage ? ' is-manage' : ''}">${list.map(it => ticketHtml(it, manage)).join('')}</ul></div>`;

  dlg.querySelector('[data-dlg-manage]')?.addEventListener('click', () => {
    state.dlg.manage = !state.dlg.manage;
    renderDialogBody();
  });
  if (manage) {
    dlg.querySelectorAll('[data-tk]').forEach(btn => {
      btn.addEventListener('click', () => toggleHidden(btn.dataset.tk));
    });
    dlg.querySelectorAll('[data-subj-team]').forEach(btn => {
      btn.addEventListener('click', () => changeSubjectTeam(s.id, btn.dataset.subjTeam));
    });
    bindDnd(dlg.querySelector('.subj-tickets'), quarter, s);
  }
  bindOutcome(dlg, quarter, s.id);
  bindJiraLinks(dlg);
}

/** 관리 모드 드래그앤드롭 순서 변경 — drop 시 전체 키 순서를 Supabase 저장. */
function bindDnd(ul, quarter, s) {
  if (!ul) return;
  let dragKey = null;
  ul.querySelectorAll('li[draggable="true"]').forEach(li => {
    li.addEventListener('dragstart', (e) => {
      dragKey = li.dataset.key;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragKey); } catch {}
    });
    li.addEventListener('dragend', () => { li.classList.remove('dragging'); dragKey = null; });
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      const targetKey = li.dataset.key;
      if (!dragKey || dragKey === targetKey) return;
      const after = (e.clientY - li.getBoundingClientRect().top) > li.offsetHeight / 2;
      reorderTicket(quarter, s, dragKey, targetKey, after);
    });
  });
}

function reorderTicket(quarter, s, dragKey, targetKey, after) {
  const cur = orderedItems(s, quarter).map(it => it.key);  // 현재 전체 순서
  const from = cur.indexOf(dragKey);
  if (from < 0) return;
  cur.splice(from, 1);
  let to = cur.indexOf(targetKey);
  if (to < 0) return;
  if (after) to += 1;
  cur.splice(to, 0, dragKey);

  const key = `${quarter}:${s.id}`;
  const prev = state.orders[key];
  state.orders[key] = cur;
  renderDialogBody();
  saveOrder(quarter, s.id, cur).catch(err => {
    console.error('[briefing] 순서 저장 실패', err);
    alert('순서 저장 실패 — 로그인 상태인지 확인해주세요.\n' + (err?.message || err));
    if (prev) state.orders[key] = prev; else delete state.orders[key];
    renderDialogBody();
  });
}

function toggleHidden(key) {
  const willHide = !state.hidden.has(key);
  if (willHide) state.hidden.add(key); else state.hidden.delete(key);
  renderDialogBody();
  setHidden(key, willHide).catch(err => {
    console.error('[briefing] 노출 설정 저장 실패', err);
    alert('티켓 노출 설정 저장 실패 — 로그인 상태인지 확인해주세요.\n' + (err?.message || err));
    if (willHide) state.hidden.delete(key); else state.hidden.add(key);
    renderDialogBody();
  });
}

/** 성과 텍스트 → 표시 HTML. 통 필드(입력 그대로, 줄바꿈·띄어쓰기 보존; '-' 불릿은 사용자가 직접). */
function outcomeViewHtml(text) {
  if (!text || !text.trim()) return `<span class="bf-outcome-ph">+ 성과 입력 (클릭)</span>`;
  return `<div class="bf-outcome-text">${escapeHtml(text)}</div>`;
}

/** 성과 영역 — 클릭하면 textarea 편집, blur 시 Supabase 저장. */
function bindOutcome(dlg, quarter, subjId) {
  const view = dlg.querySelector('[data-outcome]');
  if (!view) return;
  const key = outcomeKey(quarter, subjId);
  const edit = () => {
    if (dlg.querySelector('.bf-outcome-input')) return;
    const ta = document.createElement('textarea');
    ta.className = 'bf-outcome-input';
    ta.value = state.outcomes[key] || '';
    ta.placeholder = '성과를 입력하세요 (줄바꿈·\'-\' 불릿 자유)';
    view.replaceWith(ta);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.addEventListener('blur', () => {
      const text = ta.value;
      saveOutcome(quarter, subjId, text);
      const nv = document.createElement('div');
      nv.className = 'bf-outcome'; nv.tabIndex = 0; nv.setAttribute('role', 'button');
      nv.setAttribute('data-outcome', '');
      nv.innerHTML = outcomeViewHtml(text);
      ta.replaceWith(nv);
      nv.addEventListener('click', edit);
      nv.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); edit(); } });
    });
  };
  view.addEventListener('click', edit);
  view.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); edit(); } });
}

function ticketHtml(it, manage = false) {
  const url = jiraUrl(it.key);
  const keyHtml = url
    ? `<a class="key" href="${url}" target="_blank" rel="noopener noreferrer" data-jira-key="${escapeAttr(it.key)}">${escapeHtml(it.key)}</a>`
    : `<span class="key muted">${escapeHtml(it.key || '')}</span>`;
  const hidden = state.hidden.has(it.key);
  const toggle = manage
    ? `<button type="button" class="bf-tk-toggle${hidden ? ' is-hidden' : ''}" data-tk="${escapeAttr(it.key)}">${hidden ? '보이기' : '숨기기'}</button>`
    : '';
  const handle = manage ? `<span class="bf-tk-handle" aria-hidden="true">⠿</span>` : '';
  return `<li class="th-item${manage && hidden ? ' is-dim' : ''}"${manage ? ` draggable="true" data-key="${escapeAttr(it.key)}"` : ''}>
      ${handle}
      <span class="st-dot ${statusCls(it.statusCategory)}"></span>
      ${keyHtml}
      <span class="th-sum">${escapeHtml(it.summary || '')}</span>
      ${toggle}
    </li>`;
}

/* ----- 컨트롤 ----- */

function bindControls() {
  document.getElementById('deck-prev')?.addEventListener('click', () => go(-1));
  document.getElementById('deck-next')?.addEventListener('click', () => go(1));
  document.getElementById('deck-edge-prev')?.addEventListener('click', () => go(-1));
  document.getElementById('deck-edge-next')?.addEventListener('click', () => go(1));

  const fullBtn = document.getElementById('deck-full');
  fullBtn?.addEventListener('click', () => {
    const deck = document.getElementById('deck');
    if (document.fullscreenElement) document.exitFullscreen();
    else deck.requestFullscreen?.().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    const deck = document.getElementById('deck');
    deck.classList.toggle('is-full', !!document.fullscreenElement);
    const fb = document.getElementById('deck-full');
    if (fb) fb.textContent = document.fullscreenElement ? '창 모드' : '전체화면';
  });

  // 다이얼로그: 닫기 버튼 / 백드롭 클릭으로 닫기.
  const dlg = document.getElementById('subj-dialog');
  dlg?.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-dlg-close]')) dlg.close();
  });
  // 닫힐 때 슬라이드 다시 그려 카드/건수에 숨김 반영.
  dlg?.addEventListener('close', () => { state.dlg = null; render(); });

  document.addEventListener('keydown', (e) => {
    if (dlg?.open) return;   // 다이얼로그 열려있으면 덱 이동 막음(ESC 는 네이티브가 닫음)
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
    else if (e.key === 'Home') { state.idx = 0; render(); }
    else if (e.key === 'End') { state.idx = state.slides.length - 1; render(); }
  });
}

function go(d) {
  state.idx = Math.max(0, Math.min(state.slides.length - 1, state.idx + d));
  render();
}

function statusCls(category) {
  if (category === 'done') return 'is-done';
  if (category === 'indeterminate') return 'is-progress';
  if (category === 'new') return 'is-new';
  return 'is-wait';
}
