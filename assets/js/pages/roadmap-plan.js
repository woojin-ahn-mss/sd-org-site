/* =========================================================
   pages/roadmap-plan.js — 로드맵 관리 (PRD 4.6)
   1년치 보드: 미배치 / Q1 / Q2 / Q3 / Q4
   - Jira 카드: initiatives.json 에서 자동 + **localStorage 의 override 우선**
     · D&D 로 옮기면 ticketKey→quarter override 를 LS 에 저장
     · 다음 sync 후 Jira yearQuarter 가 바뀌어도 사용자 위치 유지
     · 단, 카드가 더 이상 jiraCards 에 없으면 (sync 에서 빠짐) override stale → 자동 정리
   - 키워드 카드: **localStorage 가 SoT**, 파일은 첫 시드 + 백업
     → 파일이 갱신돼도 LS 가 있으면 그대로 둠. "↓ JSON Export" 로 공유.
   ========================================================= */

import { loadJson } from '../fetch-data.js';
import { showError, showLoading, emptyHtml } from '../states.js';
import { jiraKeyHtml, jiraUrl } from '../jira-link.js';
import { scoped } from '../storage.js';
import { toast } from '../toast.js';
import { escapeHtml, escapeAttr } from '../escape.js';
import { attachModal } from '../modal.js';
import {
  newGoalId, isValidMonth, isValidPeriod, normalizeGoal,
  fmtPeriod, sortGoals, invertCardGoals, cleanCardGoals, reassignOrder,
  GOAL_COLORS,
} from '../goals.js';

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const SUBJECT_CLASS_MAP = {
  '01.추천': 's-rec',
  '02.검색': 's-srch',
  '03.랭킹': 's-rank',
  '04.개인화': 's-pers',
  '05.디스커버리': 's-disc',
};
const FILTERS_KEY = 'roadmapPlan.filters';
const SCHEMA_VERSION = 1;
const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,11}$/; // Jira project key

const GROUP_KEY = 'roadmapPlan.groupBy';

let state = {
  rootRel: '',
  year: 2026,
  jiraCards: [],
  keywordCards: [],
  filters: { mainSubject: null, priority: null, project: null },
  groupBy: 'subject',  // 'subject' | 'none'
  cardsStore: null,
  // ticketKey → quarter ('Q1'|'Q2'|'Q3'|'Q4'|null). null = 사용자가 pool 로 옮김.
  jiraOverrides: {},
  overridesStore: null,
  // 목표 (Goal)
  goals: [],
  cardGoals: {},        // cardId → goalId
  goalsStore: null,
  cardGoalsStore: null,
};

export async function renderRoadmapPlan({ rootRel = '' } = {}) {
  state.rootRel = rootRel;
  state.year = currentYear();
  state.filters = Object.assign({ mainSubject: null, priority: null, project: null },
    scoped(FILTERS_KEY).get({}));
  const savedGroup = scoped(GROUP_KEY).get(null);
  if (savedGroup === 'subject' || savedGroup === 'goal' || savedGroup === 'none') state.groupBy = savedGroup;

  renderYearSelect();
  bindTopActions();
  bindGroupToggle();

  await loadAll();
  refreshFiltersForValidity();
  renderFilters();
  renderHeader();
  renderGoalBoard();
  renderBoard();
}

/* ----- 데이터 로드 ----------------------------------------- */

async function loadAll() {
  const boardHost = document.getElementById('plan-board');
  showLoading(boardHost, { rows: 4, title: false });
  state.cardsStore = scoped(`roadmapPlan.cards.${state.year}`);
  state.overridesStore = scoped(`roadmapPlan.jiraOverrides.${state.year}`);
  state.jiraOverrides = state.overridesStore.get({}) || {};
  state.goalsStore = scoped(`roadmapPlan.goals.${state.year}`);
  state.cardGoalsStore = scoped(`roadmapPlan.cardGoals.${state.year}`);
  state.goals = (state.goalsStore.get([]) || []).map(normalizeGoal);
  state.cardGoals = state.cardGoalsStore.get({}) || {};

  // Jira initiatives → 한 ticket = 한 카드. 멀티 yearQuarter 면 state.year 매칭되는 분기에 위치
  try {
    const data = await loadJson(`${state.rootRel}data/jira/initiatives.json`);
    state.jiraCards = (data.items || [])
      .map(it => initiativeToCard(it, state.year))
      .filter(c => c && c.year === state.year);
  } catch (err) {
    console.warn('[roadmap-plan] initiatives load failed', err);
    state.jiraCards = [];
  }
  applyJiraOverrides();

  // 키워드 카드: LS 가 SoT — 없을 때만 파일에서 시드
  const lsCards = state.cardsStore.get(null);
  if (Array.isArray(lsCards)) {
    state.keywordCards = lsCards.map(normalizeKeywordCard);
  } else {
    try {
      const file = await loadJson(`${state.rootRel}data/plans/roadmap-${state.year}.json`);
      state.keywordCards = (file.cards || []).map(normalizeKeywordCard);
      persistCards();
    } catch (_) {
      state.keywordCards = [];
      persistCards();
    }
  }

  // cardGoals stale 정리 — 존재하지 않는 cardId/goalId 매핑 제거
  const allCardIds = new Set([
    ...state.jiraCards.map(c => c.id),
    ...state.keywordCards.map(c => c.id),
  ]);
  const { cleaned, removed } = cleanCardGoals(state.cardGoals, state.goals, allCardIds);
  if (removed.length) {
    state.cardGoals = cleaned;
    persistCardGoals();
  }
}

function persistGoals() {
  return state.goalsStore.set(state.goals);
}
function persistCardGoals() {
  return state.cardGoalsStore.set(state.cardGoals);
}

/** 카드 ID 로 카드 객체 찾기 (jira + 키워드 통합). */
function findCard(cardId) {
  return state.jiraCards.find(c => c.id === cardId) ||
         state.keywordCards.find(c => c.id === cardId) ||
         null;
}

/** state.jiraOverrides 를 jiraCards.quarter 에 반영 + stale 정리.
 *  override 값 형식: { 'TM-1234': { quarter: 'Q3', jiraQuarter: 'Q2' } }
 *  - card.quarter 를 override.quarter 로 덮어씀
 *  - card.overridden = true (UI 마커용)
 *  - card.jiraQuarter = Jira 원본 quarter (revert / 표시용)
 *  - stale: override 가 있는데 jiraCards 에 해당 ticketKey 가 없으면 LS 에서 삭제
 *  - 또한 Jira 원본 quarter 가 override.quarter 와 같아지면 override 자동 해제
 */
function applyJiraOverrides() {
  const overrides = state.jiraOverrides || {};
  const validKeys = new Set(state.jiraCards.map(c => c.ticketKey));
  let mutated = false;

  // stale 정리
  for (const tk of Object.keys(overrides)) {
    if (!validKeys.has(tk)) { delete overrides[tk]; mutated = true; }
  }

  for (const card of state.jiraCards) {
    const ov = overrides[card.ticketKey];
    if (!ov) continue;
    const jiraQuarter = card.quarter;
    // Jira 가 사용자 위치를 따라잡았으면 override 해제
    if (jiraQuarter === ov.quarter) {
      delete overrides[card.ticketKey];
      mutated = true;
      continue;
    }
    card.jiraQuarter = jiraQuarter;
    card.quarter = ov.quarter;
    card.overridden = true;
  }
  if (mutated) state.overridesStore.set(overrides);
}

