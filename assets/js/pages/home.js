/* =========================================================
   pages/home.js — 홈 페이지 데이터 로드 + 렌더
   PRD 4.1, design rule "KPI 카드 X" 준수
   ========================================================= */

import { loadJsonMap } from '../fetch-data.js';
import { showError, showEmpty, showLoading } from '../states.js';
import { jiraKeyHtml } from '../jira-link.js';
import { fmtDate, fmtAgo, daysUntil } from '../format.js';

const ETR_AWAITING_STATUSES = new Set(['발의', '매니저 승인 대기', 'Tech 검토 대기 중']);
const TOC_DESCRIPTIONS = {
  'home':         '오늘의 핵심 + 진입점',
  'roadmap':      '메인주제별 Initiative 타임라인',
  'progress':     '상태 분포·흐름·지연',
  'resource':     '프로젝트·담당자 부하',
  'performance':  '분기별 론치 + 임팩트',
  'briefing':     '2Q 회고 · 3Q 예고 (주제별)',
  'roadmap-plan': '1년 4분기 보드',
  'fasttrack':    '임원 요청 추적',
  'etr':          '외부 요청 / 본인 담당',
};

/** 메인 렌더 함수 */
export async function renderHome({ rootRel = '', pages }) {
  // 0) TOC 는 데이터 무관 — 먼저 그림
  renderToc(document.getElementById('home-toc'), pages, rootRel);

  // 1) 로딩 상태
  showLoading(document.getElementById('sec-etr-awaiting'), { rows: 3 });
  showLoading(document.getElementById('sec-due-soon'), { rows: 3 });
  showLoading(document.getElementById('sec-fasttrack'), { rows: 2 });

  let data;
  try {
    data = await loadJsonMap({
      initiatives:   `${rootRel}data/jira/initiatives.json`,
      allTickets:    `${rootRel}data/jira/all-tickets.json`,
      etrAssigned:   `${rootRel}data/jira/etr-assigned.json`,
      etrFasttrack:  `${rootRel}data/jira/etr-fasttrack.json`,
    });
  } catch (err) {
    console.error('[home]', err);
    showError(document.getElementById('sec-etr-awaiting'), err);
    showError(document.getElementById('sec-due-soon'), err);
    showError(document.getElementById('sec-fasttrack'), err);
    return;
  }

  // 2) 통계 4개
  renderStats(data);

  // 3) kicker / lede 동적 문장
  renderHeader(data);

  // 4) 섹션 1~3
  renderEtrAwaiting(document.getElementById('sec-etr-awaiting'), data.etrAssigned);
  renderDueSoon(document.getElementById('sec-due-soon'), data.initiatives);
  renderFasttrack(document.getElementById('sec-fasttrack'), data.etrFasttrack);
}

/* --- 통계 ----------------------------------------------- */

function renderStats({ initiatives, allTickets, etrAssigned, etrFasttrack }) {
  // Quarter Progress: 이번 분기 Initiative 중 Done 비율
  const quarter = currentQuarter();
  const inQ = (initiatives.items || []).filter(it => it.yearQuarter === quarter);
  const inQDone = inQ.filter(it => it.statusCategory === 'done').length;
  const progPct = inQ.length ? (inQDone / inQ.length) * 100 : 0;
  setStat('quarter-progress', formatPct(progPct), `${inQDone} / ${inQ.length} · ${quarter}`);

  // Due in 7 days — initiatives + all-tickets 중 진행 중 + 마감 다음 7일 이내
  const candidates = [...(initiatives.items || []), ...(allTickets.items || [])];
  const seen = new Set();
  const due7 = candidates.filter(it => {
    if (!it.key || seen.has(it.key)) return false;
    seen.add(it.key);
    if (it.statusCategory === 'done') return false;
    const d = daysUntil(it.dueDate);
    return d !== null && d >= 0 && d <= 7;
  });
  setStat('due-7d', due7.length, `${due7.length}건 7일내`);

  // ETR Awaiting
  const awaiting = (etrAssigned.items || []).filter(it => ETR_AWAITING_STATUSES.has(it.status));
  setStat('etr-awaiting', awaiting.length, `상태 발의/대기`);

  // Fast-Track Active — items 중 진행 중 / 전체
  const ftItems = etrFasttrack.items || [];
  const ftActive = ftItems.filter(it => it.statusCategory !== 'done').length;
  setStat('ft-active', `${ftActive}/${ftItems.length}`, `진행/전체`);
}

function setStat(id, val, foot) {
  const v = document.querySelector(`[data-stat="${id}"]`);
  const f = document.querySelector(`[data-stat-foot="${id}"]`);
  if (v) {
    // Unit suffix (e.g. "%") 유지
    const unit = v.querySelector('.u');
    v.textContent = val;
    if (unit) v.appendChild(unit);
  }
  if (f) f.textContent = foot;
}

function formatPct(v) {
  if (!isFinite(v)) return '—';
  return v.toFixed(0);
}

/* --- 헤더 ----------------------------------------------- */

function renderHeader({ initiatives, allTickets, etrAssigned }) {
  const now = new Date();
  const day = ['일', '월', '화', '수', '목', '금', '토'][now.getDay()];
  document.querySelector('[data-kicker]').textContent =
    `${fmtDate(now)} (${day}) — MSS Search & Discovery`;

  const awaiting = (etrAssigned.items || []).filter(it => ETR_AWAITING_STATUSES.has(it.status)).length;
  const due7 = countDueSoon([...(initiatives.items || []), ...(allTickets.items || [])], 7);

  const lede = document.querySelector('[data-lede]');
  const total = (initiatives.items || []).length + (allTickets.items || []).length;
  if (total === 0) {
    lede.innerHTML = `데이터 동기화를 기다리는 중. 사이드바 푸터에서 last sync 확인.`;
    return;
  }
  lede.innerHTML =
    `확인이 필요한 ETR이 <strong class="num">${awaiting}</strong>건, ` +
    `다음 7일 내 마감이 <strong class="num">${due7}</strong>건 있습니다.`;
}

