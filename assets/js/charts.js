/* =========================================================
   charts.js — 순수 SVG 차트 컴포넌트 (외부 라이브러리 X)
   디자인 시스템 토큰 + 클래스 활용:
     .donut / .donut .seg.s-*       (도넛)
     .summary-bar / .summary-legend (가로 스택 바)
     .bar-row / .bar-stack          (프로젝트별 흐름)
   다크/라이트 동등 지원 — 색은 토큰 (var(--accent) 등) 으로 전달.
   ========================================================= */

import { escapeHtml } from './escape.js';

/**
 * PRD 10.2 상태 그룹 매핑.
 *   "In Progress" / "개발중" / "검토완료-우선착수" → progress
 *   "Tech 검토 중" / "PMO 검토 중" / "검토중"      → review
 *   "Tech 검토 대기 중" / "검토완료-백로그" / "대기" / "Backlog" → wait
 *   "발의" / "매니저 승인 대기"                    → prop
 *   "완료" / "Done" / "론치완료"                  → done
 *   "반려" / "DROPPED"                            → rejected
 */
export const STATUS_GROUPS = [
  { id: 'progress', label: 'In Progress', cssVar: '--accent',   stClass: 'st-progress' },
  { id: 'review',   label: '검토 중',      cssVar: '--info',     stClass: 'st-review'   },
  { id: 'wait',     label: '대기',         cssVar: '--faintest', stClass: 'st-wait'     },
  { id: 'prop',     label: '발의',         cssVar: '--faint',    stClass: 'st-prop'     },
  { id: 'done',     label: '완료',         cssVar: '--success',  stClass: 'st-done'     },
  { id: 'rejected', label: '반려',         cssVar: '--alert',    stClass: 'st-rejected' },
];

const STATUS_NAME_MAP = new Map([
  // progress
  ['In Progress', 'progress'], ['개발중', 'progress'], ['검토완료-우선착수', 'progress'],
  // review
  ['Tech 검토 중', 'review'], ['PMO 검토 중', 'review'], ['검토중', 'review'], ['검토 중', 'review'],
  // wait
  ['Tech 검토 대기 중', 'wait'], ['검토완료-백로그', 'wait'], ['대기', 'wait'], ['Backlog', 'wait'],
  // prop
  ['발의', 'prop'], ['매니저 승인 대기', 'prop'],
  // done
  ['완료', 'done'], ['Done', 'done'], ['론치완료', 'done'],
  // rejected
  ['반려', 'rejected'], ['DROPPED', 'rejected'],
]);

const _warnedUnknownStatuses = new Set();

/** 티켓 → 상태 그룹 id ('progress' | 'review' | 'wait' | 'prop' | 'done' | 'rejected') */
export function statusGroup(item) {
  if (!item) return 'wait';
  const byName = STATUS_NAME_MAP.get(item.status);
  if (byName) return byName;
  switch (item.statusCategory) {
    case 'done': return 'done';
    case 'indeterminate': return 'progress';
    case 'new': return 'prop';
    default:
      // Jira에 새 워크플로우 상태가 추가되면 운영 인지 위해 1회 경고
      if (item.status && !_warnedUnknownStatuses.has(item.status)) {
        _warnedUnknownStatuses.add(item.status);
        console.warn('[charts] unknown status — bucketed as "wait":', item.status, '(category:', item.statusCategory, ')');
      }
      return 'wait';
  }
}

/* =========================================================
   Donut — SVG. 디자인의 .donut / .seg.s-* 활용.
   ========================================================= */

/**
 * @param {Array<{id:string, label:string, value:number, cssVar?:string}>} segments
 * @param {{ size?: number, stroke?: number, centerVal?: string|number, centerSub?: string,
 *           onSegmentClick?: (segmentId:string) => void }} opts
 * @returns {SVGElement}
 */
export function donut(segments, opts = {}) {
  const { size = 180, stroke = 18, centerVal, centerSub, onSegmentClick } = opts;
  const total = segments.reduce((s, x) => s + (x.value || 0), 0);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'donut');
  svg.setAttribute('role', 'img');

  // Track
  const track = document.createElementNS(ns, 'circle');
  track.setAttribute('class', 'track');
  track.setAttribute('cx', size / 2);
  track.setAttribute('cy', size / 2);
  track.setAttribute('r', r);
  track.setAttribute('stroke-width', stroke);
  svg.appendChild(track);

  // Segments
  let acc = 0;
  for (const seg of segments) {
    const v = Math.max(0, Number(seg.value) || 0);
    if (v <= 0) continue;
    const len = (v / total) * c;
    const offset = c - len;
    const rot = (acc / total) * 360 - 90;
    const path = document.createElementNS(ns, 'circle');
    path.setAttribute('class', `seg s-${seg.id}`);
    path.setAttribute('cx', size / 2);
    path.setAttribute('cy', size / 2);
    path.setAttribute('r', r);
    path.setAttribute('stroke-width', stroke);
    path.setAttribute('stroke-dasharray', `${len} ${c}`);
    path.setAttribute('stroke-dashoffset', 0);
    path.setAttribute('transform', `rotate(${rot} ${size / 2} ${size / 2})`);
    if (seg.cssVar) path.setAttribute('stroke', `var(${seg.cssVar})`);
    path.style.cursor = onSegmentClick ? 'pointer' : '';
    if (onSegmentClick) {
      path.addEventListener('click', () => onSegmentClick(seg.id));
    }
    const title = document.createElementNS(ns, 'title');
    title.textContent = `${seg.label} — ${v}건 (${total ? Math.round(v / total * 100) : 0}%)`;
    path.appendChild(title);
    svg.appendChild(path);
    acc += v;
  }

  // Center text — dominant-baseline 으로 폰트-크기 의존 매직 오프셋 제거 (리뷰 Critical #3)
  if (centerVal != null || centerSub) {
    const cx = size / 2, cy = size / 2;
    if (centerVal != null) {
      const t1 = document.createElementNS(ns, 'text');
      t1.setAttribute('class', 'donut-center');
      t1.setAttribute('x', cx);
      t1.setAttribute('y', centerSub ? cy - 8 : cy);
      t1.setAttribute('dominant-baseline', 'central');
      t1.textContent = String(centerVal);
      svg.appendChild(t1);
    }
    if (centerSub) {
      const t2 = document.createElementNS(ns, 'text');
      t2.setAttribute('class', 'donut-center-sub');
      t2.setAttribute('x', cx);
      t2.setAttribute('y', centerVal != null ? cy + 12 : cy);
      t2.setAttribute('dominant-baseline', 'central');
      t2.textContent = centerSub;
      svg.appendChild(t2);
    }
  }

  return svg;
}

