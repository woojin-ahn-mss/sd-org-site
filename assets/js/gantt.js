/* =========================================================
   gantt.js — Gantt grid 렌더 (PRD 4.5)
   - 분기 모드: yearQuarter 셀 단일 채우기
   - 월 모드: 시작일~기한 가로 span / 시작일 X + 기한만 → 좌측 14일 fade / 둘 다 X → 점
   - design system .g-* 클래스 그대로 사용. 새 색·폰트 금지.
   ========================================================= */

import { jiraUrl } from './jira-link.js';
import { fmtDate } from './format.js';

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
    // 12개월 — 현재 월 기준 -3 ~ +8 (총 12개)
    const start = new Date(anchor.getFullYear(), anchor.getMonth() - 3, 1);
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

/** 메인 렌더 */
export function renderGantt(host, opts) {
  const { mode = 'quarter', items, columns = COLUMNS.filter(c => c.default).map(c => c.id),
          collapsedGroups = new Set(), onGroupToggle } = opts;
  const axis = buildTimeAxis(mode);
  const grouped = groupBySubject(items);
  const activeCols = COLUMNS.filter(c => columns.includes(c.id) || c.required);

  const metaCols = activeCols.map(c => `${c.width}px`).join(' ');
  const timeColsCount = axis.cells.length;
  const gridTemplate = `${metaCols} repeat(${timeColsCount}, minmax(60px, 1fr))`;

  const root = document.createElement('div');
  root.className = 'gantt';

  const grid = document.createElement('div');
  grid.className = 'g-grid';
  grid.style.gridTemplateColumns = gridTemplate;

  // 헤더
  grid.appendChild(renderHead(activeCols, axis));

  // 그룹별 행
  for (const group of grouped) {
    const collapsed = collapsedGroups.has(group.subject);
    grid.appendChild(renderGroupHead(group, collapsed, timeColsCount, activeCols.length, onGroupToggle));
    if (!collapsed) {
      for (const item of group.items) {
        grid.appendChild(renderItemRow(item, activeCols, axis, mode));
      }
    }
  }

  if (!grouped.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<span class="empty-kicker">EMPTY</span><span class="empty-msg">조건에 맞는 Initiative 없음</span>';
    root.appendChild(empty);
  } else {
    root.appendChild(grid);
  }

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
  for (const g of groups) {
    g.items.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    });
  }
  return groups;
}

/* ----------------- 헤더 ----------------- */

function renderHead(cols, axis) {
  const head = document.createElement('div');
  head.className = 'g-head';
  head.style.display = 'contents';
  for (const c of cols) {
    const d = document.createElement('div');
    d.className = 'gh-meta';
    d.textContent = c.label;
    head.appendChild(d);
  }
  for (const cell of axis.cells) {
    const d = document.createElement('div');
    d.className = 'gh-time' + (cell.isCurrent ? ' current' : '');
    d.textContent = cell.label;
    head.appendChild(d);
  }
  return head;
}

/* ----------------- 그룹 헤더 ----------------- */

function renderGroupHead(group, collapsed, timeCellsCount, metaColsCount, onToggle) {
  const row = document.createElement('div');
  row.className = 'g-row g-group';
  row.style.display = 'contents';
  row.dataset.subject = group.subject;

  const head = document.createElement('div');
  head.style.gridColumn = `1 / span ${metaColsCount + timeCellsCount}`;
  head.style.cursor = 'pointer';
  head.style.padding = '8px 0';
  head.style.display = 'flex';
  head.style.alignItems = 'baseline';
  head.style.gap = '8px';
  head.style.fontFamily = 'var(--font-mono)';
  head.style.fontSize = '11px';
  head.style.color = 'var(--dim)';
  head.style.letterSpacing = '0.08em';
  head.style.textTransform = 'uppercase';
  head.style.borderBottom = '1px solid var(--rule-strong)';
  head.innerHTML = `
    <span class="caret ${collapsed ? '' : 'open'}">▸</span>
    <span>${escapeHtml(group.subject)}</span>
    <span class="ct">${group.items.length}건</span>
  `;
  head.addEventListener('click', () => onToggle && onToggle(group.subject));
  row.appendChild(head);
  return row;
}

/* ----------------- 데이터 행 ----------------- */

function renderItemRow(item, cols, axis, mode) {
  const row = document.createElement('div');
  row.className = 'g-row';
  row.style.display = 'contents';

  // meta cells
  const metaWrap = document.createElement('div');
  metaWrap.className = 'g-meta';
  metaWrap.style.gridColumn = `1 / span ${cols.length}`;
  metaWrap.style.display = 'grid';
  metaWrap.style.gridTemplateColumns = cols.map(c => `${c.width}px`).join(' ');
  metaWrap.style.gap = '0';
  metaWrap.style.padding = '0 12px 0 0';
  metaWrap.style.borderRight = '1px solid var(--rule)';
  for (const c of cols) {
    const cell = document.createElement('div');
    cell.style.display = 'flex';
    cell.style.alignItems = 'center';
    cell.style.padding = '0 6px';
    cell.innerHTML = renderMetaCell(c, item);
    metaWrap.appendChild(cell);
  }
  row.appendChild(metaWrap);

  // time cells
  if (mode === 'month') {
    // 12개 셀을 wrapper에 + bar 절대 위치
    const timeWrap = document.createElement('div');
    timeWrap.style.gridColumn = `${cols.length + 1} / span ${axis.cells.length}`;
    timeWrap.style.position = 'relative';
    timeWrap.style.display = 'grid';
    timeWrap.style.gridTemplateColumns = `repeat(${axis.cells.length}, 1fr)`;
    timeWrap.style.borderBottom = '1px solid var(--rule)';
    timeWrap.style.minHeight = '38px';
    timeWrap.style.background = 'var(--bg)';
    for (const cell of axis.cells) {
      const c = document.createElement('div');
      c.className = 'g-cell' + (cell.isCurrent ? ' current' : '');
      c.style.minHeight = '38px';
      timeWrap.appendChild(c);
    }
    const barEl = makeMonthBar(item, axis);
    if (barEl) timeWrap.appendChild(barEl);
    row.appendChild(timeWrap);
  } else {
    // 분기 모드: 각 cell 안에 g-bar
    for (const cell of axis.cells) {
      const c = document.createElement('div');
      c.className = 'g-cell' + (cell.isCurrent ? ' current' : '');
      if (item.yearQuarter === cell.key) {
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
    // 시작일 X, 기한 O → 기한 기준 왼쪽 14일 fade
    if (!end) return null;
    const e = end;
    const s = new Date(e.getFullYear(), e.getMonth(), e.getDate() - 14);
    if (e <= axis.totalStart || s >= axis.totalEnd) return null;
    const sClamped = Math.max(s, axis.totalStart);
    const eClamped = Math.min(new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1), axis.totalEnd);
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
