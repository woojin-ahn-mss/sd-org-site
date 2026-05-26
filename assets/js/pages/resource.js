/* =========================================================
   pages/resource.js — 리소스 페이지
   PRD 4.4: 프로젝트별·담당자별 일감 분배 균형 파악, 과부하/빈 자리 조정
   ========================================================= */

import { loadJson } from '../fetch-data.js';
import { showError, showLoading, emptyHtml } from '../states.js';
import { fmtDate, fmtNum } from '../format.js';
import { statusGroup } from '../charts.js';
import { openDrilldown } from '../drilldown.js';
import { escapeHtml, escapeAttr } from '../escape.js';

const PROJECTS = ['CBP', 'PBO', 'PEL', 'TM', 'MSSCXTF', 'TF', 'SNDPRD', 'CMALL'];
const OVERLOAD_THRESHOLD = 5;        // 5건 이상 In Progress
const OVERLOAD_HIGH = 8;             // 8건 이상 = high
const OVERLOAD_PRIO_THRESHOLD = 3;   // P0/P1 3건 이상

export async function renderResource({ rootRel = '' } = {}) {
  const host = document.getElementById('resource-host');
  showLoading(host, { rows: 6 });

  let data;
  try {
    data = await loadJson(`${rootRel}data/jira/all-tickets.json`);
  } catch (err) {
    console.error('[resource]', err);
    showError(host, err);
    return;
  }

  // 진행 중만
  const open = (data.items || []).filter(it => statusGroup(it) !== 'done');

  // 헤더
  renderHeader(open);
  // 프로젝트별 부하
  renderProjectLoad(open);
  // 담당자 × 프로젝트 히트맵
  renderHeatmap(open);
  // 과부하 알림 테이블
  renderOverload(open);

  host.innerHTML = '';
}

/* ----- 헤더 ----------------------------------------------- */

function renderHeader(open) {
  const lede = document.querySelector('[data-lede]');
  if (!lede) return;
  if (!open.length) {
    lede.innerHTML = '데이터 동기화를 기다리는 중. 사이드바 푸터의 last sync 확인.';
    return;
  }
  const people = new Set(open.map(it => it.assignee?.name).filter(Boolean));
  const overload = computeOverload(open);
  lede.innerHTML =
    `<strong class="num">${people.size}</strong>명 · ` +
    `<strong class="num">${activeProjects(open).length}</strong>개 프로젝트 · ` +
    `진행 중 <strong class="num">${open.length}</strong>건. ` +
    `과부하 의심 <strong class="num">${overload.length}</strong>명.`;
}

/* ----- 프로젝트별 부하 ------------------------------------- */

function renderProjectLoad(open) {
  const host = document.getElementById('sec-load');
  if (!host) return;
  if (!open.length) {
    host.innerHTML = emptyHtml({ kicker: 'NO DATA', msg: '진행 중 데이터 없음' });
    return;
  }

  const seen = new Set(open.map(it => it.project).filter(Boolean));
  const projects = [
    ...PROJECTS.filter(p => seen.has(p)),
    ...[...seen].filter(p => !PROJECTS.includes(p)).sort(),
  ];

  const rows = projects.map(proj => {
    const sub = open.filter(it => it.project === proj);
    const people = new Set(sub.map(it => it.assignee?.name).filter(Boolean));
    const p0 = sub.filter(it => normPri(it.priority) === 'P0').length;
    const p1 = sub.filter(it => normPri(it.priority) === 'P1').length;
    return { proj, count: sub.length, people: people.size, p0, p1 };
  });
  const maxCount = Math.max(1, ...rows.map(r => r.count));

  const wrap = document.createElement('div');
  wrap.className = 'row-list';
  rows.forEach(r => {
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.style.gridTemplateColumns = '110px 1fr 70px 130px';
    row.style.cursor = 'pointer';
    row.title = `${r.proj} 진행 중 ${r.count}건 · ${r.people}명 · P0 ${r.p0} · P1 ${r.p1}`;
    row.addEventListener('click', () => {
      openDrilldown(open.filter(it => it.project === r.proj), { kicker: r.proj });
    });

    const stack = `
      <div class="bar-stack">
        <span style="width:${(r.count / maxCount) * 100}%; background: var(--accent)"></span>
      </div>
    `;
    row.innerHTML = `
      <span class="proj">${escapeHtml(r.proj)}</span>
      ${stack}
      <span class="num">${r.count}건</span>
      <span class="num right dim-mono">${r.people}명 · P0 <span class="${r.p0 ? 'pri-tone-p0' : ''}">${r.p0}</span> · P1 <span class="${r.p1 ? 'pri-tone-p1' : ''}">${r.p1}</span></span>
    `;
    wrap.appendChild(row);
  });

  host.innerHTML = '';
  host.appendChild(wrap);
}

