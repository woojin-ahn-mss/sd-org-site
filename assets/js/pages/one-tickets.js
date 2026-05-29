/* =========================================================
   pages/one-tickets.js — One 티켓 관리
   ETR / MSSCXTF / FT / TM / CBP / PBO 의 'one' 라벨 티켓을 한 화면에서 관리.

   - 읽기 데이터: data/jira/one-tickets.json (없으면 기존 파일 union fallback)
   - 연결 티켓(Blocks 제외)은 union-find 로 한 묶음 병합 + 펼침으로 "하나로" 관리
   - 뷰: 전체 리스트 / Main Subject 그룹(번호 오름차순)
   - 필터: 프로젝트 / Sub Subject / 우선순위 / 상태 + 론치완료 제외 토글 (localStorage UI state)
   - 편집 데이터(코멘트·수동순위): Supabase one_ticket_meta 테이블 (로그인 시)
   ========================================================= */

import { loadJson } from '../fetch-data.js';
import { showError, showLoading, emptyHtml } from '../states.js';
import { jiraKeyHtml } from '../jira-link.js';
import { fmtDate } from '../format.js';
import { STATUS_GROUPS, statusGroup } from '../charts.js';
import { scoped } from '../storage.js';
import { escapeHtml, escapeAttr } from '../escape.js';
import { toast } from '../toast.js';
import { auth, AuthRequiredError, subscribe } from '../api/supabase.js';
import {
  loadOneMeta, metaByKey, upsertOneMeta,
} from '../api/one-ticket-meta.js';

const TOP_PROJECTS = ['ETR', 'MSSCXTF', 'FT', 'TM', 'CBP', 'PBO', 'MSS'];
const PAGE_SIZE = 25;
const NO_SUBJECT = '(미지정)';
const FILTERS_KEY = 'oneTickets.filters';
const VIEW_KEY = 'oneTickets.view';

const $ = (id) => document.getElementById(id);

const state = {
  rootRel: '',
  items: [],          // 정규화된 one 티켓 전체 (linkedTickets 포함)
  itemsByKey: new Map(),
  clusterMembers: new Map(),
  topLevel: [],       // dedup 된 top-level (ETR + 비연결)
  signedIn: false,
  email: null,
  meta: new Map(),    // jira_key → {manual_rank, comment, _rowNum}
  metaRows: [],       // loadOneMeta 원본 (upsert 시 _rowNum 탐색)
  filters: { project: null, label: null, status: null, priority: null, subSubject: null, hideLaunched: true },
  hideManageMode: false,   // 숨김 관리 모드 (체크박스 노출 + 전체 표시)
  hidePending: new Map(),  // 관리 모드 중 변경 대기 (key → bool)
  hideSaving: false,       // 저장 진행 중 (중복 저장 방지)
  view: 'all',        // 'all' | 'subject'
  sort: 'rank',       // 'rank' | 'created'
  expanded: new Set(),
  collapsedGroups: new Set(),
  page: 1,
};

/* ─── 부트 ────────────────────────────────────────────────── */

export async function renderOneTickets({ rootRel = '' } = {}) {
  state.rootRel = rootRel;
  state.filters = Object.assign(
    { project: null, status: null, priority: null, subSubject: null, hideLaunched: true },
    scoped(FILTERS_KEY).get({}) || {},
  );
  delete state.filters.showHidden;  // 폐지된 토글 — 잔존 값 무력화 (숨김 표시는 관리 모드로 대체)
  state.filters.label = null;  // 라벨 필터 폐지 — 저장된 잔존 값으로 인한 숨은 필터 방지
  const savedView = scoped(VIEW_KEY).get(null);
  if (savedView && typeof savedView === 'object') {
    if (savedView.view === 'all' || savedView.view === 'subject') state.view = savedView.view;
    if (savedView.sort === 'rank' || savedView.sort === 'created') state.sort = savedView.sort;
  }

  bindAuthUi();
  bindControls();

  const host = $('one-table');
  showLoading(host, { rows: 5, title: false });

  // 1) 읽기 데이터 로드 (로그인 불필요)
  try {
    await loadList();
  } catch (e) {
    console.error('[one-tickets] list load 실패', e);
    showError(host, e);
    return;
  }
  renderHeader();
  renderControls();
  renderList();

  // 2) 인증 → 편집 메타 오버레이 (실패해도 리스트는 그대로)
  renderAuthUi('checking');
  bootAuth();
}

/* ─── 데이터 로드 ─────────────────────────────────────────── */

async function loadList() {
  let items;
  try {
    const data = await loadJson(`${state.rootRel}data/jira/one-tickets.json`);
    items = (data.items || []);
  } catch (_) {
    items = await loadFallbackUnion(state.rootRel);
  }
  // 과제 유형(Initiative + 과제 발의)만 표시 — Epic·Design·기타(KTLO/BAU) 제외.
  state.items = items.map(normalizeItem).filter(isInitiative);
  recompute();
}

/** One 티켓 목록에 노출할 과제 유형. */
export const SHOWN_ISSUE_TYPES = new Set(['Initiative', '과제 발의']);
/** 노출 대상 과제 유형 여부 (Initiative 또는 과제 발의). Epic/Design/기타 제외. */
export function isInitiative(it) {
  return !!it && SHOWN_ISSUE_TYPES.has(it.issueType);
}

/** one-tickets.json 부재 시 기존 파일들을 union 해서 동등한 리스트 구성. */
async function loadFallbackUnion(rootRel) {
  const files = ['etr-fasttrack', 'ft-tickets', 'all-tickets', 'initiatives'];
  const settled = await Promise.allSettled(
    files.map(f => loadJson(`${rootRel}data/jira/${f}.json`)),
  );
  const byFile = {};
  files.forEach((f, i) => {
    byFile[f] = settled[i].status === 'fulfilled' ? (settled[i].value.items || []) : [];
  });
  return buildFromFallback(byFile);
}

