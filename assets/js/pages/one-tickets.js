/* =========================================================
   pages/one-tickets.js — One 티켓 관리
   ETR / MSSCXTF / FT / TM / CBP / PBO / PD 의 'one' 라벨 티켓을 한 화면에서 관리.

   - 읽기 데이터: data/jira/one-tickets.json (없으면 기존 파일 union fallback)
   - 연결 티켓(Blocks 제외)은 union-find 로 한 묶음 병합 + 펼침으로 "하나로" 관리
   - 뷰: 전체 리스트 / Main Subject 그룹(번호 오름차순)
   - 필터: 프로젝트 / Sub Subject / 우선순위 / 상태 + 론치완료·Dropped·철회 제외 토글 (localStorage UI state)
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
  uploadTicketImageBlob, signedImageUrl, removeTicketImage,
} from '../api/one-ticket-meta.js';

const TOP_PROJECTS = ['ETR', 'MSSCXTF', 'FT', 'TM', 'CBP', 'PBO', 'PD', 'MSS'];
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
  filters: { projects: [], subSubjects: [], priorities: [], statuses: [], hideLaunched: true, fasttrackOnly: false, fasttrackExclude: false, quickFixOnly: false, quickFixExclude: false, specUnset: false },
  hideManageMode: false,   // 숨김 관리 모드 (체크박스 노출 + 전체 표시)
  hidePending: new Map(),  // 관리 모드 중 변경 대기 (key → bool)
  hideSaving: false,       // 저장 진행 중 (중복 저장 방지)
  imgBusy: false,          // 이미지 업로드/삭제 진행 중 (중복 제출 방지)
  renderToken: 0,          // 렌더 식별 (서명 URL stale 주입 방지)
  view: 'all',        // 'all' | 'subject'
  sort: 'rank',       // 'rank' | 'created'
  sortDir: 'desc',    // 생성일 정렬 방향: 'desc'(최근순) | 'asc'(오래된순)
  expanded: new Set(),
  collapsedGroups: new Set(),
  page: 1,
};

/* ─── 부트 ────────────────────────────────────────────────── */

export async function renderOneTickets({ rootRel = '' } = {}) {
  state.rootRel = rootRel;
  state.filters = Object.assign(
    { projects: [], subSubjects: [], priorities: [], statuses: [], hideLaunched: true, fasttrackOnly: false, fasttrackExclude: false, quickFixOnly: false, quickFixExclude: false, specUnset: false },
    scoped(FILTERS_KEY).get({}) || {},
  );
  // 복수 선택(OR) 마이그레이션 — 레거시 단일값 → 배열. 모든 chip 필터 공통.
  for (const [arrKey, singleKey] of [['projects', 'project'], ['subSubjects', 'subSubject'], ['priorities', 'priority'], ['statuses', 'status']]) {
    if (!Array.isArray(state.filters[arrKey])) state.filters[arrKey] = [];
    if (state.filters[singleKey]) {
      if (!state.filters[arrKey].includes(state.filters[singleKey])) state.filters[arrKey].push(state.filters[singleKey]);
      delete state.filters[singleKey];
    }
  }
  delete state.filters.showHidden;  // 폐지된 토글 — 잔존 값 무력화 (숨김 표시는 관리 모드로 대체)
  delete state.filters.label;  // 라벨 필터 폐지 — 저장된 잔존 값으로 인한 숨은 필터 방지
  const savedView = scoped(VIEW_KEY).get(null);
  if (savedView && typeof savedView === 'object') {
    if (savedView.view === 'all' || savedView.view === 'subject') state.view = savedView.view;
    if (savedView.sort === 'rank' || savedView.sort === 'created') state.sort = savedView.sort;
    if (savedView.sortDir === 'asc' || savedView.sortDir === 'desc') state.sortDir = savedView.sortDir;
  }
  // URL 쿼리 파람이 있으면 필터/뷰를 그 기준으로 덮어씀(공유 링크). 이후 주소창을 현재 상태로 정규화.
  applyUrlParams();
  syncUrl();

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
  // "내용" 기본값(커밋된 AI 생성 요약) — 편집 시 meta.content 가 override.
  state.contentDefaults = new Map();
  try {
    const cj = await loadJson(`${state.rootRel}data/jira/one-content.json`);
    for (const [k, v] of Object.entries(cj || {})) state.contentDefaults.set(String(k), String(v ?? ''));
  } catch (_) { /* 파일 없으면 기본값 없음 — 빈 칸 */ }
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

/** 표시상 숨겨야 할 항목 — 종료 계열·수동 숨김 + 제외형 토글(fasttrack/quick fix 제외·spec 미지정).
 * 선택형 필터(프로젝트/상태/우선순위)는 대표를 바꾸지 않으므로 여기서 보지 않는다. */
function isDisplayHidden(it, eff = {}, hiddenKeys, quickFixKeys, specKeys) {
  if (eff.hideLaunched && HIDDEN_WHEN_LAUNCHED.has(it.status)) return true;
  if (eff.fasttrackExclude && hasFasttrackLabel(it)) return true;
  if (eff.quickFixExclude && quickFixKeys && quickFixKeys.has(it.key)) return true;
  if (eff.specUnset && specKeys && specKeys.has(it.key)) return true;
  if (!eff.showHidden && hiddenKeys && hiddenKeys.has(it.key)) return true;
  return false;
}

/**
 * 클러스터의 화면 표시 대표 선정.
 * 종료·수동 숨김·제외형 토글 대상이 아닌 멤버 중 cmpRep 최선(=비-ETR 우선)을 대표로.
 * 프로젝트/상태/우선순위 선택 필터로는 대표를 바꾸지 않는다 — 연결된 실제 작업 티켓이 항상 메인.
 * (모두 숨김 대상이면 전체에서 최선.)
 */
export function pickDisplayRep(all, eff = {}, hiddenKeys, quickFixKeys, specKeys) {
  const list = Array.isArray(all) ? all : [];
  const visible = list.filter(it => !isDisplayHidden(it, eff, hiddenKeys, quickFixKeys, specKeys));
  return (visible.length ? visible : list).slice().sort(cmpRep)[0];
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
      const s = btn.dataset.sort;
      if (s === 'created') {
        // 이미 생성일 정렬이면 방향 토글(최근↔오래된), 아니면 생성일·최근순으로 진입.
        if (state.sort === 'created') state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
        else { state.sort = 'created'; state.sortDir = 'desc'; }
      } else {
        state.sort = s;
      }
      persistView();
      renderControls();
      renderList();
    });
  });
}

