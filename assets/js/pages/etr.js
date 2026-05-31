/* =========================================================
   pages/etr.js — ETR (PRD 4.8)
   외부 요청 중 본인 담당. "지금 확인 필요" 강조 + 전체 리스트(필터/정렬/페이저).
   ========================================================= */

import { loadJson } from '../fetch-data.js';
import { showError, showLoading, emptyHtml } from '../states.js';
import { jiraKeyHtml, jiraUrl } from '../jira-link.js';
import { fmtDate, fmtAgo } from '../format.js';
import { STATUS_GROUPS, statusGroup } from '../charts.js';
import { scoped } from '../storage.js';
import { escapeHtml, escapeAttr } from '../escape.js';

const AWAITING_STATUSES = new Set(['발의', '매니저 승인 대기', 'Tech 검토 대기 중']);
const PAGE_SIZE = 50;
const PREFS_KEY = 'etr.prefs';

// 필터 값 (한글 라벨 = 사용자 표시, statusBucket = 매칭 로직)
const STATUS_FILTERS = [
  { v: 'all', label: '전체' },
  { v: 'awaiting', label: '확인 필요' },
  { v: 'in-progress', label: '진행 중' },
  { v: 'done', label: '완료' },
  { v: 'rejected', label: '반려' },
];
const SORT_OPTIONS = [
  { v: 'updated', label: '최근 업데이트' },
  { v: 'due', label: '마감 가까운' },
  { v: 'created', label: '생성일' },
];

let state = {
  rootRel: '',
  items: [],
  filters: { status: 'all', sort: 'updated' },
  page: 1,
};

export async function renderEtr({ rootRel = '' } = {}) {
  state.rootRel = rootRel;
  // 리뷰 Important #5 — 저장된 prefs를 허용값으로 clamp (스키마 변경/오염 방어)
  const saved = scoped(PREFS_KEY).get({}) || {};
  state.filters = {
    status: STATUS_FILTERS.some(o => o.v === saved.status) ? saved.status : 'all',
    sort:   SORT_OPTIONS.some(o => o.v === saved.sort)     ? saved.sort   : 'updated',
  };
  state.page = 1;

  // 리뷰 Important #1 — 로딩/에러는 사용자가 보는 위치(#sec-list)에 표시
  const listHost = document.getElementById('sec-list');
  showLoading(listHost, { rows: 6, title: false });

  try {
    const data = await loadJson(`${rootRel}data/jira/etr-assigned.json`);
    state.items = data.items || [];
  } catch (err) {
    console.error('[etr]', err);
    showError(listHost, err);
    return;
  }

  // 한 번에 도출 (Suggestion #8) — 세 함수가 같은 awaitingItems() 결과를 공유
  const need = awaitingItems();
  renderHeader(need);
  renderMeta(need);
  renderAlert(need);
  renderControls();
  renderList();
}

/* ----- 헤더 + 메타 배지 ------------------------------------ */

function renderHeader(need = awaitingItems()) {
  const lede = document.querySelector('[data-lede]');
  if (!lede) return;
  const total = state.items.length;
  if (total === 0) {
    lede.innerHTML = '데이터 동기화를 기다리는 중. 사이드바 푸터의 last sync 확인.';
    return;
  }
  if (need.length > 0) {
    lede.innerHTML =
      `외부 조직 요청 중 본인 담당 <strong class="num">${total}</strong>건. ` +
      `지금 <strong class="alert-color">확인이 필요한 요청 ${need.length}건</strong>이 있습니다.`;
  } else {
    lede.innerHTML =
      `외부 조직 요청 중 본인 담당 <strong class="num">${total}</strong>건. 확인 필요 없음.`;
  }
}

function renderMeta(need = awaitingItems()) {
  const total = state.items.length;
  const inProg = state.items.filter(it => bucketOf(it) === 'in-progress').length;
  setBadge('total', total);
  setBadge('need', need.length);
  setBadge('inprog', inProg);
  // 페이지 제목 옆 배지 (Suggestion #6 — AT에서 맥락 동반 안내)
  const titleBadge = document.querySelector('[data-title-badge]');
  if (titleBadge) {
    if (need.length > 0) {
      titleBadge.hidden = false;
      titleBadge.textContent = `${need.length}건 확인 필요`;
      titleBadge.setAttribute('aria-label', `ETR 페이지 알림 — 확인 필요 ${need.length}건`);
    } else {
      titleBadge.hidden = true;
      titleBadge.removeAttribute('aria-label');
    }
  }
}