/**
 * 여러 파일 items 를 key 기준 union → 'one' 라벨 && 6개 스페이스 필터.
 * ETR 항목은 etr-fasttrack(linkedTickets 보유) 을 우선 사용.
 * @param {{['etr-fasttrack']:Array, ['ft-tickets']:Array, ['all-tickets']:Array, initiatives:Array}} byFile
 */
export function buildFromFallback(byFile = {}) {
  const map = new Map();
  // 우선순위 낮은 것 먼저 넣고, ETR fasttrack 을 마지막에 덮어써 linkedTickets 보존.
  const order = ['initiatives', 'all-tickets', 'ft-tickets', 'etr-fasttrack'];
  for (const fname of order) {
    for (const it of (byFile[fname] || [])) {
      if (!it || !it.key) continue;
      const labels = it.labels || [];
      if (!labels.includes('one')) continue;
      if (!TOP_PROJECTS.includes(it.project)) continue;
      map.set(it.key, it);
    }
  }
  return [...map.values()];
}

function normalizeItem(raw) {
  return {
    ...raw,
    labels: Array.isArray(raw.labels) ? raw.labels : [],
    linkedTickets: Array.isArray(raw.linkedTickets) ? raw.linkedTickets : [],
    mainSubjects: Array.isArray(raw.mainSubjects) ? raw.mainSubjects : [],
    subSubject: raw.subSubject || '',
    subSubjects: Array.isArray(raw.subSubjects) ? raw.subSubjects : (raw.subSubject ? [raw.subSubject] : []),
  };
}

function recompute() {
  state.itemsByKey = new Map(state.items.map(it => [it.key, it]));
  const { reps, membersByRep } = clusterItems(state.items);
  state.topLevel = reps;            // 클러스터 대표(top-level)
  state.clusterMembers = membersByRep;  // repKey → [member items] (펼침에 표시)
}

/** 병합 제외 링크 타입 — Blocks 는 별도 과제로 보아 묶지 않는다. */
export const MERGE_EXCLUDE_LINKS = new Set(['Blocks']);

/**
 * 연결 티켓을 하나의 항목으로 병합 (union-find 클러스터링).
 * - 셋(itemsByKey) 안의 티켓끼리, Blocks 제외 모든 링크 타입으로 연결되면 같은 클러스터.
 * - 양방향/transitive(A-B-C) 모두 한 묶음. 클러스터당 대표 1개만 top-level, 나머지는 펼침.
 * @returns {{ reps: Object[], membersByRep: Map<string, Object[]> }}
 */
export function clusterItems(items) {
  const list = Array.isArray(items) ? items : [];
  const byKey = new Map(list.map(it => [it.key, it]));
  const parent = new Map(list.map(it => [it.key, it.key]));
  const find = (k) => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(k) !== r) { const n = parent.get(k); parent.set(k, r); k = n; }
    return r;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  for (const it of list) {
    for (const l of (it.linkedTickets || [])) {
      if (!l || !l.key || !byKey.has(l.key)) continue;      // 셋 안의 티켓끼리만
      if (MERGE_EXCLUDE_LINKS.has(l.linkType)) continue;     // Blocks 제외
      union(it.key, l.key);
    }
  }

  const byRoot = new Map();
  for (const it of list) {
    const r = find(it.key);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(it);
  }

  const reps = [];
  const membersByRep = new Map();
  for (const members of byRoot.values()) {
    const rep = pickRepresentative(members);
    reps.push(rep);
    membersByRep.set(rep.key, members.filter(m => m.key !== rep.key));
  }
  return { reps, membersByRep };
}

/** 클러스터 대표 선정: ETR 은 후순위(연결/복사된 실제 작업 티켓을 메인으로),
 *  그 외는 TOP_PROJECTS 순 → 생성 빠른 순 → key. */
export function pickRepresentative(members) {
  return members.slice().sort(cmpRep)[0];
}
function repRank(it) {
  if (it.project === 'ETR') return 1000;        // ETR 은 대표에서 가장 뒤로
  const pi = TOP_PROJECTS.indexOf(it.project);
  return pi < 0 ? 99 : pi;
}
function cmpRep(a, b) {
  const ra = repRank(a), rb = repRank(b);
  if (ra !== rb) return ra - rb;
  const ca = a.created || '', cb = b.created || '';
  if (ca !== cb) return ca < cb ? -1 : 1;
  return String(a.key) < String(b.key) ? -1 : 1;
}

/** 대표↔멤버 사이 직접 링크의 linkType (transitive 면 '연결'). 펼침 표식용. */
function linkRelation(rep, member) {
  for (const l of (rep.linkedTickets || [])) if (l && l.key === member.key) return l.linkType || '';
  for (const l of (member.linkedTickets || [])) if (l && l.key === rep.key) return l.linkType || '';
  return '';
}

/* ─── 헤더 ────────────────────────────────────────────────── */

function renderHeader() {
  const lede = document.querySelector('[data-lede]');
  if (!lede) return;
  const total = state.topLevel.length;
  if (total === 0) {
    lede.innerHTML = '동기화 대기 중 — Jira sync 후 표시됩니다.';
    return;
  }
  const merged = state.topLevel.filter(it => (state.clusterMembers.get(it.key) || []).length > 0).length;
  lede.innerHTML =
    `<strong class="num">${total}</strong>개 묶음 ` +
    `(전체 <span class="num">${state.items.length}</span>건, 병합 <span class="num">${merged}</span>묶음). ` +
    `연결 티켓(Blocks 제외) 행 클릭 시 펼침. 셀에서 요약·코멘트·우선순위 편집.`;
}

