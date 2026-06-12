/* =========================================================
   gantt.js — Gantt grid 렌더 (PRD 4.5)
   - 분기 모드: yearQuarter 셀 단일 채우기
   - 월 모드: 시작일~기한 가로 span / 시작일 X + 기한만 → 좌측 14일 fade / 둘 다 X → 점
   - design system .g-* 클래스 그대로 사용. 새 색·폰트 금지.
   ========================================================= */

import { jiraUrl } from './jira-link.js';
import { fmtDate } from './format.js';
import { goalToAxisBar, fmtPeriod, sortGoals } from './goals.js';

/** 메인주제 → b-* class (디자인 시스템) */
const SUBJECT_CLASS = {
  '01.추천':      'b-rec',
  '02.검색':      'b-srch',
  '03.랭킹':      'b-rank',
  '04.개인화':    'b-pers',
  '05.디스커버리': 'b-disc',
};
function subjectClass(subject) {
  if (!subject) return 'b-misc';
  if (SUBJECT_CLASS[subject]) return SUBJECT_CLASS[subject];
  // 매칭되는 prefix 가 있나
  for (const k of Object.keys(SUBJECT_CLASS)) {
    if (subject.startsWith(k.split('.')[0])) return SUBJECT_CLASS[k];
  }
  // 6번째+ 는 hash → 5색 + misc
  const palette = ['b-rec', 'b-srch', 'b-rank', 'b-pers', 'b-disc', 'b-misc'];
  let h = 0;
  for (const c of subject) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return palette[h % palette.length];
}

/** 컬럼 정의 (PRD 4.4) */
export const COLUMNS = [
  { id: 'key',       label: 'KEY',       width: 92,  default: true,  required: true },
  { id: 'summary',   label: 'TITLE',     width: 260, default: true },
  { id: 'priority',  label: 'PRI',       width: 36,  default: true },
  { id: 'status',    label: 'STATUS',    width: 110, default: true },
  { id: 'due',       label: 'DUE',       width: 86,  default: true },
  { id: 'labels',    label: 'LABELS',    width: 120, default: false },
  { id: 'assignee',  label: 'ASSIGNEE',  width: 100, default: false },
  { id: 'start',     label: 'START',     width: 86,  default: false },
  { id: 'yq',        label: 'YEAR-Q',    width: 70,  default: false },
];

/** 시간 축 계산 */
export function buildTimeAxis(mode, anchor = new Date()) {
  if (mode === 'month') {
    // 12개월 — anchor 연도의 1월부터 12월까지
    const start = new Date(anchor.getFullYear(), 0, 1);
    const cells = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      cells.push({
        type: 'month',
        label: `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`,
        start: d,
        end: new Date(d.getFullYear(), d.getMonth() + 1, 1),
        isCurrent: d.getFullYear() === anchor.getFullYear() && d.getMonth() === anchor.getMonth(),
      });
    }
    return { mode, cells, totalStart: cells[0].start, totalEnd: cells[cells.length - 1].end };
  }
  // 분기 모드 — 현재 분기 -2 ~ +3 (총 6)
  const curQ = Math.floor(anchor.getMonth() / 3);
  const startYear = anchor.getFullYear();
  const startQ = curQ - 2;
  const cells = [];
  for (let i = 0; i < 6; i++) {
    const qIdx = startQ + i;
    const y = startYear + Math.floor(qIdx / 4);
    const q = ((qIdx % 4) + 4) % 4; // 0..3
    const start = new Date(y, q * 3, 1);
    const end = new Date(y, q * 3 + 3, 1);
    cells.push({
      type: 'quarter',
      label: `${y} Q${q + 1}`,
      key: `${y}-Q${q + 1}`,
      start, end,
      isCurrent: y === anchor.getFullYear() && q === curQ,
    });
  }
  return { mode, cells, totalStart: cells[0].start, totalEnd: cells[cells.length - 1].end };
}

/** 단일 분기 줌 축 — 'YYYY-Q[1-4]' 의 3개월을 month 셀로 펼친다.
 *  invalid 면 기본 분기 축으로 폴백. */