function persistOverrides() {
  return state.overridesStore.set(state.jiraOverrides);
}

/** 카드를 LS 에 저장. 실패 시 토스트 안내. */
function persistCards() {
  const ok = state.cardsStore.set(state.keywordCards);
  if (!ok) {
    toast({
      kicker: '저장 실패',
      msg: 'localStorage 에 저장하지 못했습니다 (용량/권한).',
      meta: '메모리에만 보관됩니다. "↓ JSON Export" 로 즉시 백업하세요.',
      kind: 'alert',
      hold: 8000,
    });
  }
  return ok;
}

/** Initiative → 단일 카드. 멀티 yearQuarter 인 경우 preferredYear 에 매칭되는 분기에 위치,
 *  매칭 없으면 첫 분기. 모든 분기는 spans 로 보존 (UI 에 'Q4 ↔ Q1' 같이 표시).
 *  - 빈 yearQuarter: year=preferredYear(또는 currentYear), quarter=null (미배치 pool)
 *  - preferredYear 지정 없으면 첫 분기 그대로
 */
function initiativeToCard(it, preferredYear) {
  if (!it || !it.key) return null;
  const yqs = (Array.isArray(it.yearQuarters) && it.yearQuarters.length
    ? it.yearQuarters
    : (it.yearQuarter ? [it.yearQuarter] : []))
    .filter(Boolean)
    .map(yq => {
      const m = /^(\d{4})-(Q[1-4])$/.exec(yq);
      return m ? { year: Number(m[1]), quarter: m[2], key: m[0] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.year !== b.year ? a.year - b.year : a.quarter.localeCompare(b.quarter));

  let chosen = null;
  if (preferredYear != null) chosen = yqs.find(y => y.year === preferredYear);
  if (!chosen) chosen = yqs[0];

  const year = chosen ? chosen.year : (preferredYear ?? currentYear());
  const quarter = chosen ? chosen.quarter : null;

  return {
    id: 'jira-' + it.key,
    type: 'jira',
    year,
    quarter,                    // null = 미배치
    spans: yqs.map(y => y.key), // 모든 분기 — UI 멀티 표시용
    ticketKey: it.key,
    title: it.summary || '',
    mainSubject: it.mainSubject || '',
    priority: it.priority || '',
    projectKey: it.project || '',
    status: it.status || '',
  };
}

function normalizeKeywordCard(c) {
  return {
    id: c.id || newCardId(),
    type: 'keyword',
    year: Number(c.year) || state.year,
    quarter: c.quarter || null,
    title: c.title || '',
    mainSubject: c.mainSubject || '',
    priority: c.priority || '',
    projectKey: c.projectKey || '',
    ticketKey: c.ticketKey || '',  // optional: 사용자가 직접 연결한 Jira 키
    notes: c.notes || '',
    createdAt: c.createdAt || new Date().toISOString(),
    updatedAt: c.updatedAt || new Date().toISOString(),
  };
}

// 메인주제 그룹 표시 순서 (디자인 시스템 5+ 기준)
const SUBJECT_ORDER = ['01.추천', '02.검색', '03.랭킹', '04.개인화', '05.디스커버리'];
const SUBJECT_UNCATEGORIZED = '(미분류)';

function newCardId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return 'kw-' + crypto.randomUUID();
  }
  // fallback (older browsers): ms timestamp + 8 base36 chars
  return 'kw-' + Date.now().toString(36) + '-' +
    Math.random().toString(36).slice(2, 10);
}

/* ----- 헤더 / 컨트롤 --------------------------------------- */

function renderYearSelect() {
  const sel = document.getElementById('plan-year');
  if (!sel) return;
  sel.value = String(state.year);
  sel.addEventListener('change', async () => {
    state.year = Number(sel.value);
    await loadAll();
    refreshFiltersForValidity();
    renderFilters();
    renderHeader();
    renderBoard();
  });
}

function bindTopActions() {
  const addBtn = document.getElementById('btn-add-kw');
  const exportBtn = document.getElementById('btn-export');
  const addGoalBtn = document.getElementById('btn-add-goal');
  if (addBtn) addBtn.addEventListener('click', () => openCardModal(null));
  if (exportBtn) exportBtn.addEventListener('click', exportJson);
  if (addGoalBtn) addGoalBtn.addEventListener('click', () => openGoalModal(null));
}

function bindGroupToggle() {
  document.querySelectorAll('[data-group-by]').forEach(btn => {
    const updateActive = () => {
      btn.classList.toggle('active', btn.dataset.groupBy === state.groupBy);
    };
    updateActive();
    btn.addEventListener('click', () => {
      state.groupBy = btn.dataset.groupBy;
      scoped(GROUP_KEY).set(state.groupBy);
      document.querySelectorAll('[data-group-by]').forEach(b =>
        b.classList.toggle('active', b.dataset.groupBy === state.groupBy));
      renderBoard();
    });
  });
}

function renderHeader() {
  const lede = document.querySelector('[data-lede]');
  if (!lede) return;
  const total = state.jiraCards.length + state.keywordCards.length;
  const visible = filteredAll();
  const filtered = visible.length !== total;
  const pool = visible.filter(c => !c.quarter).length;
  const filterNote = filtered
    ? ` · <strong class="num accent">${visible.length}</strong>장 표시 중 (필터 적용)`
    : '';
  const goalPart = state.goals.length
    ? ` · 목표 <strong class="num">${state.goals.length}</strong>개`
    : '';
  lede.innerHTML =
    `<strong class="num">${state.year}</strong> 전체 <strong class="num">${total}</strong>장 ` +
    `(Jira <strong class="num">${state.jiraCards.length}</strong> · 키워드 <strong class="num">${state.keywordCards.length}</strong>)` +
    `${goalPart}${filterNote}. 미배치 <strong class="num">${pool}</strong>장.`;
}

/* ----- 필터 ------------------------------------------------ */

/** 현재 카드 풀에 없는 필터 값은 자동 해제 (연도 변경 시 핵심). */
function refreshFiltersForValidity() {
  const all = [...state.jiraCards, ...state.keywordCards];
  const fields = ['mainSubject', 'priority', 'projectKey'];
  const filterToField = { mainSubject: 'mainSubject', priority: 'priority', project: 'projectKey' };
  let changed = false;
  for (const [filter, field] of Object.entries(filterToField)) {
    const v = state.filters[filter];
    if (!v) continue;
    const exists = all.some(c => c[field] === v);
    if (!exists) { state.filters[filter] = null; changed = true; }
  }
  if (changed) {
    scoped(FILTERS_KEY).set(state.filters);
    toast({ kicker: '필터 정리됨', msg: '연도에 없는 필터값은 자동 해제했습니다.' });
  }
}