/* ─── 컨트롤 (뷰/정렬 토글 + 필터) ────────────────────────── */

function bindControls() {
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.view = btn.dataset.view;
      state.page = 1;
      persistView();
      renderControls();
      renderList();
    });
  });
  document.querySelectorAll('[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.sort = btn.dataset.sort;
      persistView();
      renderControls();
      renderList();
    });
  });
}

function persistView() {
  scoped(VIEW_KEY).set({ view: state.view, sort: state.sort });
}

function renderControls() {
  document.querySelectorAll('[data-view]').forEach(b =>
    b.classList.toggle('active', b.dataset.view === state.view));
  document.querySelectorAll('[data-sort]').forEach(b =>
    b.classList.toggle('active', b.dataset.sort === state.sort));
  renderFilters();
  renderHideControls();
}

/* ─── 숨김 관리 모드 ──────────────────────────────────────── */

function renderHideControls() {
  const host = $('hide-manage-controls');
  if (!host) return;
  if (!state.signedIn) { host.innerHTML = ''; return; }
  if (state.hideManageMode) {
    const n = state.hidePending.size;
    host.innerHTML =
      `<span class="muted dim-mono" style="margin-right:6px">숨김 관리</span>` +
      `<button type="button" class="tlink" data-hide-cancel>취소</button>` +
      `<button type="button" class="btn primary" data-hide-save ${state.hideSaving ? 'disabled' : ''}>${state.hideSaving ? '저장 중…' : `저장${n ? ` (${n})` : ''}`}</button>`;
    host.querySelector('[data-hide-cancel]').addEventListener('click', exitHideManage);
    host.querySelector('[data-hide-save]').addEventListener('click', saveHideManage);
  } else {
    host.innerHTML = `<button type="button" class="btn ghost" data-hide-manage>숨김 관리</button>`;
    host.querySelector('[data-hide-manage]').addEventListener('click', enterHideManage);
  }
}

function enterHideManage() {
  state.hideManageMode = true;
  state.hidePending = new Map();
  renderHideControls();
  renderList();   // 전체(숨김 포함) + 체크박스 노출
}

function exitHideManage() {
  state.hideManageMode = false;
  state.hidePending = new Map();
  renderHideControls();
  renderList();
}

async function saveHideManage() {
  if (state.hideSaving) return;
  // pending 중 실제로 바뀐 것만 반영.
  const changes = [];
  for (const [key, val] of state.hidePending) {
    const cur = !!(state.meta.get(key) && state.meta.get(key).hidden);
    if (val !== cur) changes.push([key, val]);
  }
  if (!changes.length) { exitHideManage(); return; }

  state.hideSaving = true;
  renderHideControls();   // 저장 버튼 disabled 반영
  let done = 0;
  try {
    for (const [key, val] of changes) {
      const saved = await upsertOneMeta(key, { hidden: val }, state.metaRows);
      if (saved) {
        state.meta.set(key, saved);
        const i = state.metaRows.findIndex(r => String(r.jira_key) === String(key));
        if (i >= 0) state.metaRows[i] = saved; else state.metaRows.push(saved);
      } else {
        state.meta.delete(key);
        state.metaRows = state.metaRows.filter(r => String(r.jira_key) !== String(key));
      }
      state.hidePending.delete(key);   // 적용 완료분은 pending 에서 제거(부분 실패 시 재시도 대상에서 빠짐)
      done++;
    }
    state.hideSaving = false;
    toast({ kicker: '숨김 관리', msg: `${done}건 반영`, kind: 'success' });
    exitHideManage();   // 성공 시에만 모드 종료 + 재렌더(숨김 필터 반영)
  } catch (e) {
    state.hideSaving = false;
    if (e instanceof AuthRequiredError) {
      state.signedIn = false; renderAuthUi('signedOut'); exitHideManage(); return;
    }
    console.error('[one-tickets] 숨김 저장 실패', e);
    toast({ kicker: '숨김 저장 실패', msg: `${done}/${changes.length}건 반영 후 실패 — 다시 저장하세요`, kind: 'alert' });
    renderHideControls();   // 모드 유지 + 남은 pending 으로 재시도 가능
  }
}

function renderFilters() {
  const host = $('one-filters');
  if (!host) return;
  const base = state.topLevel;
  if (!base.length) { host.innerHTML = ''; return; }

  const projects = TOP_PROJECTS.filter(p => base.some(it => it.project === p));
  const subSubjects = [...new Set(base.flatMap(subSubjectsOf).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ko'));
  const statuses = [...new Set(base.map(it => it.status).filter(Boolean))].sort();
  const priorities = [...new Set(base.map(it => it.priority).filter(Boolean))].sort();

  const f = state.filters;
  const hasAny = f.project || f.status || f.priority || f.subSubject;
  const row = (inner) => (inner ? `<div class="filter-row">${inner}</div>` : '');
  const viewToggles =
    `<span class="flabel">보기</span>` +
    `<button type="button" class="fchip ${f.hideLaunched ? 'on' : ''}" data-toggle="hideLaunched" role="switch" aria-checked="${f.hideLaunched ? 'true' : 'false'}">론치완료·Dropped 제외</button>`;

  host.innerHTML = `
    ${row(chipGroup('project', '프로젝트', projects.map(v => ({ v, label: v })), f.project))}
    ${row(chipGroup('subSubject', 'Sub Subject', subSubjects.map(v => ({ v, label: v })), f.subSubject))}
    ${row(chipGroup('priority', '우선순위', priorities.map(v => ({ v, label: v })), f.priority))}
    ${row(chipGroup('status', '상태', statuses.map(v => ({ v, label: v })), f.status))}
    ${row(viewToggles)}
    ${hasAny ? '<div class="filter-row"><button type="button" class="tlink" data-filter-reset>필터 초기화</button></div>' : ''}
  `;

  host.querySelectorAll('button.fchip[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.filter, v = btn.dataset.value;
      state.filters[k] = state.filters[k] === v ? null : v;
      scoped(FILTERS_KEY).set(state.filters);
      state.page = 1;
      renderFilters();
      renderList();
    });
  });
  host.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.toggle;            // hideLaunched
      state.filters[k] = !state.filters[k];
      scoped(FILTERS_KEY).set(state.filters);
      state.page = 1;
      renderFilters();
      renderList();
    });
  });
  const reset = host.querySelector('[data-filter-reset]');
  if (reset) reset.addEventListener('click', () => {
    // chip 필터만 초기화 (론치완료 토글은 보기 설정이라 유지)
    state.filters.project = state.filters.subSubject = state.filters.status = state.filters.priority = null;
    scoped(FILTERS_KEY).set(state.filters);
    state.page = 1;
    renderFilters();
    renderList();
  });
}