function countDueSoon(items, n) {
  const seen = new Set();
  let count = 0;
  for (const it of items) {
    if (!it.key || seen.has(it.key)) continue;
    seen.add(it.key);
    if (it.statusCategory === 'done') continue;
    const d = daysUntil(it.dueDate);
    if (d !== null && d >= 0 && d <= n) count++;
  }
  return count;
}

/* --- 섹션 ----------------------------------------------- */

function renderEtrAwaiting(container, etrAssigned) {
  if (!container) return;
  const items = (etrAssigned.items || []).filter(it => ETR_AWAITING_STATUSES.has(it.status));
  if (!items.length) {
    showEmpty(container, { kicker: 'OK', msg: '확인 필요한 ETR이 없습니다.' });
    return;
  }
  const sorted = items
    .slice()
    .sort((a, b) => (a.created || '') < (b.created || '') ? 1 : -1)
    .slice(0, 5);
  container.innerHTML = sorted.map(row).join('');
  container.style.gridTemplateColumns = 'auto 1fr auto auto';
}

function renderDueSoon(container, initiatives) {
  if (!container) return;
  const items = (initiatives.items || [])
    .filter(it => it.statusCategory !== 'done' && it.dueDate)
    .map(it => ({ ...it, _du: daysUntil(it.dueDate) }))
    .filter(it => it._du !== null && it._du <= 21)
    .sort((a, b) => a._du - b._du)
    .slice(0, 5);
  if (!items.length) {
    showEmpty(container, { msg: '마감 임박 과제 없음' });
    return;
  }
  container.innerHTML = items.map(row).join('');
}

function renderFasttrack(container, etrFasttrack) {
  if (!container) return;
  const items = (etrFasttrack.items || [])
    .slice()
    .sort((a, b) => (a.updated || a.created || '') < (b.updated || b.created || '') ? 1 : -1)
    .slice(0, 3);
  if (!items.length) {
    showEmpty(container, { msg: '패스트트랙 항목 없음' });
    return;
  }
  container.innerHTML = items.map(it => {
    const p = it.progress || { done: 0, total: 0 };
    const ratio = p.total ? (p.done / p.total) : 0;
    const pct = Math.round(ratio * 100);
    return `
      <div class="row" data-key="${escapeAttr(it.key)}" style="grid-template-columns: auto 1fr auto auto;">
        ${jiraKeyHtml(it.key)}
        <div class="row-main">
          <div class="row-title">${escapeHtml(it.summary || '')}</div>
          <div class="row-sub">
            <span class="${statusClass(it.statusCategory)}">${escapeHtml(it.status || '')}</span>
            <span class="sep">·</span>
            <span class="who">${escapeHtml((it.reporter && it.reporter.name) || '—')}</span>
          </div>
        </div>
        <div class="prog ${ratio === 1 ? 'done' : ''}" title="${p.done}/${p.total}">
          <span class="prog-bar"><span style="width:${pct}%"></span></span>
          <span class="num">${p.done}/${p.total}</span>
        </div>
        <span class="ago">${it.updated ? fmtAgo(it.updated) : ''}</span>
      </div>
    `;
  }).join('');
}

function row(it) {
  const d = daysUntil(it.dueDate);
  const dueClass = d !== null && d <= 7 ? 'pri pri-p0' : 'date';
  return `
    <div class="row" data-key="${escapeAttr(it.key)}">
      ${jiraKeyHtml(it.key)}
      <div class="row-main">
        <div class="row-title">${escapeHtml(it.summary || '')}</div>
        <div class="row-sub">
          <span class="${statusClass(it.statusCategory, it.status)}">${escapeHtml(it.status || '')}</span>
          <span class="sep">·</span>
          <span class="who">${escapeHtml((it.assignee && it.assignee.name) || '—')}</span>
        </div>
      </div>
      <span class="${dueClass}">${it.dueDate ? fmtDate(it.dueDate) : '—'}</span>
      <span class="ago">${it.updated ? fmtAgo(it.updated) : ''}</span>
    </div>
  `;
}

/* --- TOC 8개 ------------------------------------------- */

function renderToc(container, pages, rootRel) {
  if (!container) return;
  container.innerHTML = pages.map((p, i) => {
    const href = (rootRel || '') + p.path + (p.path === '' ? 'index.html' : '');
    return `
      <a class="toc-row" href="${href}">
        <div>
          <div class="toc-h">${escapeHtml(p.label)}</div>
          <div class="toc-d">${escapeHtml(TOC_DESCRIPTIONS[p.id] || '')}</div>
        </div>
        <div class="toc-num">${p.num} →</div>
      </a>
    `;
  }).join('');
}

/* --- helpers ------------------------------------------- */

function currentQuarter(now = new Date()) {
  const y = now.getFullYear();
  const q = Math.floor(now.getMonth() / 3) + 1;
  return `${y}-Q${q}`;
}

function statusClass(category, name) {
  if (category === 'done') return 'st st-done';
  if (category === 'indeterminate') return 'st st-progress';
  if (category === 'new') return 'st st-prop';
  // name 기반 fallback
  if (name === '반려' || name === 'DROPPED') return 'st st-rejected';
  return 'st st-wait';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