function renderFilters() {
  const host = document.getElementById('plan-filters');
  if (!host) return;
  const allCards = [...state.jiraCards, ...state.keywordCards];
  const subjects = [...new Set(allCards.map(c => c.mainSubject).filter(Boolean))].sort();
  const priorities = [...new Set(allCards.map(c => c.priority).filter(Boolean))].sort();
  const projects = [...new Set(allCards.map(c => c.projectKey).filter(Boolean))].sort();

  const hasAny = state.filters.mainSubject || state.filters.priority || state.filters.project;
  host.innerHTML = `
    ${chipGroup('mainSubject', '메인주제', subjects, state.filters.mainSubject)}
    ${chipGroup('priority', '우선순위', priorities, state.filters.priority)}
    ${chipGroup('project', '프로젝트', projects, state.filters.project)}
    ${hasAny ? '<button type="button" class="tlink" data-filter-reset>필터 초기화</button>' : ''}
  `;
  host.querySelectorAll('button.fchip').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.filter;
      const v = btn.dataset.value;
      state.filters[f] = state.filters[f] === v ? null : v;
      scoped(FILTERS_KEY).set(state.filters);
      renderFilters();
      renderBoard();
      renderHeader();
    });
  });
  const reset = host.querySelector('[data-filter-reset]');
  if (reset) reset.addEventListener('click', () => {
    state.filters = { mainSubject: null, priority: null, project: null };
    scoped(FILTERS_KEY).set(state.filters);
    renderFilters();
    renderBoard();
    renderHeader();
  });
}

function chipGroup(filterKey, label, options, current) {
  if (!options.length) return '';
  const chips = options.map(opt => {
    const on = current === opt;
    return `<button type="button" class="fchip ${on ? 'on' : ''}" data-filter="${escapeAttr(filterKey)}" data-value="${escapeAttr(opt)}">${escapeHtml(opt)}</button>`;
  }).join('');
  return `<span class="flabel">${escapeHtml(label)}</span>${chips}`;
}

function isFilterActive() {
  return !!(state.filters.mainSubject || state.filters.priority || state.filters.project);
}

function filteredAll() {
  const allCards = [...state.jiraCards, ...state.keywordCards];
  return allCards.filter(c => {
    if (state.filters.mainSubject && c.mainSubject !== state.filters.mainSubject) return false;
    if (state.filters.priority && c.priority !== state.filters.priority) return false;
    if (state.filters.project && c.projectKey !== state.filters.project) return false;
    return true;
  });
}

/* ----- 보드 / 컬럼 / 카드 ---------------------------------- */

function renderBoard() {
  const host = document.getElementById('plan-board');
  if (!host) return;
  const all = filteredAll();
  const pool = all.filter(c => !c.quarter);
  const byQ = q => all.filter(c => c.quarter === q);

  host.innerHTML = '';
  host.appendChild(columnEl('pool', '미배치', pool, { pool: true }));
  QUARTERS.forEach(q => {
    host.appendChild(columnEl(q, `${state.year} · ${q}`, byQ(q), {}));
  });
  if (isFilterActive()) {
    host.classList.add('plan-board-filtered');
  } else {
    host.classList.remove('plan-board-filtered');
  }
  bindDnd(host);
}

function columnEl(colId, label, cards, { pool }) {
  const col = document.createElement('div');
  col.className = 'plan-col' + (pool ? ' pool' : '') + (cards.length === 0 ? ' empty' : '');
  col.dataset.colId = colId;
  col.innerHTML = `
    <div class="plan-col-h">
      <span>${escapeHtml(label)}</span>
      <span class="ct num">${cards.length}</span>
    </div>
    ${cards.length === 0 ? '<div class="plan-col-drop">DROP HERE</div>' : ''}
  `;

  if (state.groupBy === 'subject') {
    // 메인주제별 그룹 헤더 + 그룹 내 카드들
    const groups = groupCardsBySubject(cards);
    for (const [subject, gcards] of groups) {
      const gh = document.createElement('div');
      gh.className = 'plan-group-h';
      gh.dataset.groupSubject = subject;
      gh.innerHTML = `
        <span class="plan-group-name">${escapeHtml(subject)}</span>
        <span class="ct num">${gcards.length}</span>
        <button type="button" class="plan-group-add" title="이 그룹에 카드 추가" aria-label="${escapeAttr(subject)} 그룹에 카드 추가">＋</button>
      `;
      gh.querySelector('.plan-group-add').addEventListener('click', () => {
        openCardModal(null, {
          mainSubject: subject === SUBJECT_UNCATEGORIZED ? '' : subject,
          quarter: pool ? null : colId,
        });
      });
      col.appendChild(gh);
      gcards.forEach(c => col.appendChild(cardEl(c)));
    }
  } else if (state.groupBy === 'goal') {
    // 목표별 그룹 헤더 + 그룹 내 카드들
    const groups = groupCardsByGoal(cards);
    for (const [groupLabel, gcards, goalId] of groups) {
      const gh = document.createElement('div');
      gh.className = 'plan-group-h plan-group-goal';
      gh.dataset.groupGoalId = goalId || '';
      gh.innerHTML = `
        <span class="plan-group-name">🎯 ${escapeHtml(groupLabel)}</span>
        <span class="ct num">${gcards.length}</span>
        ${goalId ? '<button type="button" class="plan-group-add" title="이 목표 그룹에 키워드 카드 추가" aria-label="목표에 카드 추가">＋</button>' : ''}
      `;
      if (goalId) {
        gh.querySelector('.plan-group-add').addEventListener('click', () => {
          // 새 키워드 카드를 이 목표 + 이 분기 로 자동 매핑되게 prefill
          openCardModal(null, { quarter: pool ? null : colId, goalId });
        });
      }
      col.appendChild(gh);
      gcards.forEach(c => col.appendChild(cardEl(c)));
    }
  } else {
    cards.forEach(c => col.appendChild(cardEl(c)));
  }

  // 컬럼 하단 + 카드 추가 (분기 자동 채움)
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'tlink plan-add-btn';
  addBtn.textContent = '＋ 카드 추가';
  addBtn.addEventListener('click', () => {
    openCardModal(null, { quarter: pool ? null : colId });
  });
  col.appendChild(addBtn);
  return col;
}

/** 메인주제별로 카드를 묶음. 디자인 순서(SUBJECT_ORDER) → 그 외 알파벳 → 미분류. */
function groupCardsBySubject(cards) {
  const map = new Map();
  for (const c of cards) {
    const k = c.mainSubject || SUBJECT_UNCATEGORIZED;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(c);
  }
  const orderedKeys = SUBJECT_ORDER.filter(s => map.has(s));
  const otherKeys = [...map.keys()].filter(s =>
    !SUBJECT_ORDER.includes(s) && s !== SUBJECT_UNCATEGORIZED
  ).sort();
  const result = [];
  for (const k of [...orderedKeys, ...otherKeys]) result.push([k, map.get(k)]);
  if (map.has(SUBJECT_UNCATEGORIZED)) result.push([SUBJECT_UNCATEGORIZED, map.get(SUBJECT_UNCATEGORIZED)]);
  return result;
}

/** 목표별 카드 그룹핑.
 *  @returns {Array<[label, cards[], goalId|null]>}  목표 정렬순(sortGoals) + 마지막에 (목표 미지정).
 */
function groupCardsByGoal(cards) {
  const byGoal = new Map();
  const noGoal = [];
  for (const c of cards) {
    const gid = state.cardGoals[c.id];
    if (gid && state.goals.some(g => g.id === gid)) {
      if (!byGoal.has(gid)) byGoal.set(gid, []);
      byGoal.get(gid).push(c);
    } else {
      noGoal.push(c);
    }
  }
  const result = [];
  for (const g of sortGoals(state.goals)) {
    if (byGoal.has(g.id)) result.push([g.title, byGoal.get(g.id), g.id]);
  }
  if (noGoal.length) result.push(['(목표 미지정)', noGoal, null]);
  return result;
}