/** 항목의 Sub Subjects 배열 (subSubjects 우선, 없으면 subSubject 단일값). */
export function subSubjectsOf(it) {
  if (Array.isArray(it.subSubjects) && it.subSubjects.length) return it.subSubjects;
  if (it.subSubject) return [it.subSubject];
  return [];
}

function chipGroup(key, label, options, current) {
  if (!options.length) return '';
  const chips = options.map(opt => {
    const on = current === opt.v;
    return `<button type="button" class="fchip ${on ? 'on' : ''}" data-filter="${escapeAttr(key)}" data-value="${escapeAttr(opt.v)}">${escapeHtml(opt.label)}</button>`;
  }).join('');
  return `<span class="flabel">${escapeHtml(label)}</span>${chips}`;
}

/* ─── 필터 / 정렬 (pure) ──────────────────────────────────── */

/** "론치완료 제외" 토글이 숨기는 상태값 (완료/드랍 계열). */
export const HIDDEN_WHEN_LAUNCHED = new Set(['론치완료', 'Dropped']);

/** 단일 항목이 필터에 매칭되는지. hiddenKeys 가 주어지면 showHidden off 일 때 숨긴 항목 제외. */
export function itemMatchesFilters(it, filters, hiddenKeys) {
  if (filters.hideLaunched && HIDDEN_WHEN_LAUNCHED.has(it.status)) return false;
  if (!filters.showHidden && hiddenKeys && hiddenKeys.has(it.key)) return false;
  if (filters.project && it.project !== filters.project) return false;
  if (filters.subSubject && !subSubjectsOf(it).includes(filters.subSubject)) return false;
  if (filters.label && !(it.labels || []).includes(filters.label)) return false;
  if (filters.status && it.status !== filters.status) return false;
  if (filters.priority && it.priority !== filters.priority) return false;
  return true;
}

export function filterItems(items, filters) {
  return items.filter(it => itemMatchesFilters(it, filters));
}

/**
 * 클러스터 필터 — 대표 또는 멤버 중 하나라도 매칭되면 그 묶음을 노출.
 * (병합된 멤버가 필터에 걸려도 묶음이 사라지지 않게.)
 */
export function filterClusters(reps, filters, membersByRep = new Map(), hiddenKeys) {
  return reps.filter(rep => {
    if (itemMatchesFilters(rep, filters, hiddenKeys)) return true;
    return (membersByRep.get(rep.key) || []).some(m => itemMatchesFilters(m, filters, hiddenKeys));
  });
}

/** 클러스터의 최선(최소) 수동순위 — 멤버 포함. 없으면 null. */
function clusterBestRank(rep, members, metaMap) {
  const ranks = [rep, ...members].map(it => rankOf(it.key, metaMap)).filter(r => r != null);
  return ranks.length ? Math.min(...ranks) : null;
}
/** 클러스터의 최신 created(ms) — 멤버 포함. */
function clusterNewest(rep, members) {
  return Math.max(0, ...[rep, ...members].map(it => (it.created ? new Date(it.created).getTime() : 0)));
}

/** 클러스터 정렬 — rank: 묶음 최선순위 asc, 없으면 최신순. created: 묶음 최신순. */
export function sortClusters(reps, sort, metaMap = new Map(), membersByRep = new Map()) {
  const arr = reps.slice();
  const mem = (r) => membersByRep.get(r.key) || [];
  const newest = (r) => clusterNewest(r, mem(r));
  if (sort === 'created') {
    arr.sort((a, b) => newest(b) - newest(a));
    return arr;
  }
  arr.sort((a, b) => {
    const ra = clusterBestRank(a, mem(a), metaMap);
    const rb = clusterBestRank(b, mem(b), metaMap);
    if (ra != null && rb != null) return ra - rb || (newest(b) - newest(a));
    if (ra != null) return -1;
    if (rb != null) return 1;
    return newest(b) - newest(a);
  });
  return arr;
}

function rankOf(key, metaMap) {
  const m = metaMap.get(key);
  if (!m) return null;
  const n = parseInt(m.manual_rank, 10);
  return Number.isFinite(n) ? n : null;
}

export function sortItems(items, sort, metaMap = new Map()) {
  const arr = items.slice();
  const createdDesc = (a, b) => {
    const ta = a.created ? new Date(a.created).getTime() : 0;
    const tb = b.created ? new Date(b.created).getTime() : 0;
    return tb - ta;
  };
  if (sort === 'created') {
    arr.sort(createdDesc);
    return arr;
  }
  // rank: 숫자 순위 있는 것 먼저(asc), 나머지는 created desc
  arr.sort((a, b) => {
    const ra = rankOf(a.key, metaMap);
    const rb = rankOf(b.key, metaMap);
    if (ra != null && rb != null) return ra - rb || createdDesc(a, b);
    if (ra != null) return -1;
    if (rb != null) return 1;
    return createdDesc(a, b);
  });
  return arr;
}

