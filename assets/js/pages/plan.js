/* =========================================================
   pages/plan.js — Plan 페이지 (PRD v2 §4)
   - Google Sheets API 직접 호출로 plan sheet read/write
   - Jira data/jira/all-tickets.json 과 join (jira_key 기준)
   - 인라인 셀 편집은 sub-cycle C 에서 추가
   ========================================================= */

import { showLoading, showError, emptyHtml } from '../states.js';
import { loadJson } from '../fetch-data.js';
import { auth, sheets, rowsToObjects, nowIso, AuthRequiredError, SPREADSHEET_ID } from '../api/sheets.js';
import { jiraKeyHtml } from '../jira-link.js';
import { fmtDate } from '../format.js';
import { STATUS_GROUPS, statusGroup } from '../charts.js';
import { escapeHtml, escapeAttr } from '../escape.js';
import { scoped } from '../storage.js';
import { attachModal } from '../modal.js';

const PLAN_RANGE = 'plan!A1:Z2000';
const PLAN_KEY = 'jira_key';
const ROLE_FIELDS = ['pm', 'pd', 'be', 'fe', 'me', 'md'];

const FILTERS_KEY = 'plan.filters';
const COLS_KEY = 'plan.columns';
const DEFAULT_FILTERS = {
  project: null,
  statusGroup: null,
  mainSubject: null,
  assignment: 'all',  // all | unassigned | assigned
  duedate: 'all',     // all | d7 | d14 | d30
};
const DUEDATE_OPTIONS = [
  { v: 'all', label: '전체' },
  { v: 'd7',  label: '7일 이내' },
  { v: 'd14', label: '14일 이내' },
  { v: 'd30', label: '30일 이내' },
];
const ASSIGNMENT_OPTIONS = [
  { v: 'all',        label: '전체' },
  { v: 'unassigned', label: '미배치' },
  { v: 'assigned',   label: '배치 완료' },
];

/* ─── DOM refs (lazy) ─────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

/* ─── 상태 ──────────────────────────────────────────────────────────── */
const state = {
  rootRel: '',
  signedIn: false,
  items: [],          // joined+filtered+sorted items (Jira + plan), duedate ≥ today-7d 적용 후
  planHeader: [],     // plan sheet 헤더 (실시간 fetch)
  jiraLastSync: null,
  filters: { ...DEFAULT_FILTERS },
  visibleCols: null,  // null = 기본값 (DEFAULT_VISIBLE_COLS) 사용
  colsModal: null,    // attachModal 컨트롤러
};

/* =========================================================
   Pure helpers (테스트 대상)
   ========================================================= */

/**
 * Jira 티켓과 plan sheet 행을 jira_key 기준으로 left join.
 * Jira 티켓 모두 유지, plan 정보는 매칭되는 행이 있으면 채우고 없으면 빈 문자열.
 *
 * @param {Array<object>} jiraItems data/jira/all-tickets.json 의 items
 * @param {Array<Array<any>>} planRows sheet API 가 돌려준 2D values (헤더 포함)
 * @returns {Array<object>} { jiraKey, summary, project, status, statusCategory, priority, dueDate, pm, pd, be, fe, me, md, plan_start, plan_end, last_updated_at, _planRowIndex }
 */
export function joinJiraWithPlan(jiraItems, planRows) {
  if (!Array.isArray(jiraItems)) return [];
  const rows = Array.isArray(planRows) ? planRows : [];
  const header = rows[0] || [];
  const dataRows = rows.slice(1);
  const planObjects = rowsToObjects(dataRows, header);

  // jira_key → planObject + 행 인덱스 (sheet rowNum = index + 2, 헤더가 row 1)
  const planIdx = new Map();
  for (let i = 0; i < planObjects.length; i++) {
    const k = planObjects[i][PLAN_KEY];
    if (k) planIdx.set(String(k), { obj: planObjects[i], rowNum: i + 2 });
  }

  return jiraItems.map((j) => {
    const match = planIdx.get(String(j.key));
    const p = match ? match.obj : {};
    return {
      jiraKey: j.key,
      summary: j.summary || '',
      project: j.project || '',
      status: j.status || '',
      statusCategory: j.statusCategory || '',
      priority: j.priority || '',
      dueDate: j.dueDate || null,
      mainSubject: j.mainSubject || '',
      // plan fields
      pm: p.pm || '',
      pd: p.pd || '',
      be: p.be || '',
      fe: p.fe || '',
      me: p.me || '',
      md: p.md || '',
      plan_start: p.plan_start || '',
      plan_end: p.plan_end || '',
      last_updated_at: p.last_updated_at || '',
      _planRowNum: match ? match.rowNum : null,  // 미존재 = append 대상
    };
  });
}