function cardEl(card) {
  const el = document.createElement('article');
  const sc = SUBJECT_CLASS_MAP[card.mainSubject] || 's-misc';
  el.className = 'plan-card ' + sc + (card.type === 'keyword' ? ' k' : '');
  el.draggable = true;
  el.dataset.cardId = card.id;
  el.dataset.cardType = card.type;
  el.setAttribute('role', 'listitem');
  el.setAttribute('aria-label', card.title || card.ticketKey || '카드');

  const meta = [];
  if (card.type === 'jira') {
    meta.push(jiraKeyHtml(card.ticketKey));
    if (card.overridden) {
      const jq = card.jiraQuarter || '미배치';
      meta.push(`<span class="tag" title="Jira 원본: ${escapeAttr(jq)} — 사용자 위치로 덮어씀">✦ 사용자 위치</span>`);
    }
    // 멀티 분기 표시 — TM-1858 처럼 ['2025-Q4','2026-Q1'] 인 경우
    if (Array.isArray(card.spans) && card.spans.length > 1) {
      const spanLabel = card.spans.join(' ↔ ');
      meta.push(`<span class="tag" title="멀티 분기: ${escapeAttr(spanLabel)}">↔ ${escapeHtml(spanLabel)}</span>`);
    }
  } else if (card.ticketKey) {
    // 사용자가 직접 연결한 Jira 키 (키워드 카드 + 티켓)
    meta.push(jiraKeyHtml(card.ticketKey));
  } else {
    meta.push(`<span class="tag">키워드</span>`);
  }
  if (card.mainSubject) meta.push(`<span>${escapeHtml(card.mainSubject)}</span>`);
  if (card.projectKey) meta.push(`<span>· ${escapeHtml(card.projectKey)}</span>`);
  if (card.priority) {
    const cls = priorityClass(card.priority);
    meta.push(`<span class="pri ${cls}">${escapeHtml(card.priority)}</span>`);
  }
  const goalId = state.cardGoals[card.id];
  if (goalId) {
    const g = state.goals.find(x => x.id === goalId);
    if (g) meta.push(`<span class="tag goal-tag" title="목표: ${escapeAttr(g.title)}">🎯 ${escapeHtml(g.title)}</span>`);
  }

  el.innerHTML = `
    <h5>${escapeHtml(card.title || '(제목 없음)')}</h5>
    <div class="pc-meta">${meta.join(' ')}</div>
    ${card.notes ? `<div class="pc-notes">${escapeHtml(card.notes)}</div>` : ''}
    ${card.type === 'keyword'
      ? `<div class="pc-actions">
           <button type="button" class="tlink" data-action="edit">편집</button>
           <button type="button" class="tlink alert-color" data-action="delete">삭제</button>
         </div>`
      : ''}
  `;

  if (card.type === 'keyword') {
    el.querySelector('[data-action="edit"]').addEventListener('click', e => {
      e.stopPropagation();
      openCardModal(card);
    });
    el.querySelector('[data-action="delete"]').addEventListener('click', e => {
      e.stopPropagation();
      confirmDelete(card);
    });
  }
  return el;
}

function priorityClass(p) {
  const norm = String(p || '').toUpperCase();
  if (norm === 'P0') return 'pri-p0';
  if (norm === 'P1') return 'pri-p1';
  if (norm === 'P2') return 'pri-p2';
  if (norm === 'P3') return 'pri-p3';
  return '';
}

/* ----- D&D ------------------------------------------------- */

function bindDnd(boardEl) {
  let dragId = null;
  boardEl.addEventListener('dragstart', e => {
    // 필터 활성 시 D&D 비활성화 (리뷰 Critical #3 — 보이지 않는 카드가 잘못된 분기로 이동 방지)
    if (isFilterActive()) {
      e.preventDefault();
      toast({
        kicker: '필터 활성',
        msg: '카드 이동은 필터 해제 후 가능합니다.',
        meta: '필터 상태에서 이동하면 숨겨진 카드 위치가 의도와 다르게 바뀔 수 있습니다.',
        kind: 'alert',
      });
      return;
    }
    const card = e.target.closest('.plan-card');
    if (!card || !card.draggable) { e.preventDefault(); return; }
    dragId = card.dataset.cardId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    card.classList.add('dragging');
  });
  boardEl.addEventListener('dragend', e => {
    const card = e.target.closest('.plan-card');
    if (card) card.classList.remove('dragging');
    boardEl.querySelectorAll('.plan-col.drag-over').forEach(c => c.classList.remove('drag-over'));
    dragId = null;
  });
  boardEl.addEventListener('dragover', e => {
    const col = e.target.closest('.plan-col');
    if (!col) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    boardEl.querySelectorAll('.plan-col.drag-over').forEach(c => {
      if (c !== col) c.classList.remove('drag-over');
    });
    col.classList.add('drag-over');
  });
  boardEl.addEventListener('dragleave', e => {
    const col = e.target.closest('.plan-col');
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('drag-over');
  });
  boardEl.addEventListener('drop', e => {
    const col = e.target.closest('.plan-col');
    if (!col || !dragId) return;
    e.preventDefault();
    col.classList.remove('drag-over');
    moveCard(dragId, col.dataset.colId);
  });
}

function moveCard(cardId, colId) {
  // dragId 검증 — 외부 payload 위변조 / 필터 외 카드 방어
  const known = state.jiraCards.find(c => c.id === cardId)
              || state.keywordCards.find(c => c.id === cardId);
  if (!known) {
    toast({ kicker: '무효', msg: '알 수 없는 카드입니다.', kind: 'alert' });
    return;
  }
  const targetQuarter = colId === 'pool' ? null : colId;

  // Jira 카드 — LS override 우선. Jira 원본은 건드리지 않음.
  if (known.type === 'jira') {
    if (known.quarter === targetQuarter) return;
    const jiraQuarter = known.jiraQuarter ?? known.quarter; // override 안 된 카드면 현재 quarter 가 jira 원본
    known.quarter = targetQuarter;
    if (jiraQuarter === targetQuarter) {
      // 사용자가 Jira 원본 위치로 되돌림 → override 해제
      delete state.jiraOverrides[known.ticketKey];
      known.overridden = false;
      delete known.jiraQuarter;
    } else {
      state.jiraOverrides[known.ticketKey] = { quarter: targetQuarter, jiraQuarter };
      known.overridden = true;
      known.jiraQuarter = jiraQuarter;
    }
    persistOverrides();
    toast({
      kicker: '위치 저장',
      msg: `${known.ticketKey} → ${targetQuarter || '미배치'}`,
      meta: known.overridden ? `Jira 원본: ${jiraQuarter || '미배치'} (다음 sync 후에도 사용자 위치 유지)` : '',
      kind: 'success',
    });
    renderBoard();
    renderHeader();
    return;
  }

  // 키워드 카드 — LS 갱신
  if (known.quarter === targetQuarter) return;
  known.quarter = targetQuarter;
  known.updatedAt = new Date().toISOString();
  persistCards();
  toast({ kicker: '저장됨', msg: `${known.title} → ${targetQuarter || '미배치'}`, kind: 'success' });
  renderBoard();
  renderHeader();
}

/* ----- 카드 모달 (추가 / 편집) ----------------------------- */

let cardModalEl = null;
let cardModalCtl = null;

