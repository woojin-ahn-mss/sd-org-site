/* =========================================================
   pages/progress.js — 진행 현황 페이지
   PRD 4.3: 상태 분포·흐름·지연 — 운영 보드
   ========================================================= */

import { loadJson } from '../fetch-data.js';
import { showError, showLoading, emptyHtml } from '../states.js';
import { jiraKeyHtml } from '../jira-link.js';
import { fmtDate, fmtNum } from '../format.js';
import { STATUS_GROUPS, statusGroup, donut, summaryBar, summaryLegend, projectStackBars } from '../charts.js';
import { openDrilldown } from '../drilldown.js';
import { escapeHtml, escapeAttr } from '../escape.js';

const PROJECTS = ['CBP', 'PBO', 'PEL', 'TM', 'MSSCXTF', 'TF', 'SNDPRD', 'CMALL'];
const STALE_DAYS = 30; // PRD 8장 미정 — 운영 시작 기준값
const DUE_SOON_DAYS = 7;

/** 메인 렌더 */
export async function renderProgress({ rootRel = '' } = {}) {
  const host = document.getElementById('progress-host');
  showLoading(host, { rows: 6 });

  let data;
  try {
    data = await loadJson(`${rootRel}data/jira/all-tickets.json`);
  } catch (err) {
    console.error('[progress]', err);
    showError(host, err);
    return;
  }

  const items = data.items || [];
  // 진행 중 / 완료 분리
  const open = items.filter(it => statusGroup(it) !== 'done');
  const done = items.filter(it => statusGroup(it) === 'done');

  // 1) 상단 4 카드 (빈 데이터면 — 표시, 리뷰 Suggestion #15)
  if (items.length === 0) {
    blankStats();
  } else {
    renderStats(open, done);
  }
  // 2) 헤더 lede
  renderHeader(items, open, done);
  // 3) 상태 분포 (도넛 + 가로 막대 + 범례)
  renderStatusDistribution(open);
  // 4) 프로젝트별 흐름
  renderProjectFlow(open);
  // 5) 리스크 3 섹션
  renderRiskLists(open);

  // host 비우기 (위 섹션들이 각자 자기 컨테이너에 그림)
  host.innerHTML = '';
}

/* ----- 상단 4 카드 ---------------------------------------- */

function renderStats(open, done) {
  setStat('in-progress', open.length, '진행 중 합계');

  const weekRange = thisWeekRangeKst();
  const newThisWeek = countCreatedIn([...open, ...done], weekRange);
  setStat('new-week', newThisWeek, `이번 주 발의`);

  const doneThisWeek = countResolvedIn(done, weekRange);
  setStat('done-week', doneThisWeek, '이번 주 완료');

  const overdue = open.filter(it => isOverdue(it.dueDate));
  setStat('overdue', overdue.length, '마감 초과', overdue.length > 0 ? 'down' : '');
}

function setStat(id, val, foot, tone = '') {
  const v = document.querySelector(`[data-stat="${id}"]`);
  const f = document.querySelector(`[data-stat-foot="${id}"]`);
  if (v) {
    const unit = v.querySelector('.u');
    v.textContent = val == null ? '—' : fmtNum(val);
    if (unit) v.appendChild(unit);
  }
  if (f) {
    f.textContent = foot;
    f.classList.remove('up', 'down');
    if (tone) f.classList.add(tone);
  }
}

/** 빈 데이터 시 카드를 — 로 (리뷰 Suggestion #15) */
function blankStats() {
  setStat('in-progress', null, '—');
  setStat('new-week', null, '—');
  setStat('done-week', null, '—');
  setStat('overdue', null, '—');
}

/* ----- 헤더 ----------------------------------------------- */

function renderHeader(all, open, done) {
  const lede = document.querySelector('[data-lede]');
  if (!lede) return;
  if (!all.length) {
    lede.innerHTML = '데이터 동기화를 기다리는 중. 사이드바 푸터의 last sync 확인.';
    return;
  }
  const overdue = open.filter(it => isOverdue(it.dueDate)).length;
  const stale = open.filter(it => isStale(it)).length;
  lede.innerHTML =
    `전체 <strong class="num">${all.length}</strong>건 · 진행 중 <strong class="num">${open.length}</strong>건. ` +
    `마감 초과 <strong class="num">${overdue}</strong>건, ${STALE_DAYS}일+ 정체 <strong class="num">${stale}</strong>건.`;
}

/* ----- 상태 분포 (도넛 + 막대) ----------------------------- */