/* ----- 담당자 × 프로젝트 히트맵 ---------------------------- */

function renderHeatmap(open) {
  const host = document.getElementById('sec-heat');
  if (!host) return;
  if (!open.length) {
    host.innerHTML = emptyHtml({ kicker: 'NO DATA', msg: '진행 중 데이터 없음' });
    return;
  }

  const people = [...new Set(open.map(it => it.assignee?.name).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ko'));
  const projectsAll = activeProjects(open);

  // 카운트 매트릭스
  const matrix = {};
  for (const p of people) {
    matrix[p] = {};
    for (const proj of projectsAll) matrix[p][proj] = 0;
  }
  for (const it of open) {
    const a = it.assignee?.name;
    const pj = it.project;
    if (!a || !pj || !matrix[a] || !(pj in matrix[a])) continue;
    matrix[a][pj]++;
  }

  // 레벨 계산 (1~4)
  function level(v) {
    if (v <= 0) return 0;
    if (v === 1) return 1;
    if (v === 2) return 2;
    if (v === 3) return 3;
    return 4;
  }

  const grid = document.createElement('div');
  grid.className = 'heat';
  grid.style.gridTemplateColumns = `120px repeat(${projectsAll.length}, 1fr)`;

  // header row
  grid.appendChild(emptyDiv());
  projectsAll.forEach(proj => {
    const h = document.createElement('div');
    h.className = 'heat-collabel';
    h.textContent = proj;
    h.style.cursor = 'pointer';
    h.title = `${proj} 진행 중 전체 보기`;
    h.addEventListener('click', () => {
      openDrilldown(open.filter(it => it.project === proj), { kicker: proj });
    });
    grid.appendChild(h);
  });

  // body rows
  people.forEach(person => {
    const label = document.createElement('div');
    label.className = 'heat-rowlabel';
    label.style.cursor = 'pointer';
    label.title = `${person} 담당 진행 중 전체 보기`;
    label.innerHTML = `<span class="who"><span class="who-dot"></span>${escapeHtml(person)}</span>`;
    label.addEventListener('click', () => {
      openDrilldown(open.filter(it => it.assignee?.name === person), { kicker: person });
    });
    grid.appendChild(label);

    projectsAll.forEach(proj => {
      const v = matrix[person][proj];
      const cell = document.createElement('div');
      cell.className = 'heat-cell' + (v > 0 ? ' l' + level(v) : '');
      cell.textContent = v > 0 ? v : '';
      cell.title = v > 0 ? `${person} · ${proj} — ${v}건` : `${person} · ${proj} — 0건`;
      if (v > 0) {
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', () => {
          openDrilldown(
            open.filter(it => it.assignee?.name === person && it.project === proj),
            { kicker: `${person} · ${proj}` }
          );
        });
      }
      grid.appendChild(cell);
    });
  });

  // legend
  const legend = document.createElement('div');
  legend.className = 'flex gap-8 heat-legend';
  legend.innerHTML = `
    <span>LOAD</span>
    ${[0, 1, 2, 3, 4].map(l =>
      `<div class="heat-cell heat-legend-cell${l ? ' l' + l : ''}">${l || ''}</div>`
    ).join('')}
    <span>0 → 4+</span>
  `;

  host.innerHTML = '';
  host.appendChild(grid);
  host.appendChild(legend);
}

function emptyDiv() {
  return document.createElement('div');
}

/* ----- 과부하 알림 테이블 ---------------------------------- */