function openCardModal(card, prefill = {}) {
  ensureCardModal();
  const isEdit = !!card;
  cardModalEl.querySelector('[data-modal-kicker]').textContent = isEdit ? 'EDIT' : 'NEW CARD';
  cardModalEl.querySelector('[data-modal-title]').textContent = isEdit ? '카드 편집' : '카드 추가';

  // 목표 select 옵션은 현재 state.goals 기준으로 매번 재구성
  refreshCardModalGoalOptions();

  const f = cardModalEl.querySelector('form');
  f.elements.title.value = card?.title || '';
  f.elements.notes.value = card?.notes || '';
  f.elements.mainSubject.value = card?.mainSubject ?? prefill.mainSubject ?? '';
  f.elements.priority.value = card?.priority || '';
  f.elements.projectKey.value = card?.projectKey || '';
  f.elements.ticketKey.value = card?.ticketKey || '';
  f.elements.quarter.value = card?.quarter ?? prefill.quarter ?? '';
  f.elements.goalId.value = (card && state.cardGoals[card.id]) || prefill.goalId || '';
  f.dataset.editingId = card?.id || '';

  cardModalCtl.open();
}

function refreshCardModalGoalOptions() {
  const sel = cardModalEl?.querySelector('select[name="goalId"]');
  if (!sel) return;
  const sorted = sortGoals(state.goals);
  sel.innerHTML = '<option value="">— (없음)</option>' +
    sorted.map(g => `<option value="${escapeAttr(g.id)}">${escapeHtml(g.title)}</option>`).join('');
}

function ensureCardModal() {
  if (cardModalEl) return;
  cardModalEl = document.createElement('div');
  cardModalEl.className = 'modal-backdrop';
  cardModalEl.hidden = true;
  cardModalEl.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="plan-modal-title" style="width:520px">
      <form>
        <div class="modal-head">
          <div>
            <div class="modal-kicker" data-modal-kicker></div>
            <h3 class="modal-title" id="plan-modal-title" data-modal-title></h3>
          </div>
          <button type="button" class="modal-close" data-modal-close aria-label="닫기">CLOSE</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label class="field-label" for="kw-title">제목</label>
            <input class="input" id="kw-title" name="title" required maxlength="120" />
          </div>
          <div class="field">
            <label class="field-label" for="kw-notes">메모</label>
            <textarea class="textarea" id="kw-notes" name="notes" maxlength="500"></textarea>
          </div>
          <div class="field-row">
            <div class="field">
              <label class="field-label" for="kw-subject">메인주제</label>
              <select class="select" id="kw-subject" name="mainSubject">
                <option value="">—</option>
                <option value="01.추천">01.추천</option>
                <option value="02.검색">02.검색</option>
                <option value="03.랭킹">03.랭킹</option>
                <option value="04.개인화">04.개인화</option>
                <option value="05.디스커버리">05.디스커버리</option>
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="kw-priority">우선순위</label>
              <select class="select" id="kw-priority" name="priority">
                <option value="">—</option>
                <option value="P0">P0</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
              </select>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label class="field-label" for="kw-project">프로젝트 키</label>
              <input class="input" id="kw-project" name="projectKey" maxlength="12" placeholder="CBP" pattern="[A-Z][A-Z0-9]{1,11}" title="대문자로 시작 + 영숫자 2~12자" />
            </div>
            <div class="field">
              <label class="field-label" for="kw-ticket">티켓 키 (선택)</label>
              <input class="input" id="kw-ticket" name="ticketKey" maxlength="20" placeholder="TM-1234" pattern="[A-Z][A-Z0-9]{1,11}-[0-9]+" title="예: CBP-1234 — 비우면 키워드 전용" />
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label class="field-label" for="kw-quarter">분기</label>
              <select class="select" id="kw-quarter" name="quarter">
                <option value="">미배치</option>
                <option value="Q1">Q1</option>
                <option value="Q2">Q2</option>
                <option value="Q3">Q3</option>
                <option value="Q4">Q4</option>
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="kw-goal">🎯 목표 (선택)</label>
              <select class="select" id="kw-goal" name="goalId">
                <option value="">— (없음)</option>
              </select>
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn ghost" data-modal-close>취소</button>
          <button type="submit" class="btn primary">저장</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(cardModalEl);
  cardModalCtl = attachModal(cardModalEl, {
    initialFocus: () => cardModalEl.querySelector('input[name="title"]'),
  });
  cardModalEl.querySelector('form').addEventListener('submit', e => {
    e.preventDefault();
    saveCardFromForm(e.currentTarget);
  });
}

function saveCardFromForm(form) {
  const id = form.dataset.editingId;
  const now = new Date().toISOString();
  const projectKeyRaw = form.elements.projectKey.value.trim().toUpperCase();
  if (projectKeyRaw && !PROJECT_KEY_RE.test(projectKeyRaw)) {
    toast({ kicker: '형식 오류', msg: '프로젝트 키는 대문자 영숫자 2~12자여야 합니다.', kind: 'alert' });
    return;
  }
  const ticketKeyRaw = form.elements.ticketKey.value.trim().toUpperCase();
  if (ticketKeyRaw && !/^[A-Z][A-Z0-9]{1,11}-[0-9]+$/.test(ticketKeyRaw)) {
    toast({ kicker: '형식 오류', msg: '티켓 키는 PROJ-숫자 형식이어야 합니다 (예: TM-1234).', kind: 'alert' });
    return;
  }
  // ticketKey 가 있으면 projectKey 자동 채움 (없을 때만)
  let projectKey = projectKeyRaw;
  if (ticketKeyRaw && !projectKey) projectKey = ticketKeyRaw.split('-', 1)[0];

  const data = {
    title: form.elements.title.value.trim(),
    notes: form.elements.notes.value.trim(),
    mainSubject: form.elements.mainSubject.value,
    priority: form.elements.priority.value,
    projectKey,
    ticketKey: ticketKeyRaw,
    quarter: form.elements.quarter.value || null,
  };
  if (!data.title) {
    toast({ kicker: '입력 필요', msg: '제목은 비울 수 없습니다.', kind: 'alert' });
    return;
  }
  let savedCardId = id;
  if (id) {
    const i = state.keywordCards.findIndex(c => c.id === id);
    if (i >= 0) {
      state.keywordCards[i] = { ...state.keywordCards[i], ...data, updatedAt: now };
      toast({ kicker: '저장됨', msg: data.title, kind: 'success' });
    }
  } else {
    const newId = newCardId();
    state.keywordCards.push(normalizeKeywordCard({
      ...data,
      id: newId,
      year: state.year,
      createdAt: now,
      updatedAt: now,
    }));
    savedCardId = newId;
    toast({ kicker: '추가됨', msg: data.title, kind: 'success' });
  }
  persistCards();

  // 목표 매핑 갱신 (1:N 정책)
  const goalIdVal = form.elements.goalId.value || '';
  const prevGoal = state.cardGoals[savedCardId];
  if (goalIdVal && state.goals.some(g => g.id === goalIdVal)) {
    state.cardGoals[savedCardId] = goalIdVal;
  } else {
    delete state.cardGoals[savedCardId];
  }
  if (prevGoal !== state.cardGoals[savedCardId]) {
    persistCardGoals();
    renderGoalBoard();
  }

  cardModalCtl.close();
  renderFilters();
  renderBoard();
  renderHeader();
}

/* ----- 삭제 확인 ------------------------------------------- */

let confirmEl = null;
let confirmCtl = null;