function persistView() {
  scoped(VIEW_KEY).set({ view: state.view, sort: state.sort, sortDir: state.sortDir });
  syncUrl();
}

/** 필터 변경 저장 — localStorage(개인) + URL 쿼리(공유) 동시 반영. */
function persistFilters() {
  scoped(FILTERS_KEY).set(state.filters);
  syncUrl();
}

/* ─── URL 쿼리 동기화 (필터 걸린 채 공유) ──────────────────
 * 배열 필터는 반복 키(proj=A&proj=B)로 — 값에 콤마/슬래시 있어도 안전.
 * 불리언은 기본값과 다를 때만 기록. 읽을 때 URL 파람이 하나라도 있으면 URL 이 권위(공유 링크 결정적). */
function syncUrl() {
  const f = state.filters || {};
  const p = new URLSearchParams();
  for (const v of f.projects || []) p.append('proj', v);
  for (const v of f.subSubjects || []) p.append('sub', v);
  for (const v of f.priorities || []) p.append('pri', v);
  for (const v of f.statuses || []) p.append('st', v);
  if (!f.hideLaunched) p.set('hl', '0');     // 기본 true → false 일 때만
  if (f.fasttrackOnly) p.set('ft', '1');
  if (f.fasttrackExclude) p.set('ftx', '1');
  if (f.quickFixOnly) p.set('qf', '1');
  if (f.quickFixExclude) p.set('qfx', '1');
  if (f.specUnset) p.set('sx', '1');
  if (state.view === 'subject') p.set('view', 'subject');
  if (state.sort === 'created') { p.set('sort', 'created'); if (state.sortDir === 'asc') p.set('dir', 'asc'); }
  const qs = p.toString();
  history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
}

/** URL 쿼리 → state.filters/뷰. 파람이 하나라도 있으면 필터를 URL 기준으로 재구성(공유 링크 결정적). */
function applyUrlParams() {
  const p = new URLSearchParams(location.search);
  const KEYS = ['proj', 'sub', 'pri', 'st', 'hl', 'ft', 'ftx', 'qf', 'qfx', 'sx', 'view', 'sort', 'dir'];
  if (!KEYS.some(k => p.has(k))) return;     // 파람 없음 → localStorage 유지
  state.filters = {
    projects: p.getAll('proj'),
    subSubjects: p.getAll('sub'),
    priorities: p.getAll('pri'),
    statuses: p.getAll('st'),
    hideLaunched: p.get('hl') !== '0',
    fasttrackOnly: p.get('ft') === '1',
    fasttrackExclude: p.get('ftx') === '1',
    quickFixOnly: p.get('qf') === '1',
    quickFixExclude: p.get('qfx') === '1',
    specUnset: p.get('sx') === '1',
  };
  if (state.filters.fasttrackOnly) state.filters.fasttrackExclude = false;
  if (state.filters.quickFixOnly) state.filters.quickFixExclude = false;
  if (p.get('view') === 'subject') state.view = 'subject';
  else if (p.get('view') === 'all') state.view = 'all';
  if (p.get('sort') === 'created') { state.sort = 'created'; state.sortDir = p.get('dir') === 'asc' ? 'asc' : 'desc'; }
  else if (p.get('sort') === 'rank') state.sort = 'rank';
}