/**
 * 필터 적용. items 는 이미 duedate ≥ today-7d 통과한 목록.
 * filters 각 슬롯이 null/'all' 이면 해당 그룹은 무시.
 */
export function applyFilters(items, filters, now = new Date()) {
  const f = { ...DEFAULT_FILTERS, ...(filters || {}) };
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return items.filter((it) => {
    if (f.project && it.project !== f.project) return false;
    if (f.statusGroup && statusGroup(it) !== f.statusGroup) return false;
    if (f.mainSubject && (it.mainSubject || '') !== f.mainSubject) return false;
    if (f.assignment === 'unassigned' && !isUnassigned(it)) return false;
    if (f.assignment === 'assigned' && isUnassigned(it)) return false;
    if (f.duedate && f.duedate !== 'all') {
      const days = { d7: 7, d14: 14, d30: 30 }[f.duedate];
      if (days != null) {
        if (!it.dueDate) return false;
        const t = new Date(it.dueDate);
        if (isNaN(t)) return false;
        const max = new Date(today);
        max.setDate(max.getDate() + days);
        if (t > max) return false;
      }
    }
    return true;
  });
}

/** 활성 프로젝트 키 목록 (정렬). */
export function availableProjects(items) {
  return [...new Set(items.map((it) => it.project).filter(Boolean))].sort();
}