function setBadge(id, n) {
  const el = document.querySelector(`[data-badge="${id}"]`);
  if (el) el.textContent = state.items.length === 0 ? '—' : n;
}

/* ----- 확인 필요 강조 박스 ---------------------------------- */

function renderAlert(need = awaitingItems()) {
  const host = document.getElementById('sec-alert');
  if (!host) return;
  if (!need.length) { host.innerHTML = ''; host.hidden = true; return; }
  host.hidden = false;
  host.innerHTML = `
    <div class="alert">
      <div class="alert-head">⚠ 확인 필요 · ${need.length}건</div>
      <div class="alert-list">
        ${need.slice(0, 12).map(it => alertRowHtml(it)).join('')}
      </div>
      ${need.length > 12 ? `<div class="muted dim-mono mt-12">상위 12건 · 전체 ${need.length}건 — 아래 리스트에서 확인</div>` : ''}
    </div>
  `;
  bindAlertRowKeys(host);
}

function alertRowHtml(it) {
  const g = STATUS_GROUPS.find(x => x.id === statusGroup(it));
  const url = jiraUrl(it.key);
  // 리뷰 Important #2 — 전체 행 클릭 = Jira 열기. data-jira-key 가 외곽에도 있어
  // bindJiraLinks 의 위임 핸들러가 처리. 내부 anchor 는 native 동작에 양보됨.
  return `
    <div class="alert-row" data-key="${escapeAttr(it.key)}" data-jira-key="${escapeAttr(it.key)}" role="link" tabindex="0">
      ${jiraKeyHtml(it.key)}
      <div class="row-title">${escapeHtml(it.summary || '')}</div>
      <span class="st ${g ? g.stClass : 'st-wait'}">${escapeHtml(it.status || '—')}</span>
      <span class="who"><span class="who-dot"></span>${escapeHtml(reporterName(it) || '—')}</span>
      ${url
        ? `<a class="tlink right" href="${url}" target="_blank" rel="noopener noreferrer" data-jira-key="${escapeAttr(it.key)}">확인 →</a>`
        : `<span class="muted dim-mono right">—</span>`
      }
    </div>
  `;
}

/** alert-row 키보드 활성화 — Enter/Space 로 Jira 열기 (커서가 row 자체일 때만) */
function bindAlertRowKeys(host) {
  host.querySelectorAll('.alert-row[role="link"]').forEach(row => {
    row.addEventListener('keydown', e => {
      if (e.currentTarget !== e.target) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const url = jiraUrl(row.dataset.key);
      if (!url) return;
      e.preventDefault();
      window.open(url, '_blank', 'noopener,noreferrer');
    });
  });
}

/* ----- 필터/정렬 컨트롤 ------------------------------------ */

function renderControls() {
  const host = document.getElementById('sec-controls');
  const section = document.getElementById('controls-section');
  if (!host) return;
  // 리뷰 Suggestion #5 mirror — 데이터 없을 때 섹션 통째로 숨김
  if (section) section.hidden = state.items.length === 0;
  if (!state.items.length) { host.innerHTML = ''; return; }

  const isDefault = state.filters.status === 'all' && state.filters.sort === 'updated';
  const row = (inner) => (inner ? `<div class="filter-row">${inner}</div>` : '');
  host.innerHTML = `
    ${row(chipGroup('status', '상태', STATUS_FILTERS, state.filters.status))}
    ${row(chipGroup('sort', '정렬', SORT_OPTIONS, state.filters.sort))}
    ${!isDefault ? '<div class="filter-row"><button type="button" class="tlink" data-filter-reset>필터 초기화</button></div>' : ''}
  `;
  host.querySelectorAll('button.fchip').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.filter;
      state.filters[f] = btn.dataset.value;
      scoped(PREFS_KEY).set(state.filters);
      state.page = 1;
      renderControls();
      renderList();
    });
  });
  const reset = host.querySelector('[data-filter-reset]');
  if (reset) reset.addEventListener('click', () => {
    state.filters = { status: 'all', sort: 'updated' };
    scoped(PREFS_KEY).set(state.filters);
    state.page = 1;
    renderControls();
    renderList();
  });
}

function chipGroup(filterKey, label, options, current) {
  const chips = options.map(opt => {
    const on = current === opt.v;
    return `<button type="button" class="fchip ${on ? 'on' : ''}" data-filter="${escapeAttr(filterKey)}" data-value="${escapeAttr(opt.v)}">${escapeHtml(opt.label)}</button>`;
  }).join('');
  return `<span class="flabel">${escapeHtml(label)}</span>${chips}`;
}

