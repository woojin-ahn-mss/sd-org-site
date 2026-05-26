/* =========================================================
   pages/fasttrack.js — 패스트트랙 (PRD 4.7)
   ETR + 'one' 레이블 — 임원 요청 추적
   - 1행 = 1 ETR, 행 클릭으로 연결 티켓 펼침
   - 상단 4 카드 + 필터 (상태 / 요청자 / 기간 1m·3m·all)
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

let state = {
  rootRel: '',
  items: [],
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

  renderStats();
  renderHeader();
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
  // sync.py 가 progress 를 넣어줬으면 그것을 신뢰 (소스가 동일하므로 일치할 것)
  const progress = raw.progress && typeof raw.progress.done === 'number'
    ? { done: raw.progress.done, total: raw.progress.total }
    : { done, total };
  return { ...raw, linkedTickets: linked, progress };
}

/* ----- 상단 4 카드 ----------------------------------------- */

function renderStats() {
  const all = state.items;
  const active = all.filter(it => !isItemDone(it));
  const done = all.filter(it => isItemDone(it));
  const reporters = new Set(all.map(it => reporterName(it)).filter(Boolean));

  setStat('total', all.length, '전체');
  setStat('active', active.length, '진행 중');
  setStat('done', done.length, '완료');
  setStat('reporters', reporters.size, '요청자');
}

function isItemDone(it) {
  // 1) ETR 자체가 done 상태
  if (statusGroup(it) === 'done') return true;
  // 2) 연결 티켓 모두 완료
  const p = it.progress || { done: 0, total: 0 };
  if (p.total > 0 && p.done === p.total) return true;
  return false;
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
  const active = state.items.filter(it => !isItemDone(it)).length;
  lede.innerHTML =
    `임원이 직접 의뢰한 ETR + <span class="num">one</span> 레이블 요청 ` +
    `<strong class="num">${total}</strong>건. ` +
    `진행 중 <strong class="num">${active}</strong>건, 행을 누르면 연결된 Jira 티켓이 펼쳐집니다.`;
}

/* ----- 필터 ------------------------------------------------ */

function renderFilters() {
  const host = document.getElementById('sec-filters');
  const section = document.getElementById('filter-section');
  if (!host) return;
  // 리뷰 Suggestion #9 — 데이터 없으면 섹션 자체 숨김 (빈 헤더 방지)
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
    // 리뷰 Important #4 — 이미 완료된 ETR 은 과거 마감이라도 alert 톤 안 함
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

/** Jira key (CBP-1234) → CSS-safe id segment */
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
    const pct = isDone ? 100 : 0; // sync 결과에 개별 % 없음 — 완료/미완료만
    // 리뷰 Suggestion #5 — design 정합: data-jira-key 는 .key 앵커가 이미 가짐. 외곽 div 에는 제거.
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
      // anchor 클릭은 native 처리에 양보 (Jira 키, 연결 행 키 등)
      if (e.target.closest('a')) return;
      toggleRow(tr);
    });
    tr.addEventListener('keydown', onRowKeydown);
  });
}

/** 리뷰 Critical #1 — Enter/Space 는 tr 자체가 focus 일 때만 토글.
 *  내부 anchor 등 다른 focusable 에서 발생한 키 이벤트는 native 동작에 양보.
 */
export function onRowKeydown(e) {
  if (e.currentTarget !== e.target) return; // 자식(anchor 등)에서 발생 → 양보
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
    // 의도: created 없는 항목은 기간 필터를 무시 (older Jira 임포트나 일부 ETR 은 비어 있음).
    // 운영 시 누락 케이스를 노출하기보다 통과시키는 게 안전.
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

export const _internal = { isItemDone, normalizeItem, PERIOD_DAYS };
