/* =========================================================
   pages/one-tickets.js — One 티켓 관리
   ETR / MSSCXTF / FT / TM / CBP / PBO 의 'one' 라벨 티켓을 한 화면에서 관리.

   - 읽기 데이터: data/jira/one-tickets.json (없으면 기존 파일 union fallback)
   - ETR 티켓에 연결된 PEL·MSSCXTF·FT·TM 은 top-level 중복 제거 + 펼침으로 "하나로" 관리
   - 뷰: 전체 리스트 / Main Subject 그룹
   - 필터: 프로젝트 / 라벨 / 상태 / 우선순위 (localStorage UI state)
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

const TOP_PROJECTS = ['ETR', 'MSSCXTF', 'FT', 'TM', 'CBP', 'PBO'];
const PAGE_SIZE = 25;
const NO_SUBJECT = '(미지정)';
const FILTERS_KEY = 'oneTickets.filters';
const VIEW_KEY = 'oneTickets.view';

const $ = (id) => document.getElementById(id);

const state = {
  rootRel: '',
  items: [],          // 정규화된 one 티켓 전체 (linkedTickets 포함)
  itemsByKey: new Map(),
  linkedSet: new Set(),
  topLevel: [],       // dedup 된 top-level (ETR + 비연결)
  signedIn: false,
  email: null,
  meta: new Map(),    // jira_key → {manual_rank, comment, _rowNum}
  metaRows: [],       // loadOneMeta 원본 (upsert 시 _rowNum 탐색)
  filters: { project: null, label: null, status: null, priority: null, subSubject: null },
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
    { project: null, label: null, status: null, priority: null, subSubject: null },
    scoped(FILTERS_KEY).get({}) || {},
  );
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
  state.items = items.map(normalizeItem);
  recompute();
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
  state.linkedSet = linkedKeySet(state.items);
  state.topLevel = topLevelItems(state.items, state.linkedSet);
}

/** 모든 ETR 항목의 연결 티켓 key 집합. */
export function linkedKeySet(items) {
  const set = new Set();
  for (const it of items) {
    if (it.project !== 'ETR') continue;
    for (const l of (it.linkedTickets || [])) {
      if (l && l.key) set.add(l.key);
    }
  }
  return set;
}

/** ETR 이거나, 어떤 ETR 의 연결 티켓이 아닌 항목만 top-level. */
export function topLevelItems(items, linked) {
  return items.filter(it => it.project === 'ETR' || !linked.has(it.key));
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
  const etr = state.topLevel.filter(it => it.project === 'ETR').length;
  lede.innerHTML =
    `<strong class="num">${total}</strong>개 묶음 ` +
    `(전체 <span class="num">${state.items.length}</span>건, ETR <span class="num">${etr}</span>건). ` +
    `ETR 행 클릭 시 연결 티켓 펼침. 로그인하면 코멘트·우선순위 편집.`;
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
}

function renderFilters() {
  const host = $('one-filters');
  if (!host) return;
  const base = state.topLevel;
  if (!base.length) { host.innerHTML = ''; return; }

  const projects = TOP_PROJECTS.filter(p => base.some(it => it.project === p));
  const subSubjects = [...new Set(base.flatMap(subSubjectsOf).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ko'));
  const labels = [...new Set(base.flatMap(it => it.labels).filter(l => l && l !== 'one'))]
    .sort((a, b) => a.localeCompare(b, 'ko'));
  const statuses = [...new Set(base.map(it => it.status).filter(Boolean))].sort();
  const priorities = [...new Set(base.map(it => it.priority).filter(Boolean))].sort();

  const f = state.filters;
  const hasAny = f.project || f.label || f.status || f.priority || f.subSubject;

  host.innerHTML = `
    ${chipGroup('project', '프로젝트', projects.map(v => ({ v, label: v })), f.project)}
    ${chipGroup('subSubject', 'Sub Subject', subSubjects.map(v => ({ v, label: v })), f.subSubject)}
    ${chipGroup('label', '라벨', labels.map(v => ({ v, label: v })), f.label)}
    ${chipGroup('status', '상태', statuses.map(v => ({ v, label: v })), f.status)}
    ${chipGroup('priority', '우선순위', priorities.map(v => ({ v, label: v })), f.priority)}
    ${hasAny ? '<button type="button" class="tlink" data-filter-reset>필터 초기화</button>' : ''}
  `;
  host.querySelectorAll('button.fchip').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.filter;
      const v = btn.dataset.value;
      state.filters[k] = state.filters[k] === v ? null : v;
      scoped(FILTERS_KEY).set(state.filters);
      state.page = 1;
      renderFilters();
      renderList();
    });
  });
  const reset = host.querySelector('[data-filter-reset]');
  if (reset) reset.addEventListener('click', () => {
    state.filters = { project: null, label: null, status: null, priority: null, subSubject: null };
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

export function filterItems(items, filters) {
  return items.filter(it => {
    if (filters.project && it.project !== filters.project) return false;
    if (filters.subSubject && !subSubjectsOf(it).includes(filters.subSubject)) return false;
    if (filters.label && !(it.labels || []).includes(filters.label)) return false;
    if (filters.status && it.status !== filters.status) return false;
    if (filters.priority && it.priority !== filters.priority) return false;
    return true;
  });
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

/** mainSubject 기준 그룹핑. subject 없으면 NO_SUBJECT. 건수 desc, 미지정 마지막. */
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
    return b.items.length - a.items.length || a.subject.localeCompare(b.subject, 'ko');
  });
  return groups;
}