/* =========================================================
   Summary bar (가로 스택) — design의 .summary-bar 클래스 사용
   ========================================================= */
/**
 * @param {Array<{id:string,label:string,value:number,cssVar?:string}>} segments
 * @param {{ onSegmentClick?: (id:string) => void, minLabelWidth?: number }} opts
 * @returns {HTMLElement} <div class="summary-bar">
 */
export function summaryBar(segments, opts = {}) {
  const { onSegmentClick, minLabelWidth = 4 } = opts;
  const total = segments.reduce((s, x) => s + (x.value || 0), 0);
  const wrap = document.createElement('div');
  wrap.className = 'summary-bar';
  if (total === 0) {
    wrap.style.opacity = '0.4';
    const empty = document.createElement('span');
    empty.style.width = '100%';
    empty.style.background = 'var(--faintest)';
    empty.textContent = '';
    wrap.appendChild(empty);
    return wrap;
  }
  for (const seg of segments) {
    const v = Math.max(0, Number(seg.value) || 0);
    if (v === 0) continue;
    const span = document.createElement('span');
    const pct = (v / total) * 100;
    span.style.width = pct + '%';
    if (seg.cssVar) span.style.background = `var(${seg.cssVar})`;
    span.style.color = seg.id === 'wait' ? 'var(--text)' : 'var(--bg)';
    span.title = `${seg.label} — ${v}건 (${Math.round(pct)}%)`;
    span.textContent = (pct >= minLabelWidth) ? String(v) : '';
    if (onSegmentClick) {
      span.style.cursor = 'pointer';
      span.addEventListener('click', () => onSegmentClick(seg.id));
    }
    wrap.appendChild(span);
  }
  return wrap;
}

/* =========================================================
   Summary legend (범례) — .summary-legend
   ========================================================= */
/**
 * @param {Array<{id:string,label:string,value:number,cssVar?:string}>} segments
 * @returns {HTMLElement} <ul class="summary-legend">
 */
export function summaryLegend(segments) {
  const ul = document.createElement('ul');
  ul.className = 'summary-legend';
  ul.style.listStyle = 'none';
  ul.style.padding = '0';
  ul.style.margin = '8px 0 0';
  for (const seg of segments) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="sw" style="background: var(${seg.cssVar || '--faintest'});"></span>
      <span>${escapeHtml(seg.label)}</span>
      <span class="ct num">${Number(seg.value) || 0}</span>
    `;
    ul.appendChild(li);
  }
  return ul;
}

/* =========================================================
   Project stacked bars — .bar-row / .bar-stack
   ========================================================= */
/**
 * @param {Array<{ proj:string, total:number, parts: Array<{id,value,cssVar}> }>} rows
 * @param {{ onCellClick?: (proj:string, segmentId:string) => void }} opts
 * @returns {HTMLElement} <div class="row-list">
 */
export function projectStackBars(rows, opts = {}) {
  const { onCellClick } = opts;
  const wrap = document.createElement('div');
  wrap.className = 'row-list';
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'bar-row';

    const projEl = document.createElement('span');
    projEl.className = 'proj';
    projEl.textContent = r.proj;

    const stack = document.createElement('div');
    stack.className = 'bar-stack';
    const total = r.total || r.parts.reduce((s, p) => s + (p.value || 0), 0);
    for (const part of r.parts) {
      if (!(part.value > 0)) continue;
      const s = document.createElement('span');
      const pct = total ? (part.value / total) * 100 : 0;
      s.style.width = pct + '%';
      s.style.background = `var(${part.cssVar})`;
      s.title = `${r.proj} · ${part.label || part.id} — ${part.value}건`;
      if (onCellClick) {
        s.style.cursor = 'pointer';
        s.addEventListener('click', () => onCellClick(r.proj, part.id));
      }
      stack.appendChild(s);
    }

    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = String(total);

    row.appendChild(projEl);
    row.appendChild(stack);
    row.appendChild(num);
    wrap.appendChild(row);
  }
  return wrap;
}

