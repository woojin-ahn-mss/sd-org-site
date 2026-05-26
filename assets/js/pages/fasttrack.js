/* =========================================================
   pages/fasttrack.js — 패스트트랙 (PRD 4.7 + 리뉴얼 2026-05-26)
   ETR + 'one' 레이블 = 인입 / status '검토완료-우선착수' = 트리아지
   - 1행 = 1 ETR, 행 클릭으로 연결 티켓 펼침
   - 상단 5 카드: 총인입 / 트리아지 / 일반과제 / 지난주 인입 / 금주 인입(+트리아지N)
   - 진행 상태 · 평균 경과 시간 표 (ETR | FT 두 컬럼)
   - 필터, 메인 테이블, 펼침 영역 유지
   ========================================================= */

import { loadJson } from '../fetch-data.js';
import { showError, showLoading, emptyHtml } from '../states.js';
import { jiraKeyHtml, jiraUrl } from '../jira-link.js';
import { fmtDate, daysUntil } from '../format.js';
import { STATUS_GROUPS, statusGroup } from '../charts.js';
import { scoped } from '../storage.js';
import { escapeHtml, escapeAttr } from '../escape.js';

const FILTERS_KEY = 'fasttrack.filters';
const PERIOD_DAYS = { '1m': 30, '3m': 90, 'all': Infinity };

// 상태 분류 (사용자 정의)
const STATUS_TRIAGE = '검토완료-우선착수';   // 패스트트랙 트리아지
const STATUS_NORMAL = '검토완료-백로그';     // 일반 과제 (패스트트랙 진행 X)
const STATUS_DROPPED = new Set(['반려', '검토완료-미진행', '철회']);

// ETR 진행 단계 순서 (표 정렬용). 알 수 없는 상태는 뒤에 알파벳순.
const ETR_STATUS_ORDER = [
  '발의', '매니저 승인 대기', 'PMO 검토 중', 'Tech 검토 대기 중', 'Tech 검토 중',
  STATUS_TRIAGE, STATUS_NORMAL, '검토완료-미진행', '반려', '완료',
];

let state = {
  rootRel: '',
  items: [],     // ETR 인입 (etr-fasttrack.json)
  ftItems: [],   // FT 프로젝트 티켓 (ft-tickets.json) — 없으면 빈 배열
  filters: { status: null, reporter: null, period: 'all' },
  expanded: new Set(),
};

export async function renderFasttrack({ rootRel = '' } = {}) {
  state.rootRel = rootRel;
  state.filters = Object.assign(
    { status: null, reporter: null, period: 'all' },
    scoped(FILTERS_KEY).get({})
  );

  const tableHost = document.getElementById('sec-table');
  showLoading(tableHost, { rows: 4, title: false });

  try {
    const data = await loadJson(`${rootRel}data/jira/etr-fasttrack.json`);
    state.items = (data.items || []).map(normalizeItem);
  } catch (err) {
    console.error('[fasttrack]', err);
    showError(tableHost, err);
    return;
  }

  // FT 데이터는 옵셔널 — 없어도 (sync 전) 페이지 동작
  try {
    const ft = await loadJson(`${rootRel}data/jira/ft-tickets.json`);
    state.ftItems = ft.items || [];
  } catch (_) {
    state.ftItems = [];
  }

  renderStats();
  renderHeader();
  renderDwellTables();
  renderFilters();
  renderTable();
}

/** linkedTickets 진척률 보정 + missing progress 계산 */
function normalizeItem(raw) {
  const linked = Array.isArray(raw.linkedTickets) ? raw.linkedTickets : [];
  let done = 0;
  let total = linked.length;
  for (const l of linked) {
    if (l && (l.statusCategory === 'done' || statusGroup(l) === 'done')) done++;
  }
  const progress = raw.progress && typeof raw.progress.done === 'number'
    ? { done: raw.progress.done, total: raw.progress.total }
    : { done, total };
  return { ...raw, linkedTickets: linked, progress };
}

/* ----- 상단 5 카드 ----------------------------------------- */

function renderStats() {
  const all = state.items;
  const triage = all.filter(it => it.status === STATUS_TRIAGE);
  const normal = all.filter(it => it.status === STATUS_NORMAL);
  const { thisWeek, lastWeek } = weekBuckets(all);
  const thisWeekTriage = thisWeek.filter(it => it.status === STATUS_TRIAGE);

  setStat('total', all.length, 'ETR + one');
  setStat('triage', triage.length, '우선착수');
  setStat('normal', normal.length, '검토완료-백로그');
  setStat('lastweek', lastWeek.length, 'created 기준');
  setStat('thisweek', thisWeek.length, `트리아지 ${thisWeekTriage.length}건`);
}