/** mainSubject 기준 그룹핑. subject 없으면 NO_SUBJECT. 번호 프리픽스(01., 02.…) 오름차순, 미지정 마지막. */
export function groupByMainSubject(items) {
  const map = new Map();
  for (const it of items) {
    const s = (it.mainSubject && String(it.mainSubject).trim()) || NO_SUBJECT;
    if (!map.has(s)) map.set(s, []);
    map.get(s).push(it);
  }
  const groups = [...map.entries()].map(([subject, list]) => ({ subject, items: list }));
  groups.sort((a, b) => {
    if (a.subject === NO_SUBJECT) return 1;
    if (b.subject === NO_SUBJECT) return -1;
    // "03.랭킹…" 의 앞 번호 기준 오름차순(01→). 번호 없으면 뒤로, 동순위는 한글 가나다.
    const na = subjectOrder(a.subject), nb = subjectOrder(b.subject);
    if (na !== nb) return na - nb;
    return a.subject.localeCompare(b.subject, 'ko');
  });
  return groups;
}

/** mainSubject 앞 번호("03.…")를 정수로. 없으면 큰 값(뒤). */
function subjectOrder(s) {
  const m = /^\s*(\d+)/.exec(String(s || ''));
  return m ? parseInt(m[1], 10) : 9999;
}

/* ─── 리스트 렌더 ─────────────────────────────────────────── */

function renderList() {
  const host = $('one-table');
  if (!host) return;
  // 수동 숨김 키 집합 (meta.hidden). 관리 모드에선 전체 표시(숨김 포함)해 체크/해제할 수 있게.
  const hiddenKeys = new Set();
  for (const [k, m] of state.meta) if (m && m.hidden) hiddenKeys.add(String(k));
  const eff = { ...state.filters, showHidden: state.hideManageMode };

  const filtered = filterClusters(state.topLevel, eff, state.clusterMembers, hiddenKeys);
  // 표시 대표 재선정: 대표가 필터를 통과 못 하면(론치완료/숨김 등) 통과하는 멤버를 대표로 승격.
  // → 묶음은 유지하되 화면 상단에 필터에 맞는 티켓이 오게.
  state.displayMembers = new Map();
  const displayReps = filtered.map(origRep => {
    const members = state.clusterMembers.get(origRep.key) || [];
    if (itemMatchesFilters(origRep, eff, hiddenKeys)) {
      state.displayMembers.set(origRep.key, members);
      return origRep;
    }
    const all = [origRep, ...members];
    const passing = all.filter(it => itemMatchesFilters(it, eff, hiddenKeys));
    const rep = passing.length ? passing.slice().sort(cmpRep)[0] : origRep;
    state.displayMembers.set(rep.key, all.filter(it => it.key !== rep.key));
    return rep;
  });
  const rows = sortClusters(displayReps, state.sort, state.meta, state.displayMembers);

  if (!rows.length) {
    host.innerHTML = emptyHtml({
      kicker: 'NO ITEMS',
      msg: state.topLevel.length === 0
        ? '동기화 대기 중 — Jira sync 후 표시됩니다.'
        : '필터에 맞는 항목이 없습니다.',
    });
    return;
  }

  if (state.view === 'subject') renderSubjectView(host, rows);
  else renderFlat(host, rows);

  bindRowToggle(host);
  bindMetaInputs(host);
  bindPager(host);
  bindGroupToggle(host);
}

const COLS = 9;

function theadHtml() {
  return `
    <thead>
      <tr>
        <th style="width:92px">키</th>
        <th style="width:34%">요약</th>
        <th style="width:64px">프로젝트</th>
        <th style="width:150px">상태</th>
        <th style="width:48px">우선</th>
        <th style="width:74px">순위</th>
        <th style="width:64px" title="Quick fix 대상">Quick fix</th>
        <th style="width:40%">코멘트</th>
        <th style="width:${state.hideManageMode ? 56 : 20}px">${state.hideManageMode ? '숨김' : ''}</th>
      </tr>
    </thead>`;
}

function renderFlat(host, rows) {
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;
  if (state.page < 1) state.page = 1;
  const start = (state.page - 1) * PAGE_SIZE;
  const slice = rows.slice(start, start + PAGE_SIZE);

  host.innerHTML = `
    <table class="tbl">
      ${theadHtml()}
      <tbody>${slice.map(rowHtml).join('')}</tbody>
    </table>
    ${pagerHtml(rows.length, totalPages, state.page, start, slice.length)}
  `;
}

function renderSubjectView(host, rows) {
  const groups = groupByMainSubject(rows);
  host.innerHTML = groups.map(g => {
    const collapsed = state.collapsedGroups.has(g.subject);
    return `
      <section class="one-group">
        <div class="one-group-head" role="button" tabindex="0" data-group="${escapeAttr(g.subject)}" aria-expanded="${collapsed ? 'false' : 'true'}">
          <span class="caret ${collapsed ? '' : 'open'}" aria-hidden="true">›</span>
          <span class="one-group-name">${escapeHtml(g.subject)}</span>
          <span class="one-group-count num">${g.items.length}</span>
        </div>
        ${collapsed ? '' : `<table class="tbl">${theadHtml()}<tbody>${g.items.map(rowHtml).join('')}</tbody></table>`}
      </section>
    `;
  }).join('');
}