export function buildQuarterAxis(yearQuarter, anchor = new Date()) {
  const m = /^(\d{4})-Q([1-4])$/.exec((yearQuarter || '').trim());
  if (!m) return buildTimeAxis('quarter', anchor);
  const y = Number(m[1]);
  const q0 = Number(m[2]) - 1;
  const cells = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(y, q0 * 3 + i, 1);
    cells.push({
      type: 'month',
      label: `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`,
      start: d,
      end: new Date(d.getFullYear(), d.getMonth() + 1, 1),
      isCurrent: d.getFullYear() === anchor.getFullYear() && d.getMonth() === anchor.getMonth(),
    });
  }
  return { mode: 'month', cells, totalStart: cells[0].start, totalEnd: cells[cells.length - 1].end, focusQuarter: `${y}-Q${q0 + 1}` };
}

/** 메인 렌더 — 좌측 메타패널(고정) + 우측 시간패널(가로 스크롤) 분리 구조.
 *  같은 행 인덱스의 양쪽 row 는 동일한 min-height 로 수직 정렬됨.
 *  opts:
 *    mode: 'quarter' | 'month'
 *    items: 카드 배열
 *    columns: 활성 컬럼 id 배열
 *    collapsedGroups: 접힌 그룹 이름 Set
 *    onGroupToggle(name): 그룹 접기 콜백
 *    groupBy: 'subject' | 'goal'  (기본 subject)
 *    goals: Goal[]                (groupBy='goal' 일 때 사용)
 *    cardGoals: { cardId: goalId }
 *  목표 그룹의 헤더 행에는 목표 기간(startMonth~endMonth) 막대가 우측 시간축에 함께 그려진다.
 */
