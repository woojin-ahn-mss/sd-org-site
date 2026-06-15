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
import { quartersForItem } from '../gantt.js';

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

const state = { byTab: {}, slides: [], idx: 0 };

export async function renderBriefing({ rootRel = '' }) {
  const stage = document.getElementById('deck-stage');
  stage.innerHTML = `<div class="slide-loading muted">불러오는 중…</div>`;

  let data;
  try {
    data = await loadJson(`${rootRel}data/jira/initiatives.json`);
  } catch (err) {
    showError(stage, err);
    return;
  }

  const items = (data.items || []).filter(it => !isDropped(it) && projectOf(it) !== 'ETR');
  for (const t of TABS) {
    state.byTab[t.id] = buildTeams(items.filter(it => quartersForItem(it).has(t.quarter)));
  }

  buildSlides();
  bindControls();
  render();
}

/* ----- 데이터: 팀 → 메인주제 ----- */

function buildTeams(items) {
  // teamId → (subjectName → items[])
  const acc = new Map();
  for (const t of TEAMS) acc.set(t.id, new Map());
  acc.set(ETC.id, new Map());

  for (const it of items) {
    const name = normSubject(it.mainSubject) || '(메인주제 없음)';
    const teamId = SUBJ_TEAM.get(name) || ETC.id;
    const m = acc.get(teamId);
    if (!m.has(name)) m.set(name, []);
    m.get(name).push(it);
  }

  const teams = [];
  for (const t of [...TEAMS, ETC]) {
    const m = acc.get(t.id);
    let subjects;
    if (t.id === ETC.id) {
      subjects = [...m.entries()].map(([name, its]) => ({ name, items: sortItems(its) }))
        .sort((a, b) => b.items.length - a.items.length);
    } else {
      // 설정한 순서대로, 티켓 있는 것만.
      subjects = t.subjects.filter(s => m.has(s)).map(s => ({ name: s, items: sortItems(m.get(s)) }));
    }
    const total = subjects.reduce((n, s) => n + s.items.length, 0);
    if (total) teams.push({ id: t.id, name: t.name, color: t.color, subjects, total });
  }
  return teams;
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