function renderOverload(open) {
  const host = document.getElementById('sec-overload');
  const countEl = document.querySelector('[data-count="cnt-overload"]');
  if (!host) return;

  const rows = computeOverload(open);
  if (countEl) countEl.textContent = rows.length;

  if (!rows.length) {
    host.innerHTML = emptyHtml({ kicker: 'OK', msg: '과부하 의심 인원 없음' });
    return;
  }

  const trs = rows.map(r => {
    const tone = r.level === 'high' ? 'pri-tone-p0' : 'pri-tone-p1';
    const levelLabel = r.level === 'high' ? 'HIGH' : 'WARN';
    const dueClass = r.soonDueOverdue ? 'date num alert-color' : 'date num';
    return `
      <tr data-name="${escapeAttr(r.name)}">
        <td><span class="who"><span class="who-dot"></span>${escapeHtml(r.name)}</span></td>
        <td class="right num overload-total">${r.total}건</td>
        <td class="right num ${r.p0 ? 'pri-tone-p0' : 'dim'}">${r.p0}</td>
        <td class="right num ${r.p1 ? 'pri-tone-p1' : 'dim'}">${r.p1}</td>
        <td class="${dueClass}">${r.soonDue ? fmtDate(r.soonDue) : '—'}${r.soonDueOverdue ? ' (지연)' : ''}</td>
        <td><span class="${tone}">${levelLabel}</span></td>
      </tr>
    `;
  }).join('');

  host.innerHTML = `
    <table class="tbl">
      <thead><tr>
        <th>담당자</th>
        <th class="right" style="width:100px">진행 중</th>
        <th class="right" style="width:70px">P0</th>
        <th class="right" style="width:70px">P1</th>
        <th style="width:130px">가장 임박</th>
        <th style="width:90px">레벨</th>
      </tr></thead>
      <tbody>${trs}</tbody>
    </table>
    <p class="muted dim-mono mt-12">
      기준: 진행 중 ${OVERLOAD_THRESHOLD}건 이상 또는 P0/P1 ${OVERLOAD_PRIO_THRESHOLD}건 이상 · ${OVERLOAD_HIGH}건 이상은 HIGH · 미래 마감 없으면 가장 최근 과거 마감(지연) 표시
    </p>
  `;

  // 클릭 → 담당자 드릴다운
  host.querySelectorAll('tr[data-name]').forEach(tr => {
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => {
      const name = tr.getAttribute('data-name');
      openDrilldown(
        open.filter(it => it.assignee?.name === name),
        { kicker: name }
      );
    });
  });
}

export function computeOverload(open, { now = new Date() } = {}) {
  // 담당자별 집계
  const byPerson = new Map();
  for (const it of open) {
    const name = it.assignee?.name;
    if (!name) continue;
    if (!byPerson.has(name)) byPerson.set(name, []);
    byPerson.get(name).push(it);
  }

  // KST 자정 기준의 '오늘' (YYYY-MM-DD) 문자열
  const todayYmd = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

  const rows = [];
  for (const [name, items] of byPerson) {
    const total = items.length;
    const p0 = items.filter(it => normPri(it.priority) === 'P0').length;
    const p1 = items.filter(it => normPri(it.priority) === 'P1').length;
    if (total < OVERLOAD_THRESHOLD && (p0 + p1) < OVERLOAD_PRIO_THRESHOLD) continue;
    // 리뷰 Important #11 — 미래 마감 우선, 없으면 과거 중 가장 최근 (지연된 것)
    const dates = items.map(it => it.dueDate).filter(Boolean);
    const future = dates.filter(d => d >= todayYmd).sort();
    const past = dates.filter(d => d < todayYmd).sort();
    const soonDue = future[0] || (past.length ? past[past.length - 1] : null);
    const soonDueOverdue = !future.length && !!soonDue; // 표시용 플래그
    const level = total >= OVERLOAD_HIGH ? 'high' : 'warn';
    rows.push({ name, total, p0, p1, soonDue, soonDueOverdue, level });
  }
  // 정렬: high 먼저, 그 안에서 total 내림차순
  return rows.sort((a, b) => {
    if (a.level !== b.level) return a.level === 'high' ? -1 : 1;
    return b.total - a.total;
  });
}

export { normPri };

/* ----- helpers -------------------------------------------- */

function activeProjects(open) {
  const seen = new Set(open.map(it => it.project).filter(Boolean));
  return [
    ...PROJECTS.filter(p => seen.has(p)),
    ...[...seen].filter(p => !PROJECTS.includes(p)).sort(),
  ];
}

function normPri(p) {
  if (!p) return null;
  const s = String(p).toUpperCase().trim();
  if (s.startsWith('P')) return s.slice(0, 2);
  // Highest/High/Medium/Low 매핑
  if (s === 'HIGHEST') return 'P0';
  if (s === 'HIGH') return 'P1';
  if (s === 'MEDIUM' || s === 'NORMAL') return 'P2';
  if (s === 'LOW' || s === 'LOWEST') return 'P3';
  return null;
}