function rowHtml(it) {
  const members = (state.displayMembers && state.displayMembers.get(it.key)) || [];
  const expandable = members.length > 0;
  const open = state.expanded.has(it.key);
  const g = STATUS_GROUPS.find(x => x.id === statusGroup(it));
  const priCls = `pri-${(it.priority || '').toLowerCase() || 'p3'}`;
  const expandId = `one-expand-${cssId(it.key)}`;
  const m = state.meta.get(it.key);
  const isHidden = !!(m && m.hidden);
  // 관리 모드에선 pending(체크박스) 상태를 dim 에 반영해 체크박스와 일치.
  const dimHidden = state.hideManageMode && state.hidePending.has(it.key)
    ? state.hidePending.get(it.key)
    : isHidden;
  const cls = `${expandable ? 'ft-row ' : ''}one-row${dimHidden ? ' one-hidden-row' : ''}`;
  const rowAttrs = expandable
    ? `class="${cls}" data-key="${escapeAttr(it.key)}" role="button" tabindex="0" aria-expanded="${open ? 'true' : 'false'}" aria-controls="${expandId}"`
    : `class="${cls}" data-key="${escapeAttr(it.key)}"`;

  return `
    <tr ${rowAttrs}>
      <td>${jiraKeyHtml(it.key)}</td>
      <td class="ft-summary">${summaryCellHtml(it)}</td>
      <td><span class="dim dim-mono">${escapeHtml(it.project || '—')}</span></td>
      <td><span class="st ${g ? g.stClass : 'st-wait'}">${escapeHtml(it.status || '—')}</span></td>
      <td><span class="pri ${priCls}">${escapeHtml(it.priority || '—')}</span></td>
      <td>${rankCellHtml(it.key)}</td>
      <td class="one-qf-cell">${quickFixCellHtml(it.key)}</td>
      <td>${commentCellHtml(it.key)}</td>
      <td class="one-row-actions">${hideBtnHtml(it.key)}${expandable ? `<span class="caret ${open ? 'open' : ''}" aria-hidden="true">›</span>` : ''}</td>
    </tr>
    ${expandable && open ? expandHtml(it, expandId) : ''}
  `;
}

/** 행 숨김 체크박스 — 숨김 관리 모드에서만 노출. 체크=숨김 예정. (저장 시 반영) */
function hideBtnHtml(key) {
  if (!state.signedIn || !state.hideManageMode) return '';
  const cur = !!(state.meta.get(key) && state.meta.get(key).hidden);
  const checked = state.hidePending.has(key) ? state.hidePending.get(key) : cur;
  return `<input type="checkbox" class="one-hide-cb" data-key="${escapeAttr(key)}" ${checked ? 'checked' : ''}
            aria-label="${escapeAttr(key)} 숨김 선택" />`;
}

/** 라벨 칩(one 제외) HTML. */
function labelChipsHtml(it) {
  const chips = (it.labels || []).filter(l => l && l !== 'one')
    .map(l => `<span class="one-label-chip">${escapeHtml(l)}</span>`).join('');
  return chips ? `<span class="one-labels">${chips}</span>` : '';
}

/** 요약 셀 — 대시보드 전용 override(summary_override) 우선. 로그인 시 인라인 편집(Jira 미동기화). */
function summaryCellHtml(it) {
  const m = state.meta.get(it.key);
  const override = m && m.summary_override ? String(m.summary_override) : '';
  const display = override || it.summary || '';
  const chips = labelChipsHtml(it);
  if (!state.signedIn) {
    return `${escapeHtml(display)}${override ? ' <span class="one-edited" title="대시보드에서 수정된 요약">✎</span>' : ''}${chips}`;
  }
  return `
    <input type="text" class="one-summary-input" data-key="${escapeAttr(it.key)}"
           value="${escapeAttr(display)}" placeholder="요약" aria-label="${escapeAttr(it.key)} 요약 (대시보드 전용)" />
    ${override ? '<span class="one-edited" title="대시보드에서 수정된 요약 (Jira 미반영)">✎ 수정됨</span>' : ''}${chips}`;
}

/** Quick fix 체크박스 셀. */
function quickFixCellHtml(key) {
  const m = state.meta.get(key);
  const checked = m && m.quick_fix ? 'checked' : '';
  const dis = state.signedIn ? '' : 'disabled';
  return `<input type="checkbox" class="one-quickfix" data-key="${escapeAttr(key)}" ${checked} ${dis}
            aria-label="${escapeAttr(key)} Quick fix 대상" />`;
}

function rankCellHtml(key) {
  const m = state.meta.get(key);
  const val = m && m.manual_rank != null ? String(m.manual_rank) : '';
  const dis = state.signedIn ? '' : 'disabled';
  const ph = state.signedIn ? '—' : '잠김';
  return `<input type="number" min="0" inputmode="numeric" class="one-rank-input num"
            data-key="${escapeAttr(key)}" value="${escapeAttr(val)}" placeholder="${ph}" ${dis}
            aria-label="${escapeAttr(key)} 수동 우선순위" />`;
}

function commentCellHtml(key) {
  const m = state.meta.get(key);
  const val = m && m.comment != null ? String(m.comment) : '';
  const dis = state.signedIn ? '' : 'disabled';
  const ph = state.signedIn ? '코멘트 입력…' : '로그인 필요';
  return `<textarea class="one-comment-input" rows="2"
            data-key="${escapeAttr(key)}" placeholder="${ph}" ${dis}
            aria-label="${escapeAttr(key)} 코멘트">${escapeHtml(val)}</textarea>`;
}