function renderControls() {
  document.querySelectorAll('[data-view]').forEach(b =>
    b.classList.toggle('active', b.dataset.view === state.view));
  document.querySelectorAll('[data-sort]').forEach(b =>
    b.classList.toggle('active', b.dataset.sort === state.sort));
  // 생성일 버튼: 활성 시 정렬 방향 화살표(↓ 최근순 / ↑ 오래된순) 표시.
  const createdBtn = document.querySelector('[data-sort="created"]');
  if (createdBtn) {
    const active = state.sort === 'created';
    createdBtn.textContent = '생성일' + (active ? (state.sortDir === 'desc' ? ' ↓' : ' ↑') : '');
    createdBtn.title = active
      ? (state.sortDir === 'desc' ? '최근순 — 다시 누르면 오래된 순' : '오래된 순 — 다시 누르면 최근순')
      : '생성일순 정렬 (최근순부터)';
  }
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
  const len = (a) => (Array.isArray(a) ? a.length : 0);
  const hasAny = len(f.projects) || len(f.subSubjects) || len(f.priorities) || len(f.statuses);
  const row = (inner) => (inner ? `<div class="filter-row">${inner}</div>` : '');
  const viewToggles =
    `<span class="flabel">보기</span>` +
    `<button type="button" class="fchip ${f.hideLaunched ? 'on' : ''}" data-toggle="hideLaunched" role="switch" aria-checked="${f.hideLaunched ? 'true' : 'false'}">론치완료·Dropped·철회 제외</button>` +
    `<button type="button" class="fchip ${f.fasttrackOnly ? 'on' : ''}" data-toggle="fasttrackOnly" role="switch" aria-checked="${f.fasttrackOnly ? 'true' : 'false'}">fasttrack만</button>` +
    `<button type="button" class="fchip ${f.fasttrackExclude ? 'on' : ''}" data-toggle="fasttrackExclude" role="switch" aria-checked="${f.fasttrackExclude ? 'true' : 'false'}">fasttrack 제외</button>` +
    `<button type="button" class="fchip ${f.quickFixOnly ? 'on' : ''}" data-toggle="quickFixOnly" role="switch" aria-checked="${f.quickFixOnly ? 'true' : 'false'}">quick fix만</button>` +
    `<button type="button" class="fchip ${f.quickFixExclude ? 'on' : ''}" data-toggle="quickFixExclude" role="switch" aria-checked="${f.quickFixExclude ? 'true' : 'false'}">quick fix 제외</button>` +
    `<button type="button" class="fchip ${f.specUnset ? 'on' : ''}" data-toggle="specUnset" role="switch" aria-checked="${f.specUnset ? 'true' : 'false'}">spec 미지정</button>`;

  host.innerHTML = `
    ${row(chipGroup('projects', '프로젝트', projects.map(v => ({ v, label: v })), f.projects, true))}
    ${row(chipGroup('subSubjects', 'Sub Subject', subSubjects.map(v => ({ v, label: v })), f.subSubjects, true))}
    ${row(chipGroup('priorities', '우선순위', priorities.map(v => ({ v, label: v })), f.priorities, true))}
    ${row(chipGroup('statuses', '상태', statuses.map(v => ({ v, label: v })), f.statuses, true))}
    ${row(viewToggles)}
    ${hasAny ? '<div class="filter-row"><button type="button" class="tlink" data-filter-reset>필터 초기화</button></div>' : ''}
  `;

  host.querySelectorAll('button.fchip[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.filter, v = btn.dataset.value;
      if (btn.dataset.multi) {
        // 복수 선택(OR) — 토글로 추가/제거.
        const arr = Array.isArray(state.filters[k]) ? state.filters[k].slice() : [];
        const i = arr.indexOf(v);
        if (i >= 0) arr.splice(i, 1); else arr.push(v);
        state.filters[k] = arr;
      } else {
        state.filters[k] = state.filters[k] === v ? null : v;
      }
      persistFilters();
      state.page = 1;
      renderFilters();
      renderList();
    });
  });
  host.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.toggle;            // hideLaunched
      state.filters[k] = !state.filters[k];
      // fasttrack '만' 과 '제외' 는 상호 배타 — 하나를 켜면 다른 하나는 끈다.
      if (k === 'fasttrackOnly' && state.filters.fasttrackOnly) state.filters.fasttrackExclude = false;
      if (k === 'fasttrackExclude' && state.filters.fasttrackExclude) state.filters.fasttrackOnly = false;
      // quick fix '만' 과 '제외' 도 상호 배타.
      if (k === 'quickFixOnly' && state.filters.quickFixOnly) state.filters.quickFixExclude = false;
      if (k === 'quickFixExclude' && state.filters.quickFixExclude) state.filters.quickFixOnly = false;
      persistFilters();
      state.page = 1;
      renderFilters();
      renderList();
    });
  });
  const reset = host.querySelector('[data-filter-reset]');
  if (reset) reset.addEventListener('click', () => {
    // chip 필터만 초기화 (론치완료 토글은 보기 설정이라 유지)
    state.filters.projects = [];
    state.filters.subSubjects = [];
    state.filters.priorities = [];
    state.filters.statuses = [];
    persistFilters();
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

function chipGroup(key, label, options, current, multi = false) {
  if (!options.length) return '';
  const sel = multi ? new Set(Array.isArray(current) ? current : []) : null;
  const chips = options.map(opt => {
    const on = multi ? sel.has(opt.v) : current === opt.v;
    const multiAttr = multi ? ` data-multi="1" aria-pressed="${on ? 'true' : 'false'}"` : '';
    return `<button type="button" class="fchip ${on ? 'on' : ''}" data-filter="${escapeAttr(key)}" data-value="${escapeAttr(opt.v)}"${multiAttr}>${escapeHtml(opt.label)}</button>`;
  }).join('');
  return `<span class="flabel">${escapeHtml(label)}</span>${chips}`;
}

/* ─── 필터 / 정렬 (pure) ──────────────────────────────────── */

/** "론치완료 제외" 토글이 숨기는 상태값 (완료/드랍/철회 계열). */
export const HIDDEN_WHEN_LAUNCHED = new Set(['론치완료', 'Done', 'Dropped', '철회/반려/취소']);

/** fasttrack 라벨 보유 여부 (대소문자 무시, fast-track 변형 허용 · fast-track-away 등은 제외). */
export function hasFasttrackLabel(it) {
  return Array.isArray(it.labels) && it.labels.some(l => /^fast-?track$/i.test(String(l).trim()));
}

/**
 * 단일 항목이 필터에 매칭되는지. hiddenKeys 가 주어지면 showHidden off 일 때 숨긴 항목 제외.
 * quickFixKeys: quick_fix 메타가 켜진 키 집합 — quickFixOnly 토글 시 그 집합만 통과.
 * specKeys: spec 메타가 켜진 키 집합 — specUnset 토글 시 그 집합(=spec 지정됨)을 제외.
 */
export function itemMatchesFilters(it, filters, hiddenKeys, quickFixKeys, specKeys) {
  if (filters.hideLaunched && HIDDEN_WHEN_LAUNCHED.has(it.status)) return false;
  if (filters.fasttrackOnly && !hasFasttrackLabel(it)) return false;
  if (filters.fasttrackExclude && hasFasttrackLabel(it)) return false;
  if (filters.quickFixOnly && !(quickFixKeys && quickFixKeys.has(it.key))) return false;
  if (filters.quickFixExclude && quickFixKeys && quickFixKeys.has(it.key)) return false;
  if (filters.specUnset && specKeys && specKeys.has(it.key)) return false;
  if (!filters.showHidden && hiddenKeys && hiddenKeys.has(it.key)) return false;
  // 모든 chip 필터: 복수 선택(배열) OR 매칭. 레거시 단일값도 지원.
  const sel = (arrKey, singleKey) => {
    const a = filters[arrKey];
    if (Array.isArray(a)) return a;
    const s = filters[singleKey];
    return s ? [s] : [];
  };
  const projSel = sel('projects', 'project');
  if (projSel.length && !projSel.includes(it.project)) return false;
  const subSel = sel('subSubjects', 'subSubject');
  if (subSel.length && !subSubjectsOf(it).some(s => subSel.includes(s))) return false;
  const priSel = sel('priorities', 'priority');
  if (priSel.length && !priSel.includes(it.priority)) return false;
  const statSel = sel('statuses', 'status');
  if (statSel.length && !statSel.includes(it.status)) return false;
  return true;
}

export function filterItems(items, filters) {
  return items.filter(it => itemMatchesFilters(it, filters));
}

/**
 * 클러스터 필터 — 대표 또는 멤버 중 하나라도 매칭되면 그 묶음을 노출.
 * (병합된 멤버가 필터에 걸려도 묶음이 사라지지 않게.)
 */
export function filterClusters(reps, filters, membersByRep = new Map(), hiddenKeys, quickFixKeys, specKeys) {
  return reps.filter(rep => {
    if (itemMatchesFilters(rep, filters, hiddenKeys, quickFixKeys, specKeys)) return true;
    return (membersByRep.get(rep.key) || []).some(m => itemMatchesFilters(m, filters, hiddenKeys, quickFixKeys, specKeys));
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
export function sortClusters(reps, sort, metaMap = new Map(), membersByRep = new Map(), dir = 'desc') {
  const arr = reps.slice();
  const mem = (r) => membersByRep.get(r.key) || [];
  const newest = (r) => clusterNewest(r, mem(r));
  if (sort === 'created') {
    arr.sort((a, b) => (dir === 'asc' ? newest(a) - newest(b) : newest(b) - newest(a)));
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

export function sortItems(items, sort, metaMap = new Map(), dir = 'desc') {
  const arr = items.slice();
  const createdDesc = (a, b) => {
    const ta = a.created ? new Date(a.created).getTime() : 0;
    const tb = b.created ? new Date(b.created).getTime() : 0;
    return tb - ta;
  };
  if (sort === 'created') {
    arr.sort((a, b) => (dir === 'asc' ? -createdDesc(a, b) : createdDesc(a, b)));
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
  const quickFixKeys = new Set();
  const specKeys = new Set();
  for (const [k, m] of state.meta) {
    if (m && m.hidden) hiddenKeys.add(String(k));
    if (m && m.quick_fix) quickFixKeys.add(String(k));
    if (m && m.spec) specKeys.add(String(k));
  }
  const eff = { ...state.filters, showHidden: state.hideManageMode };

  const filtered = filterClusters(state.topLevel, eff, state.clusterMembers, hiddenKeys, quickFixKeys, specKeys);
  // 표시 대표 선정: 종료(론치완료·Dropped·철회)·숨김이 아닌 멤버 중 비-ETR 우선(cmpRep).
  // 프로젝트/상태/우선순위 선택 필터로는 대표를 바꾸지 않는다 — 연결된 실제 작업 티켓이 항상 메인.
  state.displayMembers = new Map();
  const displayReps = filtered.map(origRep => {
    const members = state.clusterMembers.get(origRep.key) || [];
    const all = [origRep, ...members];
    const rep = pickDisplayRep(all, eff, hiddenKeys, quickFixKeys, specKeys);
    state.displayMembers.set(rep.key, all.filter(it => it.key !== rep.key));
    return rep;
  });
  const rows = sortClusters(displayReps, state.sort, state.meta, state.displayMembers, state.sortDir);
  updateListCount(rows.length);

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
  bindGroupToggle(host);
  resolveImages(host);   // 첨부 이미지 서명 URL 주입 (비동기)
}

/** "티켓 리스트" 제목 옆 필터 결과 묶음 수 갱신. */
function updateListCount(n) {
  const el = document.querySelector('[data-one-count]');
  if (el) el.textContent = `${n}`;
}

/** 렌더된 첨부 이미지(data-img-path)에 서명 URL 을 비동기 주입. 재렌더 시 stale 무시. */
async function resolveImages(host) {
  const token = (state.renderToken = (state.renderToken || 0) + 1);
  const imgs = [...host.querySelectorAll('img.one-img[data-img-path]')];
  await Promise.all(imgs.map(async (img) => {
    const url = await signedImageUrl(img.dataset.imgPath);
    if (state.renderToken !== token || !img.isConnected) return;   // 더 새 렌더가 시작됨 → skip
    if (url) { img.src = url; const a = img.closest('a.one-img-link'); if (a) a.href = url; }
  }));
}

function applySavedMeta(key, saved) {
  if (saved) {
    state.meta.set(key, saved);
    const i = state.metaRows.findIndex(r => String(r.jira_key) === String(key));
    if (i >= 0) state.metaRows[i] = saved; else state.metaRows.push(saved);
  } else {
    state.meta.delete(key);
    state.metaRows = state.metaRows.filter(r => String(r.jira_key) !== String(key));
  }
}

/** 코멘트/내용에 드롭한 이미지 파일 → Storage 업로드 → 해당 field(image_path|content_image_path) 저장. */
async function onDropImage(key, file, field = 'image_path') {
  if (!state.signedIn || state.imgBusy) return;
  state.imgBusy = true;
  try {
    const path = await uploadTicketImageBlob(key, file);
    try {
      applySavedMeta(key, await upsertOneMeta(key, { [field]: path }, state.metaRows));
    } catch (e) {
      await removeTicketImage(path);   // DB 반영 실패 시 업로드 객체 롤백
      throw e;
    }
    toast({ kicker: key, msg: '이미지 등록됨', kind: 'success' });
    renderList();
  } catch (e) {
    if (e instanceof AuthRequiredError) { state.signedIn = false; renderAuthUi('signedOut'); renderList(); }
    else { console.error('[one-tickets] 이미지 드롭 실패', e); toast({ kicker: '이미지 등록 실패', msg: e.message || String(e), kind: 'alert' }); }
  } finally { state.imgBusy = false; }
}

/** 이미지 삭제 — 해당 field 비우고 Storage 객체 제거. */
async function onDeleteImage(key, field = 'image_path') {
  if (!state.signedIn || state.imgBusy) return;
  if (!window.confirm('첨부 이미지를 삭제할까요?')) return;
  const prev = state.meta.get(key);
  const path = prev && prev[field];
  state.imgBusy = true;
  try {
    applySavedMeta(key, await upsertOneMeta(key, { [field]: '' }, state.metaRows));
    if (path) await removeTicketImage(path);
    toast({ kicker: key, msg: '이미지 삭제됨', kind: 'success' });
    renderList();
  } catch (e) {
    if (e instanceof AuthRequiredError) { state.signedIn = false; renderAuthUi('signedOut'); renderList(); }
    else { console.error('[one-tickets] 이미지 삭제 실패', e); toast({ kicker: '이미지 삭제 실패', msg: e.message || String(e), kind: 'alert' }); }
  } finally { state.imgBusy = false; }
}

const COLS = 9;

function theadHtml() {
  return `
    <thead>
      <tr>
        <th style="width:92px">키</th>
        <th style="width:88px">생성일</th>
        <th style="width:24%">요약</th>
        <th style="width:24%">내용</th>
        <th style="width:150px">상태</th>
        <th style="width:74px">순위</th>
        <th style="width:64px" title="Quick fix 대상">Quick fix</th>
        <th style="width:48px" title="Spec 작성 대상">Spec</th>
        <th style="width:30%">코멘트</th>
        <th style="width:${state.hideManageMode ? 56 : 20}px">${state.hideManageMode ? '숨김' : ''}</th>
      </tr>
    </thead>`;
}

function renderFlat(host, rows) {
  // 페이징 없이 전체 렌더 (개수만 하단 표기).
  host.innerHTML = `
    <table class="tbl">
      ${theadHtml()}
      <tbody>${rows.map(rowHtml).join('')}</tbody>
    </table>
    <div class="pager"><span class="pager-info"><span class="num">${rows.length}</span>개 묶음</span></div>
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
  const expandId = `one-expand-${cssId(it.key)}`;
  const m = state.meta.get(it.key);
  const isHidden = !!(m && m.hidden);
  // 관리 모드에선 pending(체크박스) 상태를 dim 에 반영해 체크박스와 일치.
  const dimHidden = state.hideManageMode && state.hidePending.has(it.key)
    ? state.hidePending.get(it.key)
    : isHidden;
  const cls = `${expandable ? 'ft-row ' : ''}one-row${dimHidden ? ' one-hidden-row' : ''}`;

  return `
    <tr class="${cls}" data-key="${escapeAttr(it.key)}">
      <td>${jiraKeyHtml(it.key)}${expandable ? expandToggleHtml(it.key, open, expandId, members.length) : ''}</td>
      <td><span class="dim num">${escapeHtml(fmtDate(it.created))}</span></td>
      <td class="ft-summary">${summaryCellHtml(it)}</td>
      <td class="one-content-td">${contentCellHtml(it.key)}</td>
      <td><span class="st ${g ? g.stClass : 'st-wait'}">${escapeHtml(it.status || '—')}</span></td>
      <td>${rankCellHtml(it.key)}</td>
      <td class="one-qf-cell">${quickFixCellHtml(it.key)}</td>
      <td class="one-spec-cell">${specCellHtml(it.key)}</td>
      <td>${commentCellHtml(it.key)}</td>
      <td class="one-row-actions">${hideBtnHtml(it.key)}</td>
    </tr>
    ${expandable && open ? expandHtml(it, expandId) : ''}
  `;
}

/** 키 번호 밑 연결 티켓 펼치기/접기 버튼. */
function expandToggleHtml(key, open, expandId, count) {
  return `<button type="button" class="one-expand-btn tlink" data-key="${escapeAttr(key)}"
            aria-expanded="${open ? 'true' : 'false'}" aria-controls="${escapeAttr(expandId)}">
            <span class="caret ${open ? 'open' : ''}" aria-hidden="true">›</span>연결 ${count}건 ${open ? '접기' : '펼치기'}</button>`;
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
    <textarea class="one-summary-input" rows="1" data-key="${escapeAttr(it.key)}"
              placeholder="요약" aria-label="${escapeAttr(it.key)} 요약 (대시보드 전용)">${escapeHtml(display)}</textarea>
    ${override ? '<span class="one-edited" title="대시보드에서 수정된 요약 (Jira 미반영)">✎ 수정됨</span>' : ''}${chips}`;
}

/** 내용 셀 — 대시보드 전용 간략 내용(편집형). 기본값은 one-content.json, 편집 시 meta.content override. 이미지 첨부 지원. */
function contentCellHtml(key) {
  const m = state.meta.get(key);
  const override = m && m.content != null ? String(m.content) : '';
  const def = (state.contentDefaults && state.contentDefaults.get(key)) || '';
  const val = override || def;
  const linked = val ? linkifyComment(val) : '';
  if (!state.signedIn) {
    return `<div class="one-content-view readonly">${linked || '<span class="muted">—</span>'}</div>${imageAreaHtml(key, 'content_image_path')}`;
  }
  const hasImg = !!(m && m.content_image_path);
  const addBtn = hasImg ? '' :
    `<button type="button" class="one-img-add tlink" data-key="${escapeAttr(key)}" data-field="content_image_path">+ 이미지</button>
     <input type="file" class="one-img-file" data-key="${escapeAttr(key)}" data-field="content_image_path"
            accept="image/png,image/jpeg,image/gif,image/webp" hidden />`;
  // 표시(URL 링크, 클릭→편집) + 숨김 textarea(편집).
  return `<div class="one-content-cell" data-key="${escapeAttr(key)}">
    <div class="one-content-view" data-key="${escapeAttr(key)}" tabindex="0" role="button"
         title="클릭하여 편집 · 이미지 파일을 끌어다 놓으면 첨부됩니다">${linked || CONTENT_PH}</div>
    <textarea class="one-content-input" rows="1" hidden data-key="${escapeAttr(key)}"
              placeholder="내용" aria-label="${escapeAttr(key)} 내용 (대시보드 전용)">${escapeHtml(val)}</textarea>
    ${addBtn}
  </div>${imageAreaHtml(key, 'content_image_path')}`;
}

const CONTENT_PH = '<span class="muted">내용 입력…</span>';

/** Quick fix 체크박스 셀. */
function quickFixCellHtml(key) {
  const m = state.meta.get(key);
  const checked = m && m.quick_fix ? 'checked' : '';
  const dis = state.signedIn ? '' : 'disabled';
  return `<input type="checkbox" class="one-quickfix" data-key="${escapeAttr(key)}" ${checked} ${dis}
            aria-label="${escapeAttr(key)} Quick fix 대상" />`;
}

/** Spec 작성 대상 체크박스 셀. */
function specCellHtml(key) {
  const m = state.meta.get(key);
  const checked = m && m.spec ? 'checked' : '';
  const dis = state.signedIn ? '' : 'disabled';
  return `<input type="checkbox" class="one-spec" data-key="${escapeAttr(key)}" ${checked} ${dis}
            aria-label="${escapeAttr(key)} Spec 작성 대상" />`;
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

/** 코멘트 텍스트의 URL 을 클릭 가능한 링크로(그 텍스트에만). 나머지는 escape + 줄바꿈 보존. */
function linkifyComment(text) {
  const s = String(text ?? '');
  const re = /(https?:\/\/[^\s<]+)/g;
  let out = '', last = 0, m;
  while ((m = re.exec(s)) !== null) {
    let url = m[0];
    // 끝에 붙은 문장부호는 링크에서 제외(예: "...page).")
    const trail = url.match(/[.,;:!?)\]]+$/);
    const tail = trail ? trail[0] : '';
    if (tail) url = url.slice(0, url.length - tail.length);
    out += escapeHtml(s.slice(last, m.index));
    if (url) {
      out += `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" class="one-comment-link">${escapeHtml(url)}</a>`;
    }
    out += escapeHtml(tail);
    last = m.index + m[0].length;
  }
  out += escapeHtml(s.slice(last));
  return out.replace(/\n/g, '<br>');
}

const COMMENT_PH = '<span class="muted">코멘트 입력…</span>';

function commentCellHtml(key) {
  const m = state.meta.get(key);
  const val = m && m.comment != null ? String(m.comment) : '';
  const linked = val ? linkifyComment(val) : '';
  // 표시: URL 링크. 미로그인은 표시 전용.
  if (!state.signedIn) {
    return `<div class="one-comment-view readonly">${linked || '<span class="muted">—</span>'}</div>${imageAreaHtml(key)}`;
  }
  // 로그인: 표시(클릭→편집) + 숨김 textarea(편집). 이미지는 셀에 끌어다 놓기.
  return `<div class="one-comment-cell" data-key="${escapeAttr(key)}">
    <div class="one-comment-view" data-key="${escapeAttr(key)}" tabindex="0" role="button"
         title="클릭하여 편집 · 이미지 파일을 끌어다 놓으면 첨부됩니다">${linked || COMMENT_PH}</div>
    <textarea class="one-comment-input" rows="2" hidden
              data-key="${escapeAttr(key)}" placeholder="코멘트 입력…"
              aria-label="${escapeAttr(key)} 코멘트">${escapeHtml(val)}</textarea>
  </div>${imageAreaHtml(key)}`;
}

/** 코멘트/내용 하단 이미지 영역 — 첨부 이미지(서명 URL은 렌더 후 주입) + 삭제. field 로 대상 구분. */
function imageAreaHtml(key, field = 'image_path') {
  const m = state.meta.get(key);
  const path = m && m[field] ? String(m[field]) : '';
  if (path) {
    const btn = state.signedIn
      ? `<button type="button" class="one-img-del tlink" data-key="${escapeAttr(key)}" data-field="${escapeAttr(field)}">이미지 삭제</button>`
      : '';
    return `<div class="one-img-area">
      <a class="one-img-link" data-img-path="${escapeAttr(path)}" target="_blank" rel="noopener noreferrer">
        <img class="one-img" data-img-path="${escapeAttr(path)}" alt="첨부 이미지" loading="lazy" />
      </a>
      ${btn}
    </div>`;
  }
  return '';   // 이미지 없을 땐 버튼 없음 — 코멘트/내용에 이미지 파일을 드래그하면 첨부됨
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

/** textarea 높이를 내용에 맞춰 자동 조정 (요약 줄바꿈 표시). */
function autoGrowTextarea(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

/* ─── 행 펼침 / 그룹 펼침 ─────────────────────────────────── */

function bindRowToggle(host) {
  // 행 전체 클릭 대신 키 번호 밑 '연결 N건 펼치기/접기' 버튼으로만 토글.
  host.querySelectorAll('.one-expand-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleRow(btn.dataset.key);
    });
  });
}

function toggleRow(key) {
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

/* ─── 코멘트 / 순위 입력 ──────────────────────────────────── */

function bindMetaInputs(host) {
  host.querySelectorAll('.one-rank-input').forEach(inp => {
    inp.addEventListener('change', () => saveMeta(inp.dataset.key, { manual_rank: inp.value }, { resort: true }));
  });
  // 요약 인라인 편집 (대시보드 전용, 줄바꿈 자동 높이). 원본 Jira 요약과 같거나 비우면 override 해제.
  host.querySelectorAll('.one-summary-input').forEach(inp => {
    autoGrowTextarea(inp);                                   // 초기 높이 = 내용 높이
    inp.addEventListener('input', () => autoGrowTextarea(inp));
    inp.addEventListener('change', () => {
      const key = inp.dataset.key;
      const orig = (state.itemsByKey.get(key) || {}).summary || '';
      const v = inp.value.trim();
      saveMeta(key, { summary_override: v === orig ? '' : v }, { rerender: true });
    });
    // Enter 는 저장(줄바꿈 삽입 방지) — 요약은 한 줄 텍스트가 wrap 되는 형태.
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
  });
  // Quick fix 체크박스
  host.querySelectorAll('.one-quickfix').forEach(cb => {
    cb.addEventListener('change', () => saveMeta(cb.dataset.key, { quick_fix: cb.checked }));
  });
  // Spec 체크박스
  host.querySelectorAll('.one-spec').forEach(cb => {
    cb.addEventListener('change', () => saveMeta(cb.dataset.key, { spec: cb.checked }));
  });
  // 코멘트 — 표시(URL 링크 클릭 가능) / 편집(textarea) 분리. 클릭→편집, blur→표시 복귀.
  host.querySelectorAll('.one-comment-cell').forEach(cell => {
    const view = cell.querySelector('.one-comment-view');
    const ta = cell.querySelector('.one-comment-input');
    if (!view || !ta) return;
    const enterEdit = () => {
      view.hidden = true;
      ta.hidden = false;
      ta.focus();
      const n = ta.value.length;
      try { ta.setSelectionRange(n, n); } catch { /* noop */ }
    };
    // 표시 → 편집 (링크 클릭은 편집 진입 대신 링크 이동)
    view.addEventListener('click', (e) => { if (e.target.closest('a')) return; enterEdit(); });
    view.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enterEdit(); }
    });
    ta.addEventListener('change', () => saveMeta(ta.dataset.key, { comment: ta.value }));
    // 편집 종료 → 표시 갱신(링크 반영)
    ta.addEventListener('blur', () => {
      view.innerHTML = ta.value ? linkifyComment(ta.value) : COMMENT_PH;
      ta.hidden = true;
      view.hidden = false;
    });
    // 이미지 파일 드래그앤드랍 — 셀에 드롭(편집 진입 불필요).
    const draggingFile = (e) => [...(e.dataTransfer?.items || [])].some(it => it.kind === 'file');
    cell.addEventListener('dragover', (e) => {
      if (!draggingFile(e)) return;
      e.preventDefault();                       // 파일 드롭 허용 (브라우저 기본 동작 차단)
      e.dataTransfer.dropEffect = 'copy';
      cell.classList.add('drag-over');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
    cell.addEventListener('drop', (e) => {
      const file = [...(e.dataTransfer?.files || [])].find(f => /^image\//.test(f.type));
      if (!file) return;                        // 이미지 아니면 기본 동작(텍스트 등)
      e.preventDefault();
      cell.classList.remove('drag-over');
      onDropImage(cell.dataset.key, file);
    });
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
  // 내용 — 편집형(자동 높이 textarea). 기본값(one-content.json)과 같거나 비우면 override 해제. 이미지 드래그앤드랍.
  host.querySelectorAll('.one-content-cell').forEach(cell => {
    const ta = cell.querySelector('.one-content-input');
    if (!ta) return;
    const view = cell.querySelector('.one-content-view');
    // 표시 → 편집 (링크 클릭은 편집 진입 대신 링크 이동)
    if (view) {
      const enterEdit = () => {
        view.hidden = true;
        ta.hidden = false;
        autoGrowTextarea(ta);
        ta.focus();
        const n = ta.value.length;
        try { ta.setSelectionRange(n, n); } catch { /* noop */ }
      };
      view.addEventListener('click', (e) => { if (e.target.closest('a')) return; enterEdit(); });
      view.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enterEdit(); }
      });
      ta.addEventListener('blur', () => {
        view.innerHTML = ta.value ? linkifyComment(ta.value) : CONTENT_PH;
        ta.hidden = true;
        view.hidden = false;
      });
    }
    ta.addEventListener('input', () => autoGrowTextarea(ta));
    ta.addEventListener('change', () => {
      const key = ta.dataset.key;
      const def = ((state.contentDefaults && state.contentDefaults.get(key)) || '').trim();
      const v = ta.value.trim();
      saveMeta(key, { content: v === def ? '' : ta.value });   // 기본값과 동일/공백 → override 해제
    });
    // 이미지 파일 드래그앤드랍 → content_image_path
    const draggingFile = (e) => [...(e.dataTransfer?.items || [])].some(it => it.kind === 'file');
    cell.addEventListener('dragover', (e) => {
      if (!draggingFile(e)) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
      cell.classList.add('drag-over');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
    cell.addEventListener('drop', (e) => {
      const file = [...(e.dataTransfer?.files || [])].find(f => /^image\//.test(f.type));
      if (!file) return;
      e.preventDefault(); cell.classList.remove('drag-over');
      onDropImage(cell.dataset.key, file, 'content_image_path');
    });
    // "+ 이미지" 버튼 → 파일 선택 → 업로드
    const addBtn = cell.querySelector('.one-img-add');
    const fileInput = cell.querySelector('.one-img-file');
    if (addBtn && fileInput) {
      addBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
      fileInput.addEventListener('change', () => {
        const f = fileInput.files && fileInput.files[0];
        if (f) onDropImage(fileInput.dataset.key, f, fileInput.dataset.field || 'content_image_path');
        fileInput.value = '';   // 같은 파일 재선택 허용
      });
    }
  });
  host.querySelectorAll('.one-img-del').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); onDeleteImage(btn.dataset.key, btn.dataset.field || 'image_path'); });
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
  groupByMainSubject, rankOf, cssId, subSubjectsOf, linkifyComment, pickDisplayRep,
};
