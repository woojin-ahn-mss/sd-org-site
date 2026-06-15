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
import { auth } from '../api/supabase.js';

const YEAR = 2026;

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

const state = { byTab: {}, slides: [], idx: 0 };

export async function renderBriefing({ rootRel = '' }) {
  const stage = document.getElementById('deck-stage');
  stage.innerHTML = `<div class="slide-loading muted">불러오는 중…</div>`;

  // Supabase 세션 복원(로드맵 주제 매핑 인증). 실패해도 '미지정'으로 degrade.
  try { await auth.init(); } catch (e) { console.warn('[briefing] auth.init 실패', e); }

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

  // 팀은 메인주제로 배치, 카드는 로드맵 주제(ticket_subjects 매핑)로 묶는다.
  const subjById = new Map((planData.subjects || []).map(s => [s.id, s.name]));
  const items = joinTicketsWithOverrides(data.items || [], planData.overrides || [], YEAR)
    .filter(it => !isDropped(it) && projectOf(it) !== 'ETR');

  for (const t of TABS) {
    state.byTab[t.id] = buildTeams(items.filter(it => quarterKeys(it).has(t.quarter)), subjById);
  }

  buildSlides();
  bindControls();
  render();
}

/* ----- 데이터: 팀(메인주제) → 로드맵 주제 카드 ----- */

function buildTeams(items, subjById) {
  const order = [...TEAMS, ETC];
  // teamId → { cards: Map(cardId → {name, items}), keys: Set(distinct 티켓) }
  const acc = new Map(order.map(t => [t.id, { cards: new Map(), keys: new Set() }]));

  for (const it of items) {
    const teamId = SUBJ_TEAM.get(normSubject(it.mainSubject)) || ETC.id;
    const b = acc.get(teamId);
    b.keys.add(it.key);
    const sids = (it.subjectIds || []).filter(id => subjById.has(id));
    if (!sids.length) pushCard(b.cards, '__none__', '미지정', it);
    else for (const sid of sids) pushCard(b.cards, sid, subjById.get(sid), it);
  }

  const teams = [];
  for (const t of order) {
    const b = acc.get(t.id);
    if (!b.keys.size) continue;
    const subjects = [...b.cards.entries()]
      .map(([id, c]) => ({ id, name: c.name || '(주제)', items: sortItems(c.items) }))
      // '미지정' 은 맨 뒤, 나머지는 티켓 수 내림차순.
      .sort((a, c) => (a.id === '__none__') - (c.id === '__none__')
        || c.items.length - a.items.length
        || a.name.localeCompare(c.name));
    teams.push({ id: t.id, name: t.name, color: t.color, subjects, total: b.keys.size });
  }
  return teams;
}

function pushCard(cards, id, name, it) {
  if (!cards.has(id)) cards.set(id, { name, items: [] });
  cards.get(id).items.push(it);
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
    stage.querySelectorAll('.subj-card').forEach(c => {
      c.addEventListener('click', () => openSubjectDialog(s.team, Number(c.dataset.sub)));
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
       <span class="cover-team-n num">${tm.total}건 · 메인주제 ${tm.subjects.length}</span>
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
    <button type="button" class="subj-card" data-sub="${si}" style="--c:${team.color};">
      <div class="subj-card-top">
        <span class="subj-card-dot" style="background:${team.color};"></span>
        <span class="subj-card-n num">${s.items.length}</span>
      </div>
      <div class="subj-card-name">${escapeHtml(s.name)}</div>
      <div class="subj-card-hint">과제 ${s.items.length}개 보기 →</div>
    </button>`).join('');
  return `
    <div class="slide slide-team">
      <div class="slide-kicker">${escapeHtml(t.label)} · ${escapeHtml(t.tag)} · 주제를 클릭하면 과제가 나옵니다</div>
      <h2 class="slide-h"><span class="team-bar" style="background:${team.color};"></span>${escapeHtml(team.name)} <span class="slide-h-n" style="color:${team.color};">${team.total}건</span></h2>
      <div class="subj-grid">${cards}</div>
    </div>`;
}

/** 주제 카드 클릭 → 과제 리스트 다이얼로그. */
function openSubjectDialog(team, subIdx) {
  const dlg = document.getElementById('subj-dialog');
  const s = team.subjects[subIdx];
  if (!dlg || !s) return;
  dlg.querySelector('[data-dlg-body]').innerHTML = `
    <div class="dlg-head">
      <span class="team-bar" style="background:${team.color};"></span>
      <h3>${escapeHtml(s.name)} <span class="dlg-n" style="color:${team.color};">${s.items.length}건</span></h3>
      <button type="button" class="dlg-close" data-dlg-close aria-label="닫기">✕</button>
    </div>
    <div class="dlg-list"><ul class="subj-tickets">${s.items.map(ticketHtml).join('')}</ul></div>`;
  bindJiraLinks(dlg);
  if (!dlg.open) dlg.showModal();
}

function ticketHtml(it) {
  const url = jiraUrl(it.key);
  const keyHtml = url
    ? `<a class="key" href="${url}" target="_blank" rel="noopener noreferrer" data-jira-key="${escapeAttr(it.key)}">${escapeHtml(it.key)}</a>`
    : `<span class="key muted">${escapeHtml(it.key || '')}</span>`;
  return `<li class="th-item">
      <span class="st-dot ${statusCls(it.statusCategory)}"></span>
      ${keyHtml}
      <span class="th-sum">${escapeHtml(it.summary || '')}</span>
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