function expandHtml(it, expandId) {
  const members = (state.displayMembers && state.displayMembers.get(it.key)) || [];
  const rows = members.map(m => {
    const g = STATUS_GROUPS.find(x => x.id === statusGroup(m));
    const assignee = (m.assignee && m.assignee.name) || '—';
    const rel = linkRelation(it, m);
    return `
      <div class="linked-row">
        ${jiraKeyHtml(m.key)}
        <span class="dim dim-mono">${escapeHtml(m.project || '')}</span>
        <span class="ft-link-summary">${escapeHtml(m.summary || '')}</span>
        ${rel ? `<span class="one-rel">${escapeHtml(rel)}</span>` : ''}
        <span class="st ${g ? g.stClass : 'st-wait'}">${escapeHtml(m.status || '—')}</span>
        <span class="who"><span class="who-dot"></span>${escapeHtml(assignee)}</span>
      </div>
    `;
  }).join('');
  return `
    <tr class="ft-expand" role="presentation"><td colspan="${COLS}" role="presentation" class="ft-expand-cell">
      <section id="${expandId}" class="expand" role="region" aria-label="연결 티켓 ${members.length}건">
        <div class="expand-label">연결 티켓 · ${members.length}건 (하나로 병합 · Blocks 제외)</div>
        ${rows}
      </section>
    </td></tr>
  `;
}

function cssId(s) {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

/* ─── 행 펼침 / 그룹 펼침 ─────────────────────────────────── */

function bindRowToggle(host) {
  host.querySelectorAll('tr.ft-row').forEach(tr => {
    tr.addEventListener('click', e => {
      if (e.target.closest('a, input, textarea, button')) return;
      toggleRow(tr);
    });
    tr.addEventListener('keydown', onRowKeydown);
  });
}

export function onRowKeydown(e) {
  if (e.currentTarget !== e.target) return;
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  toggleRow(e.currentTarget);
}

function toggleRow(tr) {
  const key = tr.dataset.key;
  if (!key) return;
  if (state.expanded.has(key)) state.expanded.delete(key);
  else state.expanded.add(key);
  renderList();
}

function bindGroupToggle(host) {
  host.querySelectorAll('.one-group-head').forEach(head => {
    const toggle = () => {
      const s = head.dataset.group;
      if (state.collapsedGroups.has(s)) state.collapsedGroups.delete(s);
      else state.collapsedGroups.add(s);
      renderList();
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });
}

/* ─── 페이저 ──────────────────────────────────────────────── */

function pagerHtml(total, totalPages, cur, start, sliceLen) {
  if (totalPages <= 1) {
    return `<div class="pager"><span class="pager-info"><span class="num">${total}</span>개 묶음</span></div>`;
  }
  return `
    <nav class="pager" role="navigation" aria-label="페이지네이션">
      <button type="button" data-pg="prev" ${cur === 1 ? 'disabled' : ''}>‹ 이전</button>
      <span class="num">${start + 1}–${start + sliceLen}</span>
      <span class="pager-sep">/</span>
      <span class="num">${total}</span>
      <button type="button" data-pg="next" ${cur === totalPages ? 'disabled' : ''}>다음 ›</button>
      <span class="pager-info"><span class="num">${cur}</span>/<span class="num">${totalPages}</span></span>
    </nav>
  `;
}

function bindPager(host) {
  host.querySelectorAll('button[data-pg]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      if (btn.dataset.pg === 'prev') state.page--;
      else state.page++;
      renderList();
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      host.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    });
  });
}

/* ─── 코멘트 / 순위 입력 ──────────────────────────────────── */

function bindMetaInputs(host) {
  host.querySelectorAll('.one-rank-input').forEach(inp => {
    inp.addEventListener('change', () => saveMeta(inp.dataset.key, { manual_rank: inp.value }, { resort: true }));
  });
  // 요약 인라인 편집 (대시보드 전용). 원본 Jira 요약과 같거나 비우면 override 해제.
  host.querySelectorAll('.one-summary-input').forEach(inp => {
    inp.addEventListener('change', () => {
      const key = inp.dataset.key;
      const orig = (state.itemsByKey.get(key) || {}).summary || '';
      const v = inp.value.trim();
      saveMeta(key, { summary_override: v === orig ? '' : v }, { rerender: true });
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  });
  // Quick fix 체크박스
  host.querySelectorAll('.one-quickfix').forEach(cb => {
    cb.addEventListener('change', () => saveMeta(cb.dataset.key, { quick_fix: cb.checked }));
  });
  // 코멘트 textarea — Enter 는 줄바꿈 허용, 저장은 blur(change) 시점.
  host.querySelectorAll('.one-comment-input').forEach(inp => {
    inp.addEventListener('change', () => saveMeta(inp.dataset.key, { comment: inp.value }));
  });
  // 숨김 관리 모드 체크박스 — 변경은 pending 에만(저장 시 일괄 반영). 행 펼침 토글 방지.
  host.querySelectorAll('.one-hide-cb').forEach(cb => {
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => {
      state.hidePending.set(cb.dataset.key, cb.checked);
      cb.closest('tr')?.classList.toggle('one-hidden-row', cb.checked);   // live dim
      renderHideControls();   // 저장 버튼의 변경 건수 갱신
    });
  });
}

async function saveMeta(key, patch, { resort = false, rerender = false } = {}) {
  if (!key || !state.signedIn) return;
  try {
    const saved = await upsertOneMeta(key, patch, state.metaRows);
    // 로컬 상태 갱신
    if (saved) {
      state.meta.set(key, saved);
      const idx = state.metaRows.findIndex(r => String(r.jira_key) === String(key));
      if (idx >= 0) state.metaRows[idx] = saved; else state.metaRows.push(saved);
    } else {
      // 빈 값 → 행 삭제됨
      state.meta.delete(key);
      state.metaRows = state.metaRows.filter(r => String(r.jira_key) !== String(key));
    }
    toast({ kicker: key, msg: '저장됨', kind: 'success' });
    if ((resort && state.sort === 'rank') || rerender) renderList();
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      state.signedIn = false;
      renderAuthUi('signedOut');
      renderList();
      return;
    }
    console.error('[one-tickets] saveMeta 실패', e);
    toast({ kicker: '저장 실패', msg: e.message || String(e), kind: 'alert' });
  }
}