function confirmDelete(card) {
  ensureConfirmModal();
  confirmEl.querySelector('[data-modal-title]').textContent = '삭제 확인';
  confirmEl.querySelector('[data-modal-body]').innerHTML =
    `정말 <strong>${escapeHtml(card.title || '(제목 없음)')}</strong> 카드를 삭제할까요? 되돌릴 수 없습니다.`;
  confirmCtl.open();
  confirmEl.querySelector('[data-confirm-yes]').onclick = () => {
    state.keywordCards = state.keywordCards.filter(c => c.id !== card.id);
    persistCards();
    // 카드 삭제 시 목표 매핑도 해제
    if (state.cardGoals[card.id]) {
      delete state.cardGoals[card.id];
      persistCardGoals();
      renderGoalBoard();
    }
    toast({ kicker: '삭제됨', msg: card.title || '(제목 없음)' });
    confirmCtl.close();
    renderFilters();
    renderBoard();
    renderHeader();
  };
}

function ensureConfirmModal() {
  if (confirmEl) return;
  confirmEl = document.createElement('div');
  confirmEl.className = 'modal-backdrop';
  confirmEl.hidden = true;
  confirmEl.innerHTML = `
    <div class="modal confirm danger" role="alertdialog" aria-modal="true" aria-labelledby="plan-confirm-title">
      <div class="modal-head">
        <div>
          <div class="modal-kicker">DELETE</div>
          <h3 class="modal-title" id="plan-confirm-title" data-modal-title>삭제 확인</h3>
        </div>
        <button type="button" class="modal-close" data-modal-close aria-label="닫기">CLOSE</button>
      </div>
      <div class="modal-body" data-modal-body></div>
      <div class="modal-foot">
        <button type="button" class="btn ghost" data-modal-close>취소</button>
        <button type="button" class="btn primary" data-confirm-yes>삭제</button>
      </div>
    </div>
  `;
  document.body.appendChild(confirmEl);
  confirmCtl = attachModal(confirmEl, {
    initialFocus: () => confirmEl.querySelector('[data-confirm-yes]'),
  });
}

/* ----- Export --------------------------------------------- */

/** git diff 안정성 위해 결정적 정렬 후 직렬화. */
export function sortCards(cards) {
  const qOrder = { 'Q1': 1, 'Q2': 2, 'Q3': 3, 'Q4': 4 };
  const pOrder = { 'P0': 0, 'P1': 1, 'P2': 2, 'P3': 3 };
  return [...cards].sort((a, b) => {
    const qa = a.quarter == null ? 9 : (qOrder[a.quarter] || 8);
    const qb = b.quarter == null ? 9 : (qOrder[b.quarter] || 8);
    if (qa !== qb) return qa - qb;
    const pa = pOrder[a.priority] != null ? pOrder[a.priority] : 9;
    const pb = pOrder[b.priority] != null ? pOrder[b.priority] : 9;
    if (pa !== pb) return pa - pb;
    return String(a.id).localeCompare(String(b.id));
  });
}