/* ─── 리스트 렌더 ─────────────────────────────────────────── */

function renderList() {
  const host = $('one-table');
  if (!host) return;
  const rows = sortItems(filterItems(state.topLevel, state.filters), state.sort, state.meta);

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

const COLS = 8;

function theadHtml() {
  return `
    <thead>
      <tr>
        <th style="width:92px">키</th>
        <th>요약</th>
        <th style="width:64px">프로젝트</th>
        <th style="width:150px">상태</th>
        <th style="width:48px">우선</th>
        <th style="width:74px">순위</th>
        <th style="width:64px" title="Quick fix 대상">Quick fix</th>
        <th style="width:220px">코멘트</th>
        <th style="width:20px"></th>
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
  const expandable = it.project === 'ETR' && (it.linkedTickets || []).length > 0;
  const open = state.expanded.has(it.key);
  const g = STATUS_GROUPS.find(x => x.id === statusGroup(it));
  const priCls = `pri-${(it.priority || '').toLowerCase() || 'p3'}`;
  const expandId = `one-expand-${cssId(it.key)}`;

  const rowAttrs = expandable
    ? `class="ft-row one-row" data-key="${escapeAttr(it.key)}" role="button" tabindex="0" aria-expanded="${open ? 'true' : 'false'}" aria-controls="${expandId}"`
    : `class="one-row" data-key="${escapeAttr(it.key)}"`;

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
      <td>${expandable ? `<span class="caret ${open ? 'open' : ''}" aria-hidden="true">›</span>` : ''}</td>
    </tr>
    ${expandable && open ? expandHtml(it, expandId) : ''}
  `;
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
  const linked = it.linkedTickets || [];
  const rows = linked.map(l => {
    const full = state.itemsByKey.get(l.key) || l;
    const g = STATUS_GROUPS.find(x => x.id === statusGroup(full));
    const assignee = (full.assignee && full.assignee.name) || (l.assignee && l.assignee.name) || '—';
    return `
      <div class="linked-row">
        ${jiraKeyHtml(l.key)}
        <span class="ft-link-summary">${escapeHtml(full.summary || l.summary || '')}</span>
        <span class="st ${g ? g.stClass : 'st-wait'}">${escapeHtml(full.status || l.status || '—')}</span>
        <span class="who"><span class="who-dot"></span>${escapeHtml(assignee)}</span>
      </div>
    `;
  }).join('');
  return `
    <tr class="ft-expand" role="presentation"><td colspan="${COLS}" role="presentation" class="ft-expand-cell">
      <section id="${expandId}" class="expand" role="region" aria-label="연결 티켓 ${linked.length}건">
        <div class="expand-label">연결 티켓 · ${linked.length}건 (하나로 관리)</div>
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
  renderAuthUi('signedOut');
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
  // 입력 중이면 보류(편집 clobber 방지). 최대 ~8s 후 보류.
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
    if (rtRetries++ < 10) { rtTimer = setTimeout(attemptRealtimeReload, 800); }
    else { rtRetries = 0; console.warn('[one-tickets] realtime reload 보류 — 편집 중. 다음 변경/새로고침 시 반영'); }
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
  normalizeItem, buildFromFallback, linkedKeySet, topLevelItems,
  filterItems, sortItems, groupByMainSubject, rankOf, cssId, subSubjectsOf,
};