/* ----- 메인 리스트 + 페이저 -------------------------------- */

function renderList() {
  const host = document.getElementById('sec-list');
  const countEl = document.querySelector('[data-list-count]');
  if (!host) return;

  const sorted = sortedFiltered();
  if (countEl) countEl.textContent = sorted.length;

  if (!sorted.length) {
    host.innerHTML = emptyHtml({
      kicker: 'NO ITEMS',
      msg: state.items.length === 0
        ? '동기화 대기 중 — Jira sync 후 표시됩니다.'
        : '해당 필터에 맞는 항목이 없습니다.'
    });
    return;
  }

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * PAGE_SIZE;
  const slice = sorted.slice(start, start + PAGE_SIZE);

  host.innerHTML = `
    <table class="tbl">
      <thead>
        <tr>
          <th style="width:90px">키</th>
          <th>요약</th>
          <th style="width:170px">상태</th>
          <th style="width:160px">요청자</th>
          <th style="width:90px">마감</th>
          <th style="width:110px">최근 업데이트</th>
        </tr>
      </thead>
      <tbody>${slice.map(rowHtml).join('')}</tbody>
    </table>
    ${pagerHtml(sorted.length, totalPages, start, slice.length)}
  `;
  bindPager(host);
}

function rowHtml(it) {
  const g = STATUS_GROUPS.find(x => x.id === statusGroup(it));
  return `
    <tr data-key="${escapeAttr(it.key)}">
      <td>${jiraKeyHtml(it.key)}</td>
      <td class="etr-summary">${escapeHtml(it.summary || '')}</td>
      <td><span class="st ${g ? g.stClass : 'st-wait'}">${escapeHtml(it.status || '—')}</span></td>
      <td><span class="who"><span class="who-dot"></span>${escapeHtml(reporterName(it) || '—')}</span></td>
      <td class="date num">${it.dueDate ? fmtDate(it.dueDate) : '—'}</td>
      <td class="date num" title="${it.updated ? escapeAttr(it.updated) : ''}">${it.updated ? fmtAgo(it.updated) : '—'}</td>
    </tr>
  `;
}

function pagerHtml(total, totalPages, start, sliceLen) {
  if (totalPages <= 1) {
    return `<div class="pager"><span class="pager-info"><span class="num">${total}</span>건</span></div>`;
  }
  const cur = state.page;
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
      // 리뷰 Important #3 — prefers-reduced-motion 존중
      const reduce = typeof matchMedia === 'function'
        && matchMedia('(prefers-reduced-motion: reduce)').matches;
      host.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    });
  });
}

/* ----- 필터링 / 정렬 / helpers ------------------------------ */

/** 상태 → 버킷 매핑. STATUS_GROUPS 기반 + 'awaiting' 별도 분류. */
export function bucketOf(it) {
  if (!it) return 'other';
  if (AWAITING_STATUSES.has(it.status)) return 'awaiting';
  const g = statusGroup(it);
  if (g === 'done') return 'done';
  if (g === 'rejected') return 'rejected';
  // progress / review / wait / prop 등은 '진행 중'으로 묶음. 단, awaiting 은 위에서 가로챔.
  return 'in-progress';
}

function awaitingItems() {
  return state.items.filter(it => bucketOf(it) === 'awaiting');
}

export function filterByStatus(items, status) {
  if (!status || status === 'all') return items;
  return items.filter(it => bucketOf(it) === status);
}

/** 리뷰 Important #4 — localeCompare/ 센티넬 대신 명시적 null 처리 + 단순 비교 */
export function sortItems(items, sort) {
  const cp = [...items];
  if (sort === 'due') {
    cp.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;   // null 은 뒤로
      if (!b.dueDate) return -1;
      return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
    });
  } else if (sort === 'created') {
    cp.sort((a, b) => cmpDesc(a.created, b.created));
  } else {
    cp.sort((a, b) => cmpDesc(a.updated, b.updated));
  }
  return cp;
}

function cmpDesc(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? 1 : a > b ? -1 : 0;
}

function sortedFiltered() {
  return sortItems(filterByStatus(state.items, state.filters.status), state.filters.sort);
}

export function reporterName(it) {
  if (!it) return '';
  if (it.reporter && typeof it.reporter === 'object') return it.reporter.name || '';
  if (typeof it.reporter === 'string') return it.reporter;
  return '';
}

export const _internal = { AWAITING_STATUSES, PAGE_SIZE, bucketOf };