function renderStatusDistribution(open) {
  const host = document.getElementById('sec-dist');
  if (!host) return;
  if (!open.length) {
    host.innerHTML = emptyHtml({ kicker: 'NO DATA', msg: '진행 중 데이터 없음' });
    return;
  }
  const segments = STATUS_GROUPS
    .filter(g => g.id !== 'done') // 진행 중에는 done 제외
    .map(g => ({
      ...g,
      value: open.filter(it => statusGroup(it) === g.id).length,
    }));

  host.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'dist-grid';

  // 도넛
  const donutWrap = document.createElement('div');
  donutWrap.className = 'dist-donut';
  const total = segments.reduce((s, x) => s + x.value, 0);
  donutWrap.appendChild(donut(segments, {
    size: 200, stroke: 22,
    centerVal: total, centerSub: 'TICKETS',
    onSegmentClick: id => drillByGroup(open, id),
  }));
  grid.appendChild(donutWrap);

  // 가로 스택 막대 + 범례
  const barWrap = document.createElement('div');
  barWrap.className = 'dist-bar';
  barWrap.appendChild(summaryBar(segments, {
    onSegmentClick: id => drillByGroup(open, id),
  }));
  barWrap.appendChild(summaryLegend(segments));
  grid.appendChild(barWrap);

  host.appendChild(grid);
}

/* ----- 프로젝트별 흐름 ------------------------------------- */

function renderProjectFlow(open) {
  const host = document.getElementById('sec-flow');
  if (!host) return;
  if (!open.length) {
    host.innerHTML = emptyHtml({ kicker: 'NO DATA', msg: '진행 중 데이터 없음' });
    return;
  }

  // 등장하는 프로젝트만 (PROJECTS 정의 순서 우선, 그 외는 뒤에)
  const seen = new Set(open.map(it => it.project).filter(Boolean));
  const orderedProjects = [
    ...PROJECTS.filter(p => seen.has(p)),
    ...[...seen].filter(p => !PROJECTS.includes(p)).sort(),
  ];

  const rows = orderedProjects.map(proj => {
    const sub = open.filter(it => it.project === proj);
    const parts = STATUS_GROUPS
      .filter(g => g.id !== 'done')
      .map(g => ({
        id: g.id,
        label: g.label,
        cssVar: g.cssVar,
        value: sub.filter(it => statusGroup(it) === g.id).length,
      }));
    return { proj, total: sub.length, parts };
  }).filter(r => r.total > 0);

  host.innerHTML = '';
  host.appendChild(projectStackBars(rows, {
    onCellClick: (proj, groupId) => drillByProjectGroup(open, proj, groupId),
  }));
}

/* ----- Drill-down 헬퍼 -------------------------------------- */

function drillByGroup(items, groupId) {
  const grp = STATUS_GROUPS.find(g => g.id === groupId);
  const filtered = items.filter(it => statusGroup(it) === groupId);
  openDrilldown(filtered, { kicker: grp ? grp.label : 'TICKETS' });
}
function drillByProjectGroup(items, project, groupId) {
  const grp = STATUS_GROUPS.find(g => g.id === groupId);
  const filtered = items.filter(it => it.project === project && statusGroup(it) === groupId);
  openDrilldown(filtered, { kicker: `${project} · ${grp ? grp.label : ''}` });
}

/* ----- 리스크 3 섹션 --------------------------------------- */

function renderRiskLists(open) {
  // 1) 지연 (마감 초과)
  const overdue = open
    .filter(it => isOverdue(it.dueDate))
    .map(it => ({ ...it, _stale: daysSince(it.dueDate) }))
    .sort((a, b) => b._stale - a._stale);

  // 2) 임박 마감 (7일 이내)
  const soon = open
    .filter(it => {
      const d = daysFromNow(it.dueDate);
      return d !== null && d >= 0 && d <= DUE_SOON_DAYS;
    })
    .sort((a, b) => daysFromNow(a.dueDate) - daysFromNow(b.dueDate));

  // 3) 장기 정체 (In Progress 30일+) — updated 기준
  const stale = open
    .filter(it => isStale(it))
    .map(it => ({ ...it, _stale: daysSince(it.updated) }))
    .sort((a, b) => b._stale - a._stale);

  fillRiskSection('sec-overdue', overdue, { showStale: 'overdue', showDue: true });
  fillRiskSection('sec-due-soon', soon, { showStale: false, showDue: true });
  fillRiskSection('sec-stale', stale, { showStale: 'stale', showDue: false });

  // 카운트 표시
  setCount('cnt-overdue', overdue.length);
  setCount('cnt-due-soon', soon.length);
  setCount('cnt-stale', stale.length);
}