/* ─── 인증 ────────────────────────────────────────────────── */

function bindAuthUi() {
  const signin = $('btn-signin');
  const signout = $('btn-signout');
  const refresh = $('btn-refresh');
  if (signin) signin.addEventListener('click', onSignInClick);
  if (signout) signout.addEventListener('click', onSignOutClick);
  if (refresh) refresh.addEventListener('click', () => loadMeta());
}

async function bootAuth() {
  await auth.init();   // Supabase 세션 복원 (localStorage + OAuth redirect 복귀)
  if (auth.isSignedIn()) {
    state.signedIn = true;
    state.email = auth.email();
    renderAuthUi('signedIn');
    await loadMeta();
    return;
  }
  state.signedIn = false;
  renderAuthUi('signedOut');
}

async function onSignInClick() {
  try {
    // OAuth redirect — 페이지가 Google 로 이동했다가 복귀. 복귀 후 bootAuth(auth.init)가 세션 흡수.
    await auth.signIn();
  } catch (e) {
    toast({ kicker: '로그인 시작 실패', msg: e.message || String(e), kind: 'alert' });
  }
}

function onSignOutClick() {
  auth.signOut();
  stopRealtime();
  state.signedIn = false;
  state.email = null;
  state.meta = new Map();
  state.metaRows = [];
  state.hideManageMode = false;
  state.hidePending = new Map();
  renderAuthUi('signedOut');
  renderHideControls();
  renderList();
}

async function loadMeta() {
  if (!state.signedIn) return;
  const refresh = $('btn-refresh');
  if (refresh) refresh.disabled = true;
  try {
    state.metaRows = await loadOneMeta();
    state.meta = metaByKey(state.metaRows);
    renderAuthUi('signedIn');
    renderHideControls();   // 로그인 후 "숨김 관리" 버튼 노출
    renderList();
    startRealtime();
  } catch (e) {
    if (e instanceof AuthRequiredError) { state.signedIn = false; stopRealtime(); renderAuthUi('signedOut'); renderList(); return; }
    console.error('[one-tickets] meta 로드 실패', e);
    toast({ kicker: '메타 로드 실패', msg: e.message || String(e), kind: 'alert' });
  } finally {
    if (refresh) refresh.disabled = false;
  }
}

/* ─── Realtime ───────────────────────────────────────────────
   one_ticket_meta 변경 구독 → 디바운스 후 meta 재로드. 코멘트 입력 중이면 보류. */
let rtHandle = null;
let rtTimer = null;
let rtRetries = 0;

function startRealtime() {
  if (rtHandle) return;
  rtHandle = subscribe('one-tickets-meta', ['one_ticket_meta'], (payload) => {
    // self-echo 스킵 — 내 코멘트/순위 편집 echo 면 reload 안 함.
    const who = payload?.new?.updated_by ?? payload?.old?.updated_by;
    if (who && who === auth.email()) return;
    clearTimeout(rtTimer);
    rtRetries = 0;
    rtTimer = setTimeout(attemptRealtimeReload, 500);
  });
}

function attemptRealtimeReload() {
  if (!state.signedIn) return;
  // 입력 중이거나 숨김 관리 모드면 보류(편집/pending clobber 방지). 최대 ~8s 후 포기.
  const ae = document.activeElement;
  const busy = state.hideManageMode || (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA'));
  if (busy) {
    if (rtRetries++ < 10) { rtTimer = setTimeout(attemptRealtimeReload, 800); }
    else { rtRetries = 0; console.warn('[one-tickets] realtime reload 보류 — 편집/숨김관리 중. 다음 변경/새로고침 시 반영'); }
    return;
  }
  rtRetries = 0;
  loadMeta();
}

function stopRealtime() {
  if (rtHandle) { rtHandle.unsubscribe(); rtHandle = null; }
  clearTimeout(rtTimer);
  rtRetries = 0;
}

/**
 * @param {'checking'|'signedIn'|'signedOut'} phase
 */
function renderAuthUi(phase, err) {
  const status = $('auth-status');
  const signin = $('btn-signin');
  const signout = $('btn-signout');
  const refresh = $('btn-refresh');
  const help = $('auth-help');
  if (!status) return;

  const show = (el, on) => { if (el) el.hidden = !on; };

  switch (phase) {
    case 'checking':
      status.textContent = '인증 확인 중…';
      show(signin, false); show(signout, false);
      if (refresh) refresh.disabled = true;
      break;
    case 'signedIn':
      status.textContent = `로그인됨${state.email ? ' · ' + state.email : ''}`;
      show(signin, false); show(signout, true);
      if (refresh) refresh.disabled = false;
      if (help) help.textContent = '코멘트·수동 우선순위가 Supabase 에 자동 저장됩니다.';
      break;
    case 'signedOut':
    default:
      status.textContent = '로그인하면 코멘트·우선순위 편집';
      show(signin, true); show(signout, false);
      if (refresh) refresh.disabled = true;
      if (help) help.textContent = '리스트는 로그인 없이도 볼 수 있습니다. 편집하려면 musinsa.com Google 계정으로 로그인하세요.';
      break;
  }
}

/* ─── test export ─────────────────────────────────────────── */

export const _internal = {
  TOP_PROJECTS, PAGE_SIZE, NO_SUBJECT,
  normalizeItem, isInitiative, buildFromFallback, clusterItems, pickRepresentative, MERGE_EXCLUDE_LINKS,
  filterItems, itemMatchesFilters, filterClusters, sortItems, sortClusters,
  groupByMainSubject, rankOf, cssId, subSubjectsOf,
};