export function renderGantt(host, opts) {
  const { mode = 'quarter', items, columns = COLUMNS.filter(c => c.default).map(c => c.id),
          collapsedGroups = new Set(), onGroupToggle,
          groupBy = 'subject', goals = [], cardGoals = {}, groups = null,
          focusQuarter = null } = opts;
  // 분기 줌이 켜지면 해당 분기 3개월을 month 축으로 펼치고, 행도 month 렌더(일자 기준 막대)를 쓴다.
  const axis = focusQuarter ? buildQuarterAxis(focusQuarter) : buildTimeAxis(mode);
  const effMode = focusQuarter ? 'month' : mode;
  // groups 가 주어지면(예: 목표/주제 — DB 기반 사전 그룹핑) 그대로 사용. 아니면 내부 그룹핑.
  const grouped = groups
    ? groups
    : groupBy === 'goal'
      ? groupByGoal(items, goals, cardGoals)
      : groupBySubject(items);
  const activeCols = COLUMNS.filter(c => columns.includes(c.id) || c.required);

  const metaTemplate = activeCols.map(c => `${c.width}px`).join(' ');
  // 월: 셀당 최소 110px, 분기: 60px. 시간패널 너비가 컨테이너보다 크면 자동 가로 스크롤
  const timeCellSize = effMode === 'month' ? 'minmax(110px, 1fr)' : 'minmax(60px, 1fr)';
  const timeTemplate = `repeat(${axis.cells.length}, ${timeCellSize})`;

  const root = document.createElement('div');
  root.className = 'gantt';

  if (!grouped.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<span class="empty-kicker">EMPTY</span><span class="empty-msg">조건에 맞는 Initiative 없음</span>';
    root.appendChild(empty);
    host.innerHTML = '';
    host.appendChild(root);
    return;
  }

  const metaTotalWidth = activeCols.reduce((s, c) => s + c.width, 0);
  const metaPane = document.createElement('div');
  metaPane.className = 'gantt-meta';
  metaPane.style.width = `${metaTotalWidth}px`;
  metaPane.style.minWidth = `${metaTotalWidth}px`;

  const timePane = document.createElement('div');
  timePane.className = 'gantt-time';
  // 시간 패널 내부 행의 명시적 min-width — 절대위치 막대(%) 가 grid 실제 너비를 기준으로 계산되게.
  // 이걸 안 잡으면 .gt-row 의 CSS 너비가 좁은 부모 너비 그대로라서 막대가 잘못된 컬럼에 위치함.
  const minColPx = effMode === 'month' ? 110 : 60;
  const timeMinWidth = minColPx * axis.cells.length;

  // 헤더 (양쪽 패널)
  metaPane.appendChild(renderMetaHead(activeCols, metaTemplate));
  timePane.appendChild(renderTimeHead(axis, timeTemplate, timeMinWidth));

  // 그룹/데이터 행 (양쪽 패널 동시에 push — 수직 정렬 유지).
  // 그룹 헤더 행 시간축에 목표 기간 막대:
  //   1) group._goal 이 있으면 (groupBy='goal' 분기)
  //   2) 없더라도 group.subject 와 동일 제목의 목표가 있으면 (메인주제 그룹이지만 같은 이름의 목표가 존재)
  const renderItems = (items, nested = false) => {
    for (const item of items) {
      metaPane.appendChild(renderItemMetaRow(item, activeCols, metaTemplate, nested));
      timePane.appendChild(renderItemTimeRow(item, axis, effMode, timeTemplate, timeMinWidth));
    }
  };
  for (const group of grouped) {
    const gkey = group.key || group.subject;
    const collapsed = collapsedGroups.has(gkey);
    const matchedGoal = group._goal
      || (goals && goals.find(g => g.title === group.subject))
      || null;
    metaPane.appendChild(renderGroupMetaRow(group, collapsed, onGroupToggle, { key: gkey }));
    timePane.appendChild(renderGroupTimeRow(timeTemplate, matchedGoal, axis, timeMinWidth));
    if (collapsed) continue;
    if (group.subGroups) {
      // 2단 중첩: 목표 → 주제 → 티켓
      for (const sg of group.subGroups) {
        const skey = sg.key || sg.subject;
        const sCollapsed = collapsedGroups.has(skey);
        metaPane.appendChild(renderGroupMetaRow(sg, sCollapsed, onGroupToggle, { key: skey, isSub: true }));
        timePane.appendChild(renderGroupTimeRow(timeTemplate, sg._goal || null, axis, timeMinWidth, true));
        if (!sCollapsed) renderItems(sg.items, true);
      }
    } else {
      renderItems(group.items);
    }
  }

  root.appendChild(metaPane);
  root.appendChild(timePane);

  host.innerHTML = '';
  host.appendChild(root);
}

/* ----------------- 그룹핑 ----------------- */

function groupBySubject(items) {
  const map = new Map();
  for (const it of items) {
    const k = it.mainSubject || '— 미분류';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  }
  // 정렬: subject 이름의 prefix 숫자 기준, 마지막에 미분류
  const groups = [...map.entries()].map(([subject, items]) => ({ subject, items }));
  groups.sort((a, b) => {
    if (a.subject === '— 미분류') return 1;
    if (b.subject === '— 미분류') return -1;
    return a.subject.localeCompare(b.subject, 'ko');
  });
  // 그룹 내 정렬: dueDate asc, null 뒤
  for (const g of groups) sortItemsForGroup(g.items);
  return groups;
}

/** 목표별 그룹핑. cardGoals[key=ticketKey or jiraCardId] → goalId. items 는 Initiative 객체. */
function groupByGoal(items, goals, cardGoals) {
  const goalMap = new Map(goals.map(g => [g.id, g]));
  const buckets = new Map();   // subject = goal.title, items = []
  const noGoal = [];
  for (const it of items) {
    const cardId = `jira-${it.key}`;
    const gid = cardGoals[cardId];
    const g = gid && goalMap.get(gid);
    if (g) {
      if (!buckets.has(g.id)) buckets.set(g.id, { subject: g.title, items: [], _goal: g });
      buckets.get(g.id).items.push(it);
    } else {
      noGoal.push(it);
    }
  }
  const sorted = sortGoals(goals).map(g => buckets.get(g.id)).filter(Boolean);
  if (noGoal.length) sorted.push({ subject: '— 목표 미지정', items: noGoal });
  for (const g of sorted) sortItemsForGroup(g.items);
  return sorted;
}