/** KST 월~일 기준으로 created 를 금주/지난주 버킷에 배정.
 *  @returns {{thisWeek: Item[], lastWeek: Item[]}}
 */
export function weekBuckets(items, now = new Date()) {
  const { thisStart, thisEnd, lastStart, lastEnd } = kstWeekRange(now);
  const thisWeek = [];
  const lastWeek = [];
  for (const it of items) {
    if (!it.created) continue;
    const c = new Date(it.created);
    if (isNaN(c)) continue;
    const ms = c.getTime();
    if (ms >= thisStart && ms < thisEnd) thisWeek.push(it);
    else if (ms >= lastStart && ms < lastEnd) lastWeek.push(it);
  }
  return { thisWeek, lastWeek };
}

/** KST 기준 이번 주 (월 00:00) 시작 / 끝 + 지난 주 시작 / 끝 — ms epoch. */
export function kstWeekRange(now) {
  // KST = UTC+9
  const kstNow = new Date(now.getTime() + 9 * 3600 * 1000);
  // KST 기준 요일: 일=0 ~ 토=6 → 월요일을 주 시작으로
  const dow = kstNow.getUTCDay();            // 0=일, 1=월, ..., 6=토
  const daysFromMon = (dow + 6) % 7;          // 월=0, 화=1, ..., 일=6
  // 이번주 월요일 00:00 KST = 09:00 UTC 전날
  const thisMonKst = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate() - daysFromMon, 0, 0, 0));
  const thisStart = thisMonKst.getTime() - 9 * 3600 * 1000;     // → UTC epoch
  const thisEnd = thisStart + 7 * 86400 * 1000;
  const lastStart = thisStart - 7 * 86400 * 1000;
  const lastEnd = thisStart;
  return { thisStart, thisEnd, lastStart, lastEnd };
}

function setStat(id, val, foot) {
  const v = document.querySelector(`[data-stat="${id}"]`);
  const f = document.querySelector(`[data-stat-foot="${id}"]`);
  if (v) {
    const unit = v.querySelector('.u');
    v.textContent = state.items.length === 0 ? '—' : val;
    if (unit) v.appendChild(unit);
  }
  if (f) f.textContent = foot;
}

/* ----- 헤더 ----------------------------------------------- */

function renderHeader() {
  const lede = document.querySelector('[data-lede]');
  if (!lede) return;
  const total = state.items.length;
  if (total === 0) {
    lede.innerHTML = '데이터 동기화를 기다리는 중. 사이드바 푸터의 last sync 확인.';
    return;
  }
  const triage = state.items.filter(it => it.status === STATUS_TRIAGE).length;
  const ft = state.ftItems.length;
  lede.innerHTML =
    `ETR + <span class="num">one</span> 레이블 ` +
    `<strong class="num">${total}</strong>건 (인입). ` +
    `트리아지 <strong class="num">${triage}</strong>건, ` +
    `FT 티켓 <strong class="num">${ft}</strong>건. ` +
    `행 클릭 시 연결 티켓 펼침.`;
}

/* ----- 진행 상태 · 평균 경과 시간 표 -------------------------- */

function renderDwellTables() {
  const etrTable = document.getElementById('dwell-etr');
  const ftTable = document.getElementById('dwell-ft');
  if (etrTable) renderDwellGroup(etrTable, dwellStats(state.items, ETR_STATUS_ORDER));
  if (ftTable)  renderDwellGroup(ftTable,  dwellStats(state.ftItems));
}

/**
 * 상태별 (건수, 평균 경과 일수) 집계.
 * 경과 일수 = (now - lastStatusChangedAt) / day. lastStatusChangedAt 없으면 updated, 그것도 없으면 created.
 * 완료/반려/철회 상태는 별로 의미 없지만 일단 포함 (현황 파악용).
 *
 * @returns {{status: string, count: number, avgDays: number|null}[]}
 */
export function dwellStats(items, order = [], now = Date.now()) {
  const map = new Map();
  for (const it of items) {
    const s = it.status || '(없음)';
    if (!map.has(s)) map.set(s, { count: 0, sum: 0, sumCount: 0 });
    const b = map.get(s);
    b.count++;
    const ts = pickElapsedAnchor(it);
    if (ts != null) {
      b.sum += Math.max(0, (now - ts) / 86400000);
      b.sumCount++;
    }
  }
  const arr = [];
  for (const [status, b] of map.entries()) {
    arr.push({
      status,
      count: b.count,
      avgDays: b.sumCount > 0 ? b.sum / b.sumCount : null,
    });
  }
  arr.sort((a, b) => {
    const ia = order.indexOf(a.status);
    const ib = order.indexOf(b.status);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.status.localeCompare(b.status, 'ko');
  });
  return arr;
}