function exportJson() {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    year: state.year,
    cards: sortCards(state.keywordCards),
    goals: sortGoals(state.goals),
    cardGoals: state.cardGoals,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `roadmap-${state.year}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast({
    kicker: 'EXPORTED',
    msg: `roadmap-${state.year}.json`,
    meta: `data/plans/ 에 commit 하면 영구 저장됩니다.`,
    kind: 'success',
    hold: 6000,
  });
}

/* =========================================================
   목표 (Goal) — 보드 / 모달 / 카드 매핑
   ========================================================= */

function renderGoalBoard() {
  const host = document.getElementById('goal-board');
  if (!host) return;
  // state.goals 가 사용자가 정한 순서. sortGoals 는 order 필드 기준 정렬.
  const sorted = sortGoals(state.goals);
  if (!sorted.length) {
    host.innerHTML = `
      <div class="goal-empty">
        <span class="goal-empty-icon">🎯</span>
        <span class="goal-empty-msg">아직 등록된 목표가 없습니다.</span>
        <button type="button" class="btn ghost" data-goal-add-here>＋ 첫 목표 추가</button>
      </div>
    `;
    host.querySelector('[data-goal-add-here]')?.addEventListener('click', () => openGoalModal(null));
    return;
  }
  const cardsByGoal = invertCardGoals(state.cardGoals);
  host.innerHTML = '';
  for (const g of sorted) {
    const cardIds = cardsByGoal.get(g.id) || [];
    host.appendChild(goalCardEl(g, cardIds));
  }
  bindGoalDnd(host);
}

/** 목표 카드 드래그앤드롭 — 순서 재배열 + state.goals 의 order 필드 갱신 + persist. */
function bindGoalDnd(host) {
  let draggedId = null;
  host.querySelectorAll('.goal-card').forEach(card => {
    card.draggable = true;
    card.addEventListener('dragstart', e => {
      // 액션 버튼 / 카드 리스트 안에서 시작된 드래그는 양보
      if (e.target.closest('.gc-actions, .goal-card-list, .gcli-unmap, a, button')) {
        e.preventDefault();
        return;
      }
      draggedId = card.dataset.goalId;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedId);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      host.querySelectorAll('.goal-card.drag-over').forEach(c => c.classList.remove('drag-over'));
      draggedId = null;
    });
    card.addEventListener('dragover', e => {
      if (!draggedId || card.dataset.goalId === draggedId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      // 다른 카드의 over 표시 제거
      host.querySelectorAll('.goal-card.drag-over').forEach(c => {
        if (c !== card) c.classList.remove('drag-over');
      });
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', e => {
      if (!card.contains(e.relatedTarget)) card.classList.remove('drag-over');
    });
    card.addEventListener('drop', e => {
      const targetId = card.dataset.goalId;
      if (!draggedId || targetId === draggedId) return;
      e.preventDefault();
      moveGoal(draggedId, targetId);
    });
  });
}

function moveGoal(draggedId, targetId) {
  const sorted = sortGoals(state.goals);
  const fromIdx = sorted.findIndex(g => g.id === draggedId);
  const toIdx = sorted.findIndex(g => g.id === targetId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
  const [moved] = sorted.splice(fromIdx, 1);
  sorted.splice(toIdx, 0, moved);
  reassignOrder(sorted);
  // state.goals 의 객체 참조를 update (sortGoals 가 shallow copy 라 원본 객체에 order 만 들어가 있음 — 그대로 OK)
  persistGoals();
  toast({ kicker: '순서 변경', msg: `${moved.title}`, kind: 'success' });
  renderGoalBoard();
}

function goalCardEl(goal, cardIds) {
  const el = document.createElement('article');
  el.className = 'goal-card';
  el.dataset.goalId = goal.id;
  el.dataset.color = goal.color || 'accent';
  const periodOk = isValidPeriod(goal.startMonth, goal.endMonth);
  const period = periodOk ? fmtPeriod(goal) : '<span class="muted">기간 미설정</span>';
  const validCards = cardIds.map(id => findCard(id)).filter(Boolean);

  // 매핑 카드 리스트 렌더
  let cardListHtml = '';
  if (validCards.length) {
    cardListHtml = `
      <ul class="goal-card-list">
        ${validCards.map(c => {
          const isJira = c.type === 'jira';
          const typeTag = isJira ? 'Jira' : '키워드';
          const keyHtml = c.ticketKey
            ? `<a class="key" href="${jiraUrl(c.ticketKey) || '#'}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.ticketKey)}</a>`
            : `<span class="tag">${typeTag}</span>`;
          const quarter = c.quarter ? `<span class="muted">· ${escapeHtml(c.quarter)}</span>` : '';
          const subject = c.mainSubject ? `<span class="muted">· ${escapeHtml(c.mainSubject)}</span>` : '';
          return `
            <li class="goal-card-list-item" data-card-id="${escapeAttr(c.id)}">
              <span class="gcli-key">${keyHtml}</span>
              <span class="gcli-title">${escapeHtml(c.title || '(제목 없음)')}</span>
              <span class="gcli-meta">${quarter}${subject}</span>
              <button type="button" class="tlink alert-color gcli-unmap" data-card-id="${escapeAttr(c.id)}" title="이 목표에서 해제">✕</button>
            </li>
          `;
        }).join('')}
      </ul>
    `;
  } else {
    cardListHtml = '<p class="goal-card-empty muted">아직 매핑된 카드가 없습니다.</p>';
  }

  el.innerHTML = `
    <div class="goal-card-head">
      <h4 class="goal-card-title">${escapeHtml(goal.title || '(제목 없음)')}</h4>
      <span class="goal-card-period">${period}</span>
    </div>
    ${goal.description ? `<p class="goal-card-desc">${escapeHtml(goal.description)}</p>` : ''}
    ${cardListHtml}
    <div class="goal-card-foot">
      <span class="num">${validCards.length}건 매핑</span>
      <span class="gc-actions">
        <button type="button" class="tlink" data-action="map">＋ 카드</button>
        <button type="button" class="tlink" data-action="edit">편집</button>
        <button type="button" class="tlink alert-color" data-action="delete">삭제</button>
      </span>
    </div>
  `;
  el.querySelector('[data-action="map"]').addEventListener('click', e => {
    e.stopPropagation();
    openCardMappingModal(goal);
  });
  el.querySelector('[data-action="edit"]').addEventListener('click', e => {
    e.stopPropagation();
    openGoalModal(goal);
  });
  el.querySelector('[data-action="delete"]').addEventListener('click', e => {
    e.stopPropagation();
    confirmDeleteGoal(goal);
  });
  // 개별 카드 unmap 버튼
  el.querySelectorAll('.gcli-unmap').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const cid = btn.dataset.cardId;
      if (state.cardGoals[cid]) {
        delete state.cardGoals[cid];
        persistCardGoals();
        renderGoalBoard();
        renderBoard();
        toast({ kicker: '매핑 해제', msg: findCard(cid)?.title || cid, kind: 'success' });
      }
    });
  });
  return el;
}

/* ----- 목표 추가/편집 모달 ----- */

let goalModalEl = null;
let goalModalCtl = null;

function openGoalModal(goal) {
  ensureGoalModal();
  const isEdit = !!goal;
  goalModalEl.querySelector('[data-modal-kicker]').textContent = isEdit ? 'EDIT GOAL' : 'NEW GOAL';
  goalModalEl.querySelector('[data-modal-title]').textContent = isEdit ? '목표 편집' : '목표 추가';
  const f = goalModalEl.querySelector('form');
  f.elements.title.value = goal?.title || '';
  f.elements.description.value = goal?.description || '';
  f.elements.startMonth.value = goal?.startMonth || '';
  f.elements.endMonth.value = goal?.endMonth || '';
  // 색상: 현재 선택된 swatch 표시
  const currentColor = goal?.color || 'accent';
  goalModalEl.querySelectorAll('[data-color-swatch]').forEach(b => {
    b.classList.toggle('on', b.dataset.colorSwatch === currentColor);
  });
  f.dataset.color = currentColor;
  f.dataset.editingId = goal?.id || '';
  goalModalCtl.open();
}

function ensureGoalModal() {
  if (goalModalEl) return;
  goalModalEl = document.createElement('div');
  goalModalEl.className = 'modal-backdrop';
  goalModalEl.hidden = true;
  const months = buildMonthOptions();
  goalModalEl.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="goal-modal-title" style="width:520px">
      <form>
        <div class="modal-head">
          <div>
            <div class="modal-kicker" data-modal-kicker></div>
            <h3 class="modal-title" id="goal-modal-title" data-modal-title></h3>
          </div>
          <button type="button" class="modal-close" data-modal-close aria-label="닫기">CLOSE</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label class="field-label" for="goal-title">제목</label>
            <input class="input" id="goal-title" name="title" required maxlength="80" placeholder="예: 브랜드 탐색 강화" />
          </div>
          <div class="field">
            <label class="field-label" for="goal-desc">설명 (선택)</label>
            <textarea class="textarea" id="goal-desc" name="description" maxlength="500"></textarea>
          </div>
          <div class="field-row">
            <div class="field">
              <label class="field-label" for="goal-start">시작월</label>
              <select class="select" id="goal-start" name="startMonth" required>
                <option value="">선택</option>
                ${months}
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="goal-end">끝월</label>
              <select class="select" id="goal-end" name="endMonth" required>
                <option value="">선택</option>
                ${months}
              </select>
            </div>
          </div>
          <div class="field">
            <label class="field-label">색상</label>
            <div class="color-swatches">
              ${GOAL_COLORS.map(c => `
                <button type="button" class="color-swatch" data-color-swatch="${c.key}"
                        style="background: var(${c.var})" aria-label="${c.label}" title="${c.label}"></button>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn ghost" data-modal-close>취소</button>
          <button type="submit" class="btn primary">저장</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(goalModalEl);
  goalModalCtl = attachModal(goalModalEl, {
    initialFocus: () => goalModalEl.querySelector('input[name="title"]'),
  });
  goalModalEl.querySelector('form').addEventListener('submit', e => {
    e.preventDefault();
    saveGoalFromForm(e.currentTarget);
  });
  // 색상 swatch 클릭
  goalModalEl.querySelectorAll('[data-color-swatch]').forEach(b => {
    b.addEventListener('click', () => {
      const f = goalModalEl.querySelector('form');
      f.dataset.color = b.dataset.colorSwatch;
      goalModalEl.querySelectorAll('[data-color-swatch]').forEach(x => x.classList.toggle('on', x === b));
    });
  });
}

/** 이전/올해/내년 ±1 → 36개월. YYYY-MM 포맷. */
function buildMonthOptions() {
  const opts = [];
  const baseYear = state.year - 1;
  for (let y = baseYear; y <= baseYear + 2; y++) {
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      const v = `${y}-${mm}`;
      opts.push(`<option value="${v}">${y}.${mm}</option>`);
    }
  }
  return opts.join('');
}

function saveGoalFromForm(form) {
  const id = form.dataset.editingId;
  const title = form.elements.title.value.trim();
  const description = form.elements.description.value.trim();
  const startMonth = form.elements.startMonth.value;
  const endMonth = form.elements.endMonth.value;
  const color = form.dataset.color || 'accent';
  if (!title) {
    toast({ kicker: '입력 필요', msg: '제목은 비울 수 없습니다.', kind: 'alert' });
    return;
  }
  if (!isValidPeriod(startMonth, endMonth)) {
    toast({ kicker: '기간 오류', msg: '시작월 ≤ 끝월 이어야 합니다.', kind: 'alert' });
    return;
  }
  const now = new Date().toISOString();
  if (id) {
    const i = state.goals.findIndex(g => g.id === id);
    if (i >= 0) {
      state.goals[i] = { ...state.goals[i], title, description, startMonth, endMonth, color, updatedAt: now };
      toast({ kicker: '저장됨', msg: title, kind: 'success' });
    }
  } else {
    state.goals.push(normalizeGoal({
      id: newGoalId(),
      title, description, startMonth, endMonth, color,
      createdAt: now, updatedAt: now,
    }));
    toast({ kicker: '추가됨', msg: title, kind: 'success' });
  }
  persistGoals();
  goalModalCtl.close();
  renderGoalBoard();
  renderHeader();
  renderBoard(); // 카드의 목표 표시 갱신
}