function sortItemsForGroup(items) {
  items.sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  });
}

/* ----------------- 헤더 (좌/우 패널 분리) ----------------- */

function renderMetaHead(cols, template) {
  const row = document.createElement('div');
  row.className = 'gm-head';
  row.style.gridTemplateColumns = template;
  for (const c of cols) {
    const d = document.createElement('div');
    d.className = 'gh-meta';
    d.textContent = c.label;
    row.appendChild(d);
  }
  return row;
}

function renderTimeHead(axis, template, minWidth) {
  const row = document.createElement('div');
  row.className = 'gt-head';
  row.style.gridTemplateColumns = template;
  if (minWidth) row.style.minWidth = `${minWidth}px`;
  for (const cell of axis.cells) {
    const d = document.createElement('div');
    d.className = 'gh-time' + (cell.isCurrent ? ' current' : '');
    d.textContent = cell.label;
    row.appendChild(d);
  }
  return row;
}

/* ----------------- 그룹 헤더 (양쪽 패널 한 줄씩) ----------------- */

function renderGroupMetaRow(group, collapsed, onToggle, opts = {}) {
  const row = document.createElement('div');
  row.className = 'gm-group' + (opts.isSub ? ' gm-subgroup' : '');
  const key = opts.key || group.subject;
  row.dataset.subject = key;
  const count = group.count != null ? group.count : (group.items ? group.items.length : 0);
  row.innerHTML = `
    <span class="caret ${collapsed ? '' : 'open'}">▸</span>
    <span>${escapeHtml(group.subject)}</span>
    <span class="ct">${count}건</span>
  `;
  row.addEventListener('click', () => onToggle && onToggle(key));
  return row;
}

function renderGroupTimeRow(template, goal, axis, minWidth, isSub = false) {
  // 시간 패널의 그룹 행 — 메타 행과 높이 맞춤 + 매칭된 목표가 있으면 기간 막대
  const row = document.createElement('div');
  row.className = 'gt-group' + (isSub ? ' gt-subgroup' : '');
  row.style.gridTemplateColumns = template;
  if (minWidth) row.style.minWidth = `${minWidth}px`;
  row.style.position = 'relative';
  if (goal && axis) {
    const pos = goalToAxisBar(goal, axis.totalStart, axis.totalEnd);
    if (pos) {
      const bar = document.createElement('div');
      bar.className = 'goalbar';
      bar.dataset.color = goal.color || 'accent';
      bar.style.position = 'absolute';
      bar.style.top = '50%';
      bar.style.transform = 'translateY(-50%)';
      bar.style.left = `${(pos.leftFrac * 100).toFixed(3)}%`;
      bar.style.width = `${Math.max(pos.widthFrac * 100, 1.5).toFixed(3)}%`;
      bar.textContent = goal.title;
      bar.setAttribute('data-tip', `${goal.title} · ${fmtPeriod(goal)}`);
      bar.setAttribute('data-tip-wide', '');
      row.appendChild(bar);
    }
  }
  return row;
}

/* ----------------- 데이터 행 (양쪽 패널 한 줄씩) ----------------- */

function renderItemMetaRow(item, cols, template, nested = false) {
  const row = document.createElement('div');
  row.className = 'gm-row' + (nested ? ' gm-row-nested' : '');
  row.style.gridTemplateColumns = template;
  for (const c of cols) {
    const cell = document.createElement('div');
    cell.innerHTML = renderMetaCell(c, item);
    row.appendChild(cell);
  }
  return row;
}