/** 경과 일수 계산용 기준 시점 (epoch ms or null). */
function pickElapsedAnchor(it) {
  const candidates = [it.lastStatusChangedAt, it.updated, it.created];
  for (const c of candidates) {
    if (!c) continue;
    const d = new Date(c);
    if (!isNaN(d)) return d.getTime();
  }
  return null;
}

function renderDwellGroup(table, rows) {
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty">데이터 동기화 대기 중.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const avg = r.avgDays == null ? '—' : r.avgDays.toFixed(1);
    const longCls = (r.avgDays != null && r.avgDays >= 7) ? 'long' : '';
    return `
      <tr>
        <td>${escapeHtml(r.status)}</td>
        <td class="num">${r.count}</td>
        <td class="num ${longCls}">${avg}</td>
      </tr>
    `;
  }).join('');
}

/* ----- 필터 ------------------------------------------------ */

function renderFilters() {
  const host = document.getElementById('sec-filters');
  const section = document.getElementById('filter-section');
  if (!host) return;
  if (section) section.hidden = state.items.length === 0;
  if (!state.items.length) { host.innerHTML = ''; return; }

  const statuses = [...new Set(state.items.map(it => it.status).filter(Boolean))].sort();
  const reporters = [...new Set(state.items.map(it => reporterName(it)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
  const periods = [
    { v: 'all', label: '전체' },
    { v: '3m', label: '최근 3개월' },
    { v: '1m', label: '최근 1개월' },
  ];

  const hasAny = state.filters.status || state.filters.reporter || (state.filters.period && state.filters.period !== 'all');

  host.innerHTML = `
    ${chipGroup('status', '상태', statuses.map(s => ({ v: s, label: s })), state.filters.status)}
    ${chipGroup('reporter', '요청자', reporters.map(r => ({ v: r, label: r })), state.filters.reporter)}
    ${chipGroup('period', '기간', periods, state.filters.period)}
    ${hasAny ? '<button type="button" class="tlink" data-filter-reset>필터 초기화</button>' : ''}
  `;
  host.querySelectorAll('button.fchip').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.filter;
      const v = btn.dataset.value;
      if (f === 'period') {
        state.filters.period = v;
      } else {
        state.filters[f] = state.filters[f] === v ? null : v;
      }
      scoped(FILTERS_KEY).set(state.filters);
      renderFilters();
      renderTable();
    });
  });
  const reset = host.querySelector('[data-filter-reset]');
  if (reset) reset.addEventListener('click', () => {
    state.filters = { status: null, reporter: null, period: 'all' };
    scoped(FILTERS_KEY).set(state.filters);
    renderFilters();
    renderTable();
  });
}

function chipGroup(filterKey, label, options, current) {
  if (!options.length) return '';
  const chips = options.map(opt => {
    const on = current === opt.v;
    return `<button type="button" class="fchip ${on ? 'on' : ''}" data-filter="${escapeAttr(filterKey)}" data-value="${escapeAttr(opt.v)}">${escapeHtml(opt.label)}</button>`;
  }).join('');
  return `<span class="flabel">${escapeHtml(label)}</span>${chips}`;
}

/* ----- 메인 테이블 ----------------------------------------- */

function renderTable() {
  const host = document.getElementById('sec-table');
  if (!host) return;
  const rows = filteredItems();
  if (!rows.length) {
    host.innerHTML = emptyHtml({
      kicker: 'NO ITEMS',
      msg: state.items.length === 0
        ? '동기화 대기 중 — Jira sync 후 표시됩니다.'
        : '필터에 맞는 항목이 없습니다.'
    });
    return;
  }

  host.innerHTML = `
    <table class="tbl">
      <thead>
        <tr>
          <th style="width:90px">키</th>
          <th>요약</th>
          <th style="width:140px">요청자</th>
          <th style="width:160px">상태</th>
          <th style="width:110px">진척</th>
          <th style="width:80px">요청</th>
          <th style="width:80px">마감</th>
          <th style="width:20px"></th>
        </tr>
      </thead>
      <tbody>${rows.map(rowHtml).join('')}</tbody>
    </table>
  `;
  bindRowToggle(host);
}