/* ----- 목표 삭제 ----- */

function confirmDeleteGoal(goal) {
  ensureConfirmModal();
  const cardCount = Object.values(state.cardGoals).filter(gid => gid === goal.id).length;
  confirmEl.querySelector('[data-modal-title]').textContent = '목표 삭제';
  confirmEl.querySelector('[data-modal-body]').innerHTML =
    `정말 <strong>${escapeHtml(goal.title || '(제목 없음)')}</strong> 목표를 삭제할까요?` +
    (cardCount > 0 ? `<br><span class="muted">${cardCount}건의 카드 매핑도 함께 해제됩니다.</span>` : '') +
    `<br>되돌릴 수 없습니다.`;
  confirmCtl.open();
  confirmEl.querySelector('[data-confirm-yes]').onclick = () => {
    state.goals = state.goals.filter(g => g.id !== goal.id);
    // 관련 카드 매핑 해제
    for (const cid of Object.keys(state.cardGoals)) {
      if (state.cardGoals[cid] === goal.id) delete state.cardGoals[cid];
    }
    persistGoals();
    persistCardGoals();
    toast({ kicker: '삭제됨', msg: goal.title || '(제목 없음)' });
    confirmCtl.close();
    renderGoalBoard();
    renderHeader();
    renderBoard();
  };
}

/* ----- 카드 매핑 sub-modal ----- */

let mappingModalEl = null;
let mappingModalCtl = null;
let mappingState = { goalId: null, query: '', selected: new Set() };

function openCardMappingModal(goal) {
  ensureMappingModal();
  mappingState.goalId = goal.id;
  mappingState.query = '';
  // 현재 이 목표에 매핑된 카드 = checked 초기값
  mappingState.selected = new Set(
    Object.entries(state.cardGoals)
      .filter(([_, gid]) => gid === goal.id)
      .map(([cid]) => cid)
  );
  mappingModalEl.querySelector('[data-mapping-goal-title]').textContent = goal.title || '(제목 없음)';
  mappingModalEl.querySelector('[data-mapping-search]').value = '';
  renderMappingList();
  mappingModalCtl.open();
}

function ensureMappingModal() {
  if (mappingModalEl) return;
  mappingModalEl = document.createElement('div');
  mappingModalEl.className = 'modal-backdrop';
  mappingModalEl.hidden = true;
  mappingModalEl.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="mapping-modal-title" style="width:640px">
      <div class="modal-head">
        <div>
          <div class="modal-kicker">CARD MAPPING</div>
          <h3 class="modal-title" id="mapping-modal-title">
            카드 매핑 · <span class="accent" data-mapping-goal-title></span>
          </h3>
        </div>
        <button type="button" class="modal-close" data-modal-close aria-label="닫기">CLOSE</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <input class="input" type="search" placeholder="카드 검색 (제목 / Jira 키)" data-mapping-search />
        </div>
        <small class="muted">한 카드는 하나의 목표에만 속할 수 있습니다. 체크 시 다른 목표 매핑은 자동으로 옮겨집니다.</small>
        <div class="mapping-list" data-mapping-list></div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn ghost" data-modal-close>취소</button>
        <button type="button" class="btn primary" data-mapping-save>저장</button>
      </div>
    </div>
  `;
  document.body.appendChild(mappingModalEl);
  mappingModalCtl = attachModal(mappingModalEl, {
    initialFocus: () => mappingModalEl.querySelector('[data-mapping-search]'),
  });
  mappingModalEl.querySelector('[data-mapping-search]').addEventListener('input', e => {
    mappingState.query = e.target.value.trim().toLowerCase();
    renderMappingList();
  });
  mappingModalEl.querySelector('[data-mapping-save]').addEventListener('click', saveMapping);
}

function renderMappingList() {
  const list = mappingModalEl.querySelector('[data-mapping-list]');
  const q = mappingState.query;
  const cards = [...state.jiraCards, ...state.keywordCards]
    .filter(c => {
      if (!q) return true;
      const hay = `${c.ticketKey || ''} ${c.title || ''}`.toLowerCase();
      return hay.includes(q);
    })
    .slice(0, 200);
  if (!cards.length) {
    list.innerHTML = '<div class="muted" style="padding:20px;text-align:center">매칭되는 카드가 없습니다.</div>';
    return;
  }
  list.innerHTML = cards.map(c => {
    const otherGoalId = state.cardGoals[c.id];
    const otherGoal = otherGoalId && otherGoalId !== mappingState.goalId
      ? state.goals.find(g => g.id === otherGoalId) : null;
    const checked = mappingState.selected.has(c.id);
    const typeTag = c.type === 'jira' ? 'Jira' : '키워드';
    return `
      <label class="mapping-row${checked ? ' on' : ''}">
        <input type="checkbox" data-card-id="${escapeAttr(c.id)}" ${checked ? 'checked' : ''} />
        <span class="mapping-row-main">
          <span class="mapping-row-title">${escapeHtml(c.title || '(제목 없음)')}</span>
          <span class="mapping-row-meta">
            <span class="tag">${typeTag}</span>
            ${c.ticketKey ? `<span class="num">${escapeHtml(c.ticketKey)}</span>` : ''}
            ${c.mainSubject ? `<span class="muted">· ${escapeHtml(c.mainSubject)}</span>` : ''}
            ${otherGoal ? `<span class="muted">· 현재: ${escapeHtml(otherGoal.title)}</span>` : ''}
          </span>
        </span>
      </label>
    `;
  }).join('');
  list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.cardId;
      if (cb.checked) mappingState.selected.add(id); else mappingState.selected.delete(id);
      cb.closest('.mapping-row').classList.toggle('on', cb.checked);
    });
  });
}

function saveMapping() {
  const gid = mappingState.goalId;
  // 이 목표에 속해 있던 기존 매핑 모두 제거
  for (const cid of Object.keys(state.cardGoals)) {
    if (state.cardGoals[cid] === gid) delete state.cardGoals[cid];
  }
  // 선택된 카드들을 이 목표로 매핑 (다른 목표 매핑은 덮어씀 — 1:N 정책)
  for (const cid of mappingState.selected) {
    state.cardGoals[cid] = gid;
  }
  persistCardGoals();
  toast({ kicker: '매핑 저장', msg: `${mappingState.selected.size}건` , kind: 'success' });
  mappingModalCtl.close();
  renderGoalBoard();
  renderBoard();
}

/* ----- helpers --------------------------------------------- */

function currentYear(now = new Date()) {
  return now.getFullYear();
}

/* test export */
export const _internal = {
  initiativeToCard,
  normalizeKeywordCard,
  priorityClass,
  SUBJECT_CLASS_MAP,
  SCHEMA_VERSION,
  PROJECT_KEY_RE,
  sortCards,
  applyJiraOverrides,
  _state: state,
};