function renderItemTimeRow(item, axis, mode, template, minWidth) {
  const row = document.createElement('div');
  row.className = 'gt-row';
  row.style.gridTemplateColumns = template;
  if (minWidth) row.style.minWidth = `${minWidth}px`;

  if (mode === 'month') {
    row.style.position = 'relative';
    for (const cell of axis.cells) {
      const c = document.createElement('div');
      c.className = 'g-cell' + (cell.isCurrent ? ' current' : '');
      row.appendChild(c);
    }
    let barEl = makeMonthBar(item, axis);
    // 분기 줌인데 일자가 없어 막대가 안 그려지면(yearQuarter 만 보유), 해당 분기에 걸친 경우
    // 분기 전체를 덮는 흐린 막대로 폴백 — 행만 있고 막대가 비는 혼란 방지.
    if (!barEl && axis.focusQuarter && quartersForItem(item).has(axis.focusQuarter)) {
      barEl = makeBarElement(item);
      barEl.classList.add('fade');
      barEl.style.position = 'absolute';
      barEl.style.top = '50%';
      barEl.style.transform = 'translateY(-50%)';
      barEl.style.left = '4px';
      barEl.style.right = '4px';
    }
    if (barEl) row.appendChild(barEl);
  } else {
    // 분기 모드: startDate~dueDate 가 걸친 분기 모두에 막대.
    // dueDate 만 있으면 그 분기, 둘 다 없으면 yearQuarter fallback.
    // 이전: yearQuarter 만 사용 → Jira 의 yearQuarter / dueDate 불일치 시 잘못된 분기에 표시됨.
    const activeQuarters = quartersForItem(item);
    for (const cell of axis.cells) {
      const c = document.createElement('div');
      c.className = 'g-cell' + (cell.isCurrent ? ' current' : '');
      if (activeQuarters.has(cell.key)) {
        const bar = makeBarElement(item);
        bar.style.left = '4px';
        bar.style.right = '4px';
        c.appendChild(bar);
      }
      row.appendChild(c);
    }
  }
  return row;
}