/** 활성 메인주제 목록 (정렬). 빈 문자열 제외. */
export function availableMainSubjects(items) {
  return [...new Set(items.map((it) => it.mainSubject).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
}

/** 활성 statusGroup 목록 (STATUS_GROUPS 순서 유지). */
export function availableStatusGroups(items) {
  const present = new Set(items.map((it) => statusGroup(it)));
  return STATUS_GROUPS.filter((g) => present.has(g.id));
}

/* ─── 편집 헬퍼 (pure, 테스트 대상) ───────────────────────────────── */

/**
 * 0-based 컬럼 인덱스 → 스프레드시트 컬럼 letter ('A', 'B', ..., 'Z', 'AA', ...).
 * 음수는 빈 문자열.
 */
export function columnIndexToLetter(n) {
  if (typeof n !== 'number' || n < 0 || !Number.isFinite(n)) return '';
  n = Math.floor(n);
  let s = '';
  // 1-based 변환: 0→A, 25→Z, 26→AA
  while (true) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return s;
}

/** 헤더 배열에서 field 의 시트 컬럼 letter 를 구함. 없으면 null. */
export function sheetColLetter(field, planHeader) {
  if (!Array.isArray(planHeader)) return null;
  const idx = planHeader.indexOf(field);
  if (idx < 0) return null;
  return columnIndexToLetter(idx);
}

/**
 * 새 plan 행 append 시 보낼 값 배열. planHeader 순서대로.
 * editedField 자리에 editedValue, last_updated_at 에 now, jira_key 에 item.jiraKey, 그 외는 item 의 기존 plan 필드.
 */
export function buildRowForAppend(item, planHeader, editedField, editedValue, now) {
  if (!Array.isArray(planHeader)) return [];
  return planHeader.map((field) => {
    if (field === 'jira_key') return item.jiraKey || '';
    if (field === 'last_updated_at') return now;
    if (field === editedField) return editedValue;
    return item[field] != null ? String(item[field]) : '';
  });
}

/** sheets API 응답의 updatedRange ("plan!A5:J5") 에서 행 번호 파싱. 실패 시 null. */
export function parseRowFromRange(range) {
  if (typeof range !== 'string') return null;
  const m = /![A-Z]+(\d+)/.exec(range);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * 편집 셀 값 검증. valid 면 null, invalid 면 사용자 메시지.
 *   date: YYYY-MM-DD 또는 빈 문자열만 허용
 *   text: 무엇이든 허용 (앞뒤 trim 은 caller 책임)
 */
export function validateCellValue(type, value) {
  if (value === '' || value == null) return null;
  if (type === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'YYYY-MM-DD 형식이 아닙니다';
    const [y, m, d] = value.split('-').map(Number);
    const t = new Date(value);
    if (isNaN(t)) return '유효하지 않은 날짜입니다';
    // YYYY-MM-DD 는 UTC 로 파싱됨. silent rollover (예: 2026-02-30 → 3-02) 차단.
    if (t.getUTCFullYear() !== y || t.getUTCMonth() + 1 !== m || t.getUTCDate() !== d) {
      return '유효하지 않은 날짜입니다';
    }
  }
  return null;
}

/**
 * duedate 필터 — `dueDate >= today - 7d`. dueDate 가 null/잘못된 형식이면 제외.
 * PRD §3.1.
 */
export function filterByDuedate(items, now = new Date(), daysAgo = 7) {
  const threshold = new Date(now);
  threshold.setHours(0, 0, 0, 0);
  threshold.setDate(threshold.getDate() - daysAgo);
  return items.filter((it) => {
    if (!it.dueDate) return false;
    const t = new Date(it.dueDate);
    if (isNaN(t)) return false;
    return t >= threshold;
  });
}

/** dueDate 오름차순, null/invalid 는 뒤. PRD §3.1. */
export function sortByDuedate(items) {
  const arr = items.slice();
  arr.sort((a, b) => {
    const ta = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const tb = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return ta - tb;
  });
  return arr;
}

/** PRD §3.6 상단 요약 4 카드 카운트. */
export function statsFromItems(items, now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const in7d = new Date(today);
  in7d.setDate(in7d.getDate() + 7);
  let total = items.length;
  let unassigned = 0;
  let noStart = 0;
  let due7d = 0;
  for (const it of items) {
    if (isUnassigned(it)) unassigned++;
    if (!it.plan_start) noStart++;
    if (it.dueDate) {
      const t = new Date(it.dueDate);
      if (!isNaN(t) && t >= today && t <= in7d) due7d++;
    }
  }
  return { total, unassigned, noStart, due7d };
}

/** ROLE_FIELDS 중 하나라도 빈 값이면 미배치. */
export function isUnassigned(item) {
  if (!item) return true;
  return ROLE_FIELDS.some((f) => !item[f]);
}

/* =========================================================
   Render
   ========================================================= */

export async function renderPlan({ rootRel = '' } = {}) {
  state.rootRel = rootRel;
  // localStorage 복원 — UI state 만 (PRD §7)
  state.filters = { ...DEFAULT_FILTERS, ...(scoped(FILTERS_KEY).get({}) || {}) };
  const savedCols = scoped(COLS_KEY).get(null);
  state.visibleCols = Array.isArray(savedCols) ? savedCols : null;

  const tableHost = $('sec-table');
  showLoading(tableHost, { rows: 6, title: false });
  bindAuthUi();
  bindRefresh();
  bindColsModal();
  // sessionStorage 캐시가 살아있으면 바로 통과 — 페이지 이동 시 popup 재발 차단.
  if (auth.isSignedIn()) {
    state.signedIn = true;
    renderAuthUi();
    await loadAndRender();
    return;
  }
  // 첫 진입은 silent 만 시도 — 실패 시 popup 자동 안 띄우고 "Google 로그인" 버튼 노출.
  try {
    await auth.signIn({ silent: true });
    state.signedIn = true;
  } catch (e) {
    state.signedIn = false;
    if (e instanceof AuthRequiredError) {
      renderAuthUi();
      showAuthGated(tableHost);
      return;
    }
    console.error('[plan] auth 예외', e);
    showError(tableHost, e);
    renderAuthUi();
    return;
  }
  renderAuthUi();
  await loadAndRender();
}

async function loadAndRender() {
  const tableHost = $('sec-table');
  showLoading(tableHost, { rows: 6, title: false });

  let jiraData, planRes;
  try {
    [jiraData, planRes] = await Promise.all([
      loadJson(`${state.rootRel}data/jira/all-tickets.json`),
      sheets.read(SPREADSHEET_ID, PLAN_RANGE),
    ]);
  } catch (e) {
    console.error('[plan] 데이터 로드 실패', e);
    showError(tableHost, e);
    return;
  }

  state.jiraLastSync = jiraData.lastSync || null;
  state.planHeader = (planRes.values && planRes.values[0]) || [];
  const planRows = planRes.values || [];
  const joined = joinJiraWithPlan(jiraData.items || [], planRows);
  const filtered = filterByDuedate(joined, new Date(), 7);
  const sorted = sortByDuedate(filtered);
  state.items = sorted;

  updateStats(sorted);
  renderFilters();
  updateTableView();
  enableRefresh(true);
}

function updateTableView() {
  const tableHost = $('sec-table');
  if (!tableHost) return;
  const visible = applyFilters(state.items, state.filters);
  updateListCount(visible.length);
  renderTable(visible, tableHost);
}

function updateStats(items) {
  const sec = $('sec-stats');
  if (!sec) return;
  const s = statsFromItems(items);
  for (const [k, v] of Object.entries({ total: s.total, unassigned: s.unassigned, 'no-start': s.noStart, due7d: s.due7d })) {
    const el = sec.querySelector(`[data-stat="${k}"]`);
    if (el) el.textContent = String(v);
  }
  sec.hidden = false;
}

function updateListCount(n) {
  const el = document.querySelector('[data-list-count]');
  if (el) el.textContent = String(n);
}

/* ─── 테이블 (read-only, 14 컬럼) ─────────────────────────────────── */
// PRD §3.4: 기본 ON 1~9 (key~PM), OFF 10~14 (PD/BE/FE/ME/MD).
// key 는 required = true 로 토글 불가.

const COLUMNS = [
  { id: 'jiraKey',    label: '키',        editable: false, width: '90px',                required: true,  defaultOn: true  },
  { id: 'project',    label: '프로젝트',   editable: false, width: '70px',                                  defaultOn: true  },
  { id: 'summary',    label: '제목',       editable: false, width: 'minmax(220px, 1fr)',                   defaultOn: true  },
  { id: 'status',     label: '상태',       editable: false, width: '120px',                                 defaultOn: true  },
  { id: 'priority',   label: '우선',       editable: false, width: '60px',                                  defaultOn: true  },
  { id: 'dueDate',    label: 'Jira 마감',  editable: false, width: '90px',                                  defaultOn: true  },
  { id: 'plan_start', label: '시작일',     editable: true,  width: '110px', type: 'date',                   defaultOn: true  },
  { id: 'plan_end',   label: '종료일',     editable: true,  width: '110px', type: 'date',                   defaultOn: true  },
  { id: 'pm',         label: 'PM',         editable: true,  width: '90px',  type: 'text',                   defaultOn: true  },
  { id: 'pd',         label: 'PD',         editable: true,  width: '90px',  type: 'text',                   defaultOn: false },
  { id: 'be',         label: 'BE',         editable: true,  width: '90px',  type: 'text',                   defaultOn: false },
  { id: 'fe',         label: 'FE',         editable: true,  width: '90px',  type: 'text',                   defaultOn: false },
  { id: 'me',         label: 'ME',         editable: true,  width: '90px',  type: 'text',                   defaultOn: false },
  { id: 'md',         label: 'MD',         editable: true,  width: '90px',  type: 'text',                   defaultOn: false },
];

const DEFAULT_VISIBLE_COLS = COLUMNS.filter((c) => c.defaultOn).map((c) => c.id);

function effectiveVisibleCols() {
  if (Array.isArray(state.visibleCols)) {
    // 필수 컬럼은 항상 포함
    const set = new Set(state.visibleCols);
    for (const c of COLUMNS) if (c.required) set.add(c.id);
    return [...set];
  }
  return [...DEFAULT_VISIBLE_COLS];
}

function visibleColumns() {
  const visible = new Set(effectiveVisibleCols());
  return COLUMNS.filter((c) => visible.has(c.id));
}

function renderTable(items, host) {
  if (!items.length) {
    host.innerHTML = emptyHtml({
      kicker: 'NO TICKETS',
      msg: '조건에 맞는 티켓이 없습니다.',
      hint: '필터를 줄이거나 새로고침으로 최신 데이터를 받아보세요.',
    });
    return;
  }

  const cols = visibleColumns();
  const headHtml = cols.map((c) =>
    `<th style="min-width:${c.width}; text-align:left;">${escapeHtml(c.label)}</th>`
  ).join('');

  const rowsHtml = items.map((it) => renderRow(it, cols)).join('');

  host.innerHTML = `
    <div class="tbl-wrap" style="overflow-x:auto;">
      <table class="tbl plan-tbl">
        <thead><tr>${headHtml}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;

  // 편집 가능 셀 클릭 핸들러 (delegation 으로 단일 부착)
  const tbody = host.querySelector('tbody');
  if (tbody) {
    tbody.addEventListener('click', onCellClick);
  }
}

function renderRow(it, cols) {
  const cells = cols.map((c) => renderCell(it, c)).join('');
  return `<tr data-jira-key="${escapeHtml(it.jiraKey)}">${cells}</tr>`;
}

function renderCell(it, col) {
  const v = it[col.id];
  let inner;
  switch (col.id) {
    case 'jiraKey':
      inner = jiraKeyHtml(it.jiraKey);
      break;
    case 'project':
      inner = `<span class="proj">${escapeHtml(v || '—')}</span>`;
      break;
    case 'summary':
      inner = `<span class="summary" title="${escapeHtml(v || '')}">${escapeHtml(v || '—')}</span>`;
      break;
    case 'status': {
      const g = STATUS_GROUPS.find((s) => s.id === statusGroup(it));
      inner = `<span class="st ${g ? g.stClass : ''}">${escapeHtml(v || '—')}</span>`;
      break;
    }
    case 'priority':
      inner = v
        ? `<span class="pri pri-${escapeHtml(String(v).toLowerCase())}">${escapeHtml(v)}</span>`
        : '<span class="muted">—</span>';
      break;
    case 'dueDate':
      inner = v
        ? `<span class="num ${isOverdue(v) ? 'alert' : ''}">${fmtDate(v)}</span>`
        : '<span class="muted">—</span>';
      break;
    default:
      // 편집 가능 셀 — sub-cycle C 에서 클릭 핸들러 부착. 지금은 read-only 표시만.
      inner = v
        ? escapeHtml(v)
        : '<span class="muted">—</span>';
  }
  const editableAttr = col.editable ? ' data-editable="1"' : '';
  return `<td data-col="${col.id}"${editableAttr}>${inner}</td>`;
}

function isOverdue(d) {
  const t = new Date(d);
  if (isNaN(t)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return t < today;
}

/* ─── 인증 UI ─────────────────────────────────────────────────────── */

function bindAuthUi() {
  const signin = $('btn-signin');
  const signout = $('btn-signout');
  if (signin) {
    signin.addEventListener('click', async () => {
      const statusEl = $('auth-status');
      if (statusEl) statusEl.textContent = '로그인 중…';
      try {
        await auth.signIn();
        state.signedIn = true;
        renderAuthUi();
        await loadAndRender();
      } catch (e) {
        console.error('[plan] signIn 실패', e);
        if (statusEl) {
          statusEl.textContent = '로그인 실패 — 다시 시도';
          statusEl.classList.add('err');
        }
      }
    });
  }
  if (signout) {
    signout.addEventListener('click', () => {
      auth.signOut();
      state.signedIn = false;
      state.items = [];
      renderAuthUi();
      // 인증 끊기면 데이터 영역 숨김
      const stats = $('sec-stats');
      const filterSec = $('filter-section');
      if (stats) stats.hidden = true;
      if (filterSec) filterSec.hidden = true;
      showAuthGated($('sec-table'));
      enableRefresh(false);
    });
  }
}

function renderAuthUi() {
  const statusEl = $('auth-status');
  const signin = $('btn-signin');
  const signout = $('btn-signout');
  const help = $('auth-help');
  if (state.signedIn) {
    if (statusEl) {
      statusEl.textContent = `로그인됨: ${auth.email() || '(이메일 미상)'}`;
      statusEl.classList.remove('err');
      statusEl.classList.add('ok');
    }
    if (signin) signin.hidden = true;
    if (signout) signout.hidden = false;
    if (help) help.hidden = true;
  } else {
    if (statusEl) {
      statusEl.textContent = '로그인이 필요합니다';
      statusEl.classList.remove('ok');
    }
    if (signin) signin.hidden = false;
    if (signout) signout.hidden = true;
    if (help) help.hidden = false;
  }
}

function showAuthGated(host) {
  if (!host) return;
  host.innerHTML = emptyHtml({
    kicker: 'SIGN IN REQUIRED',
    msg: 'musinsa.com Google 계정으로 로그인하면 Plan 데이터를 불러옵니다.',
    hint: '위의 "Google 로그인" 버튼을 눌러주세요.',
  });
}

/* ─── 새로고침 ───────────────────────────────────────────────────── */

function bindRefresh() {
  const btn = $('btn-refresh');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!state.signedIn) return;
    btn.disabled = true;
    btn.textContent = '⟳ 로딩 중…';
    try {
      await loadAndRender();
    } finally {
      btn.disabled = false;
      btn.textContent = '🔄 새로고침';
    }
  });
}

function enableRefresh(on) {
  const btn = $('btn-refresh');
  if (btn) btn.disabled = !on;
}

/* ─── 필터 ───────────────────────────────────────────────────────── */

function renderFilters() {
  const host = $('sec-filters');
  const section = $('filter-section');
  if (!host || !section) return;
  if (!state.items.length) {
    section.hidden = true;
    host.innerHTML = '';
    return;
  }
  section.hidden = false;

  const projects = availableProjects(state.items);
  const subjects = availableMainSubjects(state.items);
  const statusGroups = availableStatusGroups(state.items);

  const hasAny =
    state.filters.project ||
    state.filters.statusGroup ||
    state.filters.mainSubject ||
    (state.filters.assignment && state.filters.assignment !== 'all') ||
    (state.filters.duedate && state.filters.duedate !== 'all');

  host.innerHTML = `
    ${chipGroup('project',     '프로젝트', projects.map((v) => ({ v, label: v })), state.filters.project)}
    ${chipGroup('statusGroup', '상태',     statusGroups.map((g) => ({ v: g.id, label: g.label })), state.filters.statusGroup)}
    ${chipGroup('mainSubject', '메인주제', subjects.map((v) => ({ v, label: v })), state.filters.mainSubject)}
    ${chipGroup('assignment',  '인력 배치', ASSIGNMENT_OPTIONS, state.filters.assignment || 'all', { mode: 'radio' })}
    ${chipGroup('duedate',     '기한',      DUEDATE_OPTIONS,     state.filters.duedate || 'all',     { mode: 'radio' })}
    ${hasAny ? '<button type="button" class="tlink" data-filter-reset>필터 초기화</button>' : ''}
  `;

  host.querySelectorAll('button.fchip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.filter;
      const v = btn.dataset.value;
      const mode = btn.dataset.mode || 'toggle';
      if (mode === 'radio') {
        state.filters[f] = v;
      } else {
        state.filters[f] = state.filters[f] === v ? null : v;
      }
      scoped(FILTERS_KEY).set(state.filters);
      renderFilters();
      updateTableView();
    });
  });

  const reset = host.querySelector('[data-filter-reset]');
  if (reset) {
    reset.addEventListener('click', () => {
      state.filters = { ...DEFAULT_FILTERS };
      scoped(FILTERS_KEY).set(state.filters);
      renderFilters();
      updateTableView();
    });
  }
}

function chipGroup(filterKey, label, options, current, opts = {}) {
  if (!options.length) return '';
  const mode = opts.mode || 'toggle';  // 'radio' (단일 선택, 항상 1개 ON) | 'toggle' (선택/해제)
  const chips = options.map((opt) => {
    const on = current === opt.v;
    return `<button type="button" class="fchip ${on ? 'on' : ''}"
              data-filter="${escapeAttr(filterKey)}"
              data-value="${escapeAttr(opt.v)}"
              data-mode="${mode}">${escapeHtml(opt.label)}</button>`;
  }).join('');
  return `
    <div class="filter-group">
      <span class="filter-label">${escapeHtml(label)}</span>
      ${chips}
    </div>
  `;
}

/* ─── 컬럼 토글 모달 ─────────────────────────────────────────────── */

function bindColsModal() {
  const pop = $('cols-pop');
  if (!pop) return;
  state.colsModal = attachModal(pop);

  renderColsBody();
  $('btn-cols')?.addEventListener('click', () => {
    renderColsBody();
    state.colsModal.open();
  });

  pop.querySelector('[data-cols-default]')?.addEventListener('click', () => {
    state.visibleCols = null;  // null = 기본값 사용
    scoped(COLS_KEY).remove();
    renderColsBody();
    updateTableView();
  });
}

/* ─── 인라인 셀 편집 ─────────────────────────────────────────────── */

function onCellClick(e) {
  const td = e.target.closest('td[data-editable="1"]');
  if (!td) return;
  if (td.querySelector('input')) return;                   // 이미 편집 중인 셀
  if (td.dataset.indicator === 'saving') return;           // 저장 진행 중인 셀
  const tr = td.closest('tr');
  if (!tr) return;
  const jiraKey = tr.dataset.jiraKey;
  const colId = td.dataset.col;
  const item = state.items.find((x) => x.jiraKey === jiraKey);
  const col = COLUMNS.find((c) => c.id === colId);
  if (!item || !col || !col.editable) return;
  startEdit(td, item, col);
}

function startEdit(td, item, col) {
  if (!state.signedIn) {
    showCellMessage(td, '로그인 후 편집할 수 있습니다');
    return;
  }
  const oldValue = item[col.id] || '';
  delete td.dataset.indicator;
  delete td.dataset.indicatorMsg;
  td.classList.remove('cell-error');
  const input = document.createElement('input');
  input.type = col.type === 'date' ? 'date' : 'text';
  input.value = oldValue;
  input.dataset.colId = col.id;
  input.style.cssText = 'width:100%; box-sizing:border-box; font: inherit; color: inherit; background: var(--bg-elev); border: 1px solid var(--accent); border-radius: 3px; padding: 2px 4px;';

  // 셀 내용 교체 (원본 백업 유지)
  td.dataset.originalValue = oldValue;
  td.innerHTML = '';
  td.appendChild(input);
  input.focus();
  input.select();

  let committed = false;

  const finish = async (action) => {
    if (committed) return;
    committed = true;
    if (action === 'cancel') {
      renderCellInner(td, item, col);
      return;
    }
    const newValue = input.value;
    const trimmed = col.type === 'date' ? newValue : newValue.trim();
    await commitEdit(td, item, col, trimmed, oldValue);
    if (action === 'next' || action === 'prev') focusAdjacentEditable(td, action);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish('next'); }
    else if (e.key === 'Escape') { e.preventDefault(); finish('cancel'); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      finish(e.shiftKey ? 'prev' : 'next');
    }
  });
  input.addEventListener('blur', () => finish('save'));
}

async function commitEdit(td, item, col, newValue, oldValue) {
  // 검증
  const err = validateCellValue(col.type, newValue);
  if (err) {
    showCellError(td, err);
    // 잠시 후 원래 값 표시 + 셀 마커 유지
    setTimeout(() => renderCellInner(td, item, col), 1800);
    return;
  }

  if (newValue === oldValue) {
    renderCellInner(td, item, col);
    return;
  }

  // optimistic update
  item[col.id] = newValue;
  setCellIndicator(td, 'saving');
  renderCellInner(td, item, col, /*indicator*/ 'saving');

  const now = nowIso();
  try {
    const isNewRow = !item._planRowNum;
    if (isNewRow) {
      // 헤더 없으면 fetch
      if (!state.planHeader.length) await refreshPlanHeader();
      const row = buildRowForAppend(item, state.planHeader, col.id, newValue, now);
      const res = await sheets.append(SPREADSHEET_ID, 'plan!A1', [row]);
      const rowNum = parseRowFromRange(res?.updates?.updatedRange);
      if (rowNum) item._planRowNum = rowNum;
    } else {
      if (!state.planHeader.length) await refreshPlanHeader();
      const colLetter = sheetColLetter(col.id, state.planHeader);
      const lastUpdLetter = sheetColLetter('last_updated_at', state.planHeader);
      if (!colLetter) throw new Error(`planHeader 에 ${col.id} 컬럼 없음`);
      const ranges = [{ range: `plan!${colLetter}${item._planRowNum}`, values: [[newValue]] }];
      if (lastUpdLetter) {
        ranges.push({ range: `plan!${lastUpdLetter}${item._planRowNum}`, values: [[now]] });
      }
      await sheets.batchUpdate(SPREADSHEET_ID, ranges);
    }
    item.last_updated_at = now;
    setCellIndicator(td, 'saved');
    renderCellInner(td, item, col, 'saved');
    updateStats(state.items);  // 미배치·시작일 미정 카운트 갱신
    // 1초 후 indicator 사라지게
    setTimeout(() => {
      if (td.isConnected) renderCellInner(td, item, col);
    }, 1100);
  } catch (e) {
    console.error('[plan] save 실패', e);
    item[col.id] = oldValue;  // 롤백
    if (e instanceof AuthRequiredError) {
      state.signedIn = false;
      renderAuthUi();
      renderCellInner(td, item, col);
      const status = $('auth-status');
      if (status) {
        status.textContent = '세션이 만료되었습니다. 다시 로그인해 주세요.';
        status.classList.add('err');
      }
      return;
    }
    setCellIndicator(td, 'error', e.message || '저장 실패');
    renderCellInner(td, item, col, 'error', e.message || '저장 실패');
  }
}

async function refreshPlanHeader() {
  const res = await sheets.read(SPREADSHEET_ID, 'plan!A1:Z1');
  state.planHeader = (res.values && res.values[0]) || state.planHeader;
}

/** 같은 행 (TR) 의 다음/이전 편집 가능한 td 로 포커스. 없으면 stop. */
function focusAdjacentEditable(currentTd, direction) {
  const tr = currentTd.closest('tr');
  if (!tr) return;
  const editables = [...tr.querySelectorAll('td[data-editable="1"]')];
  const idx = editables.indexOf(currentTd);
  if (idx === -1) return;
  const nextIdx = direction === 'next' ? idx + 1 : idx - 1;
  const target = editables[nextIdx];
  if (target) {
    // 다음 셀 자동 진입 — onCellClick 와 동일 경로
    setTimeout(() => target.click(), 0);
  }
}

/** 편집 가능 셀의 본문을 다시 그림. indicator 가 있으면 우상단 표시. */
function renderCellInner(td, item, col, indicatorState, indicatorMsg) {
  const v = item[col.id];
  const text = v ? escapeHtml(v) : '<span class="muted">—</span>';
  const ind = indicatorState ? indicatorHtml(indicatorState, indicatorMsg) : '';
  td.innerHTML = `${text}${ind}`;
  if (indicatorState === 'error') td.classList.add('cell-error');
  else td.classList.remove('cell-error');
}

function indicatorHtml(stateName, msg) {
  if (stateName === 'saving') return '<span class="cell-ind saving" title="저장 중…" style="margin-left:6px; color: var(--muted);">●</span>';
  if (stateName === 'saved') return '<span class="cell-ind saved" title="저장됨" style="margin-left:6px; color: #4ade80;">✓</span>';
  if (stateName === 'error') return `<span class="cell-ind error" title="${escapeAttr(msg || '저장 실패')}" style="margin-left:6px; color: #f87171; cursor: help;">✕</span>`;
  return '';
}

function setCellIndicator(td, stateName, msg) {
  td.dataset.indicator = stateName;
  if (msg) td.dataset.indicatorMsg = msg;
  else delete td.dataset.indicatorMsg;
}

function showCellError(td, msg) {
  td.classList.add('cell-error');
  td.title = msg;
  td.innerHTML = `<span style="color:#f87171; font-size:11px;">${escapeHtml(msg)}</span>`;
}

function showCellMessage(td, msg) {
  td.title = msg;
  td.innerHTML = `<span class="muted" style="font-size:11px;">${escapeHtml(msg)}</span>`;
}

function renderColsBody() {
  const body = $('cols-body');
  if (!body) return;
  const visible = new Set(effectiveVisibleCols());
  body.innerHTML = '';
  for (const c of COLUMNS) {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex; gap:8px; align-items:center; padding:6px 0; border-bottom:1px solid var(--rule);';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = visible.has(c.id);
    cb.disabled = !!c.required;
    cb.addEventListener('change', () => {
      const set = new Set(effectiveVisibleCols());
      if (cb.checked) set.add(c.id);
      else set.delete(c.id);
      // 필수 컬럼은 항상 포함
      for (const col of COLUMNS) if (col.required) set.add(col.id);
      state.visibleCols = [...set];
      scoped(COLS_KEY).set(state.visibleCols);
      updateTableView();
    });
    const txt = document.createElement('span');
    txt.textContent = c.label + (c.required ? ' (필수)' : '');
    txt.style.cssText = 'font-family: var(--font-mono); font-size: 12px;';
    row.appendChild(cb);
    row.appendChild(txt);
    body.appendChild(row);
  }
}