function setCount(id, n) {
  const el = document.querySelector(`[data-count="${id}"]`);
  if (el) el.textContent = n;
}

function fillRiskSection(hostId, rows, opts) {
  const host = document.getElementById(hostId);
  if (!host) return;
  if (!rows.length) {
    host.innerHTML = emptyHtml({ kicker: 'OK', msg: '해당 항목 없음' });
    return;
  }
  host.innerHTML = renderRiskTable(rows, opts);
}

function renderRiskTable(rows, { showStale, showDue }) {
  const ths = [
    '<th style="width:90px">키</th>',
    '<th>요약</th>',
    '<th style="width:90px">프로젝트</th>',
    '<th style="width:140px">상태</th>',
    '<th style="width:110px">담당</th>',
    showDue ? '<th style="width:100px">기한</th>' : '',
    showStale ? '<th style="width:70px;text-align:right">' + (showStale === 'overdue' ? '지연' : '정체') + '</th>' : '',
  ].filter(Boolean).join('');

  const trs = rows.slice(0, 50).map(it => {
    const g = STATUS_GROUPS.find(x => x.id === statusGroup(it));
    const stClass = g ? g.stClass : 'st-wait';
    const staleVal = it._stale ?? 0;
    const staleClass = staleVal > 30 ? 'pri-p0' : (staleVal > 14 ? 'pri-p1' : 'dim');
    const tds = [
      `<td>${jiraKeyHtml(it.key)}</td>`,
      `<td>${escapeHtml(it.summary || '')}</td>`,
      `<td><span class="dim dim-mono">${escapeHtml(it.project || '—')}</span></td>`,
      `<td><span class="st ${stClass}">${escapeHtml(it.status || '—')}</span></td>`,
      `<td><span class="who"><span class="who-dot"></span>${escapeHtml((it.assignee && it.assignee.name) || '—')}</span></td>`,
      showDue ? `<td class="date num">${it.dueDate ? fmtDate(it.dueDate) : '—'}</td>` : '',
      showStale ? `<td class="right num ${staleClass}">${staleVal > 0 ? staleVal + 'd' : '—'}</td>` : '',
    ].filter(Boolean).join('');
    return `<tr data-key="${escapeAttr(it.key)}">${tds}</tr>`;
  }).join('');

  return `
    <table class="tbl">
      <thead><tr>${ths}</tr></thead>
      <tbody>${trs}</tbody>
    </table>
    ${rows.length > 50 ? `<div class="muted dim-mono mt-12">상위 50건 표시 · 전체 ${rows.length}건</div>` : ''}
  `;
}

/* ----- helpers -------------------------------------------- */

function daysFromNow(due) {
  if (!due) return null;
  const d = new Date(due);
  if (isNaN(d)) return null;
  const now = new Date();
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((b - a) / 86400000);
}
function daysSince(when) {
  if (!when) return 0;
  const d = new Date(when);
  if (isNaN(d)) return 0;
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 86400000));
}
function isOverdue(due) {
  const n = daysFromNow(due);
  return n !== null && n < 0;
}
function isStale(item) {
  if (statusGroup(item) !== 'progress') return false;
  const since = daysSince(item.updated || item.created);
  return since >= STALE_DAYS;
}

/** KST 이번 주 (월~일) [start, end)
 *  리뷰 Important #10 — `getUTCDay()` 는 UTC 기준이라 KST 와 어긋남 (UTC 15:00 이전은 전날).
 *  Intl.DateTimeFormat 으로 KST 요일을 직접 가져와 안전하게 계산.
 */
export const _KST_DAY_TO_MON_OFFSET = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
export function thisWeekRangeKst(now = new Date()) {
  const ymd = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const weekday = now.toLocaleString('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' });
  const offset = _KST_DAY_TO_MON_OFFSET[weekday] ?? 0;
  const today = new Date(`${ymd}T00:00:00+09:00`);
  const start = new Date(today.getTime() - offset * 86400000);
  const end = new Date(start.getTime() + 7 * 86400000);
  return { start, end };
}
function countCreatedIn(items, { start, end }) {
  return items.filter(it => {
    if (!it.created) return false;
    const t = new Date(it.created);
    return !isNaN(t) && t >= start && t < end;
  }).length;
}
function countResolvedIn(doneItems, { start, end }) {
  // resolved 필드가 없으면 updated 폴백
  return doneItems.filter(it => {
    const when = it.resolved || it.updated;
    if (!when) return false;
    const t = new Date(when);
    return !isNaN(t) && t >= start && t < end;
  }).length;
}