function rowHtml(it) {
  const open = state.expanded.has(it.key);
  const g = STATUS_GROUPS.find(x => x.id === statusGroup(it));
  const p = it.progress || { done: 0, total: 0 };
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  const doneAll = p.total > 0 && p.done === p.total;
  const doneCls = doneAll ? 'done' : '';
  const dueClass = (() => {
    if (isItemDone(it)) return 'date num';
    const d = daysUntil(it.duedate);
    return d !== null && d < 0 ? 'date num alert-color' : 'date num';
  })();
  const expandId = `ft-expand-${cssId(it.key)}`;
  const progCell = p.total > 0
    ? `<span class="prog num ${doneCls}">
         ${p.done}/${p.total}
         <span class="prog-bar"><span style="width:${pct}%"></span></span>
       </span>`
    : '<span class="dim dim-mono">—</span>';

  return `
    <tr class="ft-row" data-key="${escapeAttr(it.key)}"
        role="button" tabindex="0"
        aria-expanded="${open ? 'true' : 'false'}"
        aria-controls="${expandId}">
      <td>${jiraKeyHtml(it.key)}</td>
      <td class="ft-summary">${escapeHtml(it.summary || '')}</td>
      <td><span class="who"><span class="who-dot"></span>${escapeHtml(reporterName(it) || '—')}</span></td>
      <td><span class="st ${g ? g.stClass : 'st-wait'}">${escapeHtml(it.status || '—')}</span></td>
      <td>${progCell}</td>
      <td class="date num">${it.created ? fmtDate(it.created) : '—'}</td>
      <td class="${dueClass}">${it.duedate ? fmtDate(it.duedate) : '—'}</td>
      <td><span class="caret ${open ? 'open' : ''}" aria-hidden="true">›</span></td>
    </tr>
    ${open ? expandHtml(it, expandId) : ''}
  `;
}

function cssId(s) {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function expandHtml(it, expandId) {
  const linked = it.linkedTickets || [];
  if (!linked.length) {
    return `
      <tr class="ft-expand" role="presentation"><td colspan="8" role="presentation" class="ft-expand-cell">
        <section id="${expandId}" class="expand" role="region" aria-label="연결 티켓 없음">
          <div class="expand-label">연결 티켓 없음</div>
        </section>
      </td></tr>
    `;
  }
  const rows = linked.map(l => {
    const g = STATUS_GROUPS.find(x => x.id === statusGroup(l));
    const isDone = l.statusCategory === 'done' || statusGroup(l) === 'done';
    const pct = isDone ? 100 : 0;
    return `
      <div class="linked-row">
        ${jiraKeyHtml(l.key)}
        <span class="ft-link-summary">${escapeHtml(l.summary || '')}</span>
        <span class="st ${g ? g.stClass : 'st-wait'}">${escapeHtml(l.status || '—')}</span>
        <span class="who"><span class="who-dot"></span>${escapeHtml((l.assignee && l.assignee.name) || '—')}</span>
        <span class="prog num ${isDone ? 'done' : ''}">
          ${isDone ? '100%' : '—'}
          <span class="prog-bar"><span style="width:${pct}%"></span></span>
        </span>
      </div>
    `;
  }).join('');
  return `
    <tr class="ft-expand" role="presentation"><td colspan="8" role="presentation" class="ft-expand-cell">
      <section id="${expandId}" class="expand" role="region" aria-label="연결 티켓 ${linked.length}건">
        <div class="expand-label">연결 티켓 · ${linked.length}건</div>
        ${rows}
      </section>
    </td></tr>
  `;
}

function bindRowToggle(host) {
  host.querySelectorAll('tr.ft-row').forEach(tr => {
    tr.addEventListener('click', e => {
      if (e.target.closest('a')) return;
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
  renderTable();
}

/* ----- 필터링 / helpers ------------------------------------ */

export function filteredItems(items = state.items, filters = state.filters, now = new Date()) {
  const cutoff = filters.period && filters.period !== 'all'
    ? new Date(now.getTime() - (PERIOD_DAYS[filters.period] || Infinity) * 86400000)
    : null;
  return items.filter(it => {
    if (filters.status && it.status !== filters.status) return false;
    if (filters.reporter && reporterName(it) !== filters.reporter) return false;
    if (cutoff && it.created) {
      const c = new Date(it.created);
      if (!isNaN(c) && c < cutoff) return false;
    }
    return true;
  });
}

export function reporterName(it) {
  if (!it) return '';
  if (it.reporter && typeof it.reporter === 'object') return it.reporter.name || '';
  if (typeof it.reporter === 'string') return it.reporter;
  return '';
}

function isItemDone(it) {
  if (statusGroup(it) === 'done') return true;
  const p = it.progress || { done: 0, total: 0 };
  if (p.total > 0 && p.done === p.total) return true;
  return false;
}

export const _internal = {
  isItemDone, normalizeItem, PERIOD_DAYS,
  STATUS_TRIAGE, STATUS_NORMAL,
  dwellStats, weekBuckets, kstWeekRange, pickElapsedAnchor,
};