/** YYYY-MM-DD → 'YYYY-Q[1-4]'. invalid → null. */
function dateToQuarterKey(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const y = d.getFullYear();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${y}-Q${q}`;
}

/** 막대를 표시할 분기 key Set.
 *  우선순위:
 *   1) startDate~dueDate 범위가 걸친 모든 분기 (둘 다 있을 때)
 *   2) endQ (dueDate 만 있을 때)
 *   3) startQ (startDate 만 있을 때)
 *   4) item.yearQuarters (복수 분기 — Jira 멀티 셀렉트, 예: 2025-Q4 + 2026-Q1)
 *   5) item.yearQuarter (단일 — 하위호환)
 */
export function quartersForItem(item) {
  const startQ = dateToQuarterKey(item.startDate);
  const endQ = dateToQuarterKey(item.dueDate);
  const set = new Set();
  if (startQ && endQ) {
    let [sy, sq] = startQ.split('-Q').map(Number);
    const [ey, eq] = endQ.split('-Q').map(Number);
    if (sy > ey || (sy === ey && sq > eq)) [sy, sq] = [ey, eq];
    let cy = sy, cq = sq;
    let safety = 0;
    while ((cy < ey || (cy === ey && cq <= eq)) && safety++ < 20) {
      set.add(`${cy}-Q${cq}`);
      cq++; if (cq > 4) { cq = 1; cy++; }
    }
  } else if (endQ) {
    set.add(endQ);
  } else if (startQ) {
    set.add(startQ);
  } else if (Array.isArray(item.yearQuarters) && item.yearQuarters.length) {
    for (const yq of item.yearQuarters) set.add(yq);
  } else if (item.yearQuarter) {
    set.add(item.yearQuarter);
  }
  return set;
}

function renderMetaCell(c, item) {
  switch (c.id) {
    case 'key': {
      const url = jiraUrl(item.key) || '#';
      return `<a class="key" href="${url}" target="_blank" rel="noopener noreferrer" data-jira-key="${escapeAttr(item.key)}">${escapeHtml(item.key || '')}</a>`;
    }
    case 'summary': {
      const s = item.summary || '—';
      return `<span class="g-title" title="${escapeAttr(s)}" style="font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;width:100%">${escapeHtml(s)}</span>`;
    }
    case 'priority':
      return `<span class="pri pri-${(item.priority || '').toLowerCase() || 'p3'}">${escapeHtml(item.priority || '—')}</span>`;
    case 'status': {
      const cls = statusClass(item.statusCategory, item.status);
      return `<span class="${cls}" title="${escapeAttr(item.status || '')}">${escapeHtml(item.status || '—')}</span>`;
    }
    case 'due':
      return `<span class="date">${item.dueDate ? fmtDate(item.dueDate) : '—'}</span>`;
    case 'start':
      return `<span class="date">${item.startDate ? fmtDate(item.startDate) : '—'}</span>`;
    case 'yq':
      return `<span class="num" style="font-size:11px;color:var(--dim)">${escapeHtml(item.yearQuarter || '—')}</span>`;
    case 'assignee':
      return `<span class="who">${escapeHtml((item.assignee && item.assignee.name) || '—')}</span>`;
    case 'labels':
      return (item.labels || []).slice(0, 3).map(l => `<span class="tag" style="margin-right:4px">${escapeHtml(l)}</span>`).join('') || '—';
  }
  return '';
}

/* ----------------- 간트 바 ----------------- */

function makeBarElement(item) {
  const bar = document.createElement('div');
  const sc = subjectClass(item.mainSubject);
  bar.className = `g-bar ${sc}`;
  bar.textContent = item.key;
  bar.dataset.jiraKey = item.key;
  bar.setAttribute('data-tip', `${item.key} · ${item.summary || ''} · ${(item.assignee && item.assignee.name) || '—'} · ${item.startDate || '?'}~${item.dueDate || '?'}`);
  bar.setAttribute('data-tip-wide', '');
  bar.style.cursor = 'pointer';
  bar.addEventListener('click', e => {
    e.stopPropagation();
    const url = jiraUrl(item.key);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  });
  return bar;
}

function makeMonthBar(item, axis) {
  const totalMs = axis.totalEnd - axis.totalStart;
  const start = item.startDate ? new Date(item.startDate) : null;
  const end = item.dueDate ? new Date(item.dueDate) : null;

  if (!start && !end) return null; // 둘 다 X → 점도 일단 생략 (행 끝 점은 옵션)

  let leftFrac, widthFrac, faded = false;
  if (start && end) {
    const s = Math.max(start, axis.totalStart);
    const e = Math.min(new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1), axis.totalEnd);
    if (e <= axis.totalStart || s >= axis.totalEnd) return null; // 축 범위 밖
    leftFrac = (s - axis.totalStart) / totalMs;
    widthFrac = (e - s) / totalMs;
  } else {
    // 시작일 X, 기한 O → 기한이 속한 월의 1일 ~ 기한+1일 (DUE 컬럼에 정확히 매핑)
    if (!end) return null;
    const monthStart = new Date(end.getFullYear(), end.getMonth(), 1);
    const sClamped = Math.max(monthStart, axis.totalStart);
    const eClamped = Math.min(new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1), axis.totalEnd);
    if (eClamped <= axis.totalStart || sClamped >= axis.totalEnd) return null;
    leftFrac = (sClamped - axis.totalStart) / totalMs;
    widthFrac = (eClamped - sClamped) / totalMs;
    faded = true;
  }

  const bar = makeBarElement(item);
  if (faded) bar.classList.add('fade');
  bar.style.position = 'absolute';
  bar.style.top = '50%';
  bar.style.transform = 'translateY(-50%)';
  bar.style.left = `${(leftFrac * 100).toFixed(3)}%`;
  bar.style.width = `${Math.max(widthFrac * 100, 1.2).toFixed(3)}%`;
  return bar;
}

/* ----------------- helpers ----------------- */

function statusClass(category, name) {
  if (category === 'done') return 'st st-done';
  if (category === 'indeterminate') return 'st st-progress';
  if (category === 'new') return 'st st-prop';
  if (name === '반려' || name === 'DROPPED') return 'st st-rejected';
  return 'st st-wait';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
