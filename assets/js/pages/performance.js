/* =========================================================
   pages/performance.js — 성과 페이지
   PRD 4.5: 분기별 출시 + 임팩트 한 화면, 상위 보고용
   ========================================================= */

import { loadJson } from '../fetch-data.js';
import { showError, emptyHtml } from '../states.js';
import { jiraKeyHtml, jiraUrl } from '../jira-link.js';
import { fmtDate, fmtDelta } from '../format.js';
import { escapeHtml, escapeAttr } from '../escape.js';
import { loadAll as loadPlanData, parseSubjectIds } from '../api/roadmap-plan-data.js';
import { loadOneMeta, metaByKey } from '../api/one-ticket-meta.js';
import { auth } from '../api/supabase.js';

const QUARTERS = ['2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2'];

let state = {
  rootRel: '',
  launchesAll: [],        // 자동 (jira completed-launches.json)
  metricsByQuarter: {},   // 수동 (data/metrics/{q}.json)
  currentQuarter: null,
  planByYear: {},         // 연도 → { objectives, subjects, overrides } (Supabase 계위, 실패 시 null)
  contentDefaults: new Map(),  // jira_key → 기본 내용 (one-content.json)
  contentMeta: new Map(),      // jira_key → one_ticket_meta row (content override 포함)
};

/** 티켓의 MBR 내용 — 편집 override(one_ticket_meta.content) 우선, 없으면 one-content.json 기본값. */
function mbrContent(key) {
  const m = state.contentMeta.get(key);
  const override = m && m.content != null ? String(m.content).trim() : '';
  return override || state.contentDefaults.get(key) || '';
}

/** 'YYYY-QN' → 연도 숫자 */
function yearOfQuarter(q) {
  const m = /^(\d{4})-Q[1-4]$/.exec(q || '');
  return m ? Number(m[1]) : new Date().getFullYear();
}

/** 해당 연도 계위(Objective/Subject/티켓매핑) 로드 — 캐시. 미로그인/RLS 실패 시 null 로 degrade. */
async function ensurePlanData(year) {
  if (year in state.planByYear) return state.planByYear[year];
  try {
    const d = await loadPlanData(year);
    state.planByYear[year] = d;
  } catch (err) {
    console.warn(`[performance] 계위(Supabase) ${year} 로드 실패 — 평면 목록으로 표시:`, err);
    state.planByYear[year] = null;
  }
  return state.planByYear[year];
}

export async function renderPerformance({ rootRel = '' } = {}) {
  state.rootRel = rootRel;
  state.currentQuarter = QUARTERS[QUARTERS.length - 1];

  renderTabs();
  bindExport();

  // 다른 페이지와 동일하게 Supabase 세션 복원 — 계위 쿼리에 인증 토큰이 붙도록.
  // (로그인 UI 별도 노출 없음. 실패해도 평면 목록으로 degrade)
  try { await auth.init(); } catch (e) { console.warn('[performance] auth.init 실패', e); }

  // 자동 launches (fallback용)
  try {
    const data = await loadJson(`${rootRel}data/jira/completed-launches.json`);
    state.launchesAll = data.items || [];
  } catch (err) {
    console.warn('[performance] completed-launches load failed', err);
    state.launchesAll = [];
  }

  // MBR 내용 — 기본값(one-content.json) + 편집 override(one_ticket_meta).
  try {
    const cj = await loadJson(`${rootRel}data/jira/one-content.json`);
    for (const [k, v] of Object.entries(cj || {})) state.contentDefaults.set(String(k), String(v ?? ''));
  } catch (err) {
    console.warn('[performance] one-content.json load failed', err);
  }
  try {
    state.contentMeta = metaByKey(await loadOneMeta());
  } catch (err) {
    console.warn('[performance] one_ticket_meta 로드 실패 — 기본 내용만 표시:', err);
    state.contentMeta = new Map();
  }

  await switchQuarter(state.currentQuarter);
}

/* ----- 분기 탭 (role=tab + arrow nav, 리뷰 Important #5) ---- */

function renderTabs() {
  const host = document.getElementById('quarter-tabs');
  if (!host) return;
  host.innerHTML = '';
  QUARTERS.forEach(q => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = q;
    btn.dataset.quarter = q;
    btn.setAttribute('role', 'tab');
    const isActive = q === state.currentQuarter;
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    btn.tabIndex = isActive ? 0 : -1;
    btn.className = isActive ? 'on' : '';
    btn.addEventListener('click', () => switchQuarter(q));
    host.appendChild(btn);
  });
  host.addEventListener('keydown', onTabKeyDown);
}

function onTabKeyDown(e) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
  const tabs = [...e.currentTarget.querySelectorAll('button[role="tab"]')];
  const i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  let next = i;
  if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
  if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
  if (e.key === 'Home') next = 0;
  if (e.key === 'End') next = tabs.length - 1;
  tabs[next].focus();
  tabs[next].click();
}

async function switchQuarter(q) {
  state.currentQuarter = q;
  // tab on/off + aria-selected + roving tabindex
  document.querySelectorAll('#quarter-tabs button[role="tab"]').forEach(b => {
    const on = b.dataset.quarter === q;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
  });

  // metrics: 캐시
  if (!(q in state.metricsByQuarter)) {
    try {
      state.metricsByQuarter[q] = await loadJson(`${state.rootRel}data/metrics/${q}.json`);
    } catch (err) {
      console.warn(`[performance] metrics/${q}.json load failed`, err);
      state.metricsByQuarter[q] = null;
    }
  }
  // 계위(목표/주제) — 분기 연도 기준 로드(캐시). 하이라이트 분류에 사용.
  await ensurePlanData(yearOfQuarter(q));

  renderHeader(q);
  renderImpactStats(q);
  renderHighlights(q);
  renderTimeline(q);
}

/* ----- 헤더 ----------------------------------------------- */

function renderHeader(q) {
  const lede = document.querySelector('[data-lede]');
  if (!lede) return;
  const launches = currentLaunches(q);
  const metrics = state.metricsByQuarter[q];
  const kpiCount = metrics?.kpis?.length || 0;
  const launchCount = launches.length;
  const qSafe = escapeHtml(q);

  if (launchCount === 0 && kpiCount === 0) {
    lede.innerHTML =
      `<strong>${qSafe}</strong> 데이터가 아직 없습니다. ` +
      `KPI는 <code class="num accent">data/metrics/${qSafe}.json</code>에 입력, ` +
      `출시 과제는 Jira sync 후 자동 집계됩니다.`;
    return;
  }
  lede.innerHTML =
    `<strong>${qSafe}</strong> · ` +
    `출시 <strong class="num">${launchCount}</strong>건 · ` +
    `KPI <strong class="num">${kpiCount}</strong>개 등록.`;
}

/* ----- 분기 임팩트 카드 ------------------------------------ */

function renderImpactStats(q) {
  const host = document.getElementById('impact-stats');
  if (!host) return;

  const launches = currentLaunches(q);
  // 리뷰 Critical #2 — 첫 분기는 prev 없음 → delta 계산 자체를 생략
  const prev = prevQuarter(q);
  const prevLaunches = prev ? currentLaunches(prev) : null;
  const launchDelta = prev ? launches.length - prevLaunches.length : null;
  const metrics = state.metricsByQuarter[q];
  const kpis = (metrics?.kpis || []).slice(0, 3);

  // 첫 카드는 항상 "출시 과제 수"
  const cards = [{
    name: '출시 과제 수',
    value: launches.length,
    unit: '건',
    deltaPrev: launchDelta,
    spark: null,
  }, ...kpis];

  // 4개 미만이면 빈 슬롯 채우기
  while (cards.length < 4) cards.push(null);

  host.innerHTML = cards.slice(0, 4).map((k, i) => {
    if (!k) {
      return `
        <div class="imp-stat" style="opacity:0.4">
          <div class="imp-label">KPI ${i + 1}</div>
          <div class="imp-val num" style="color:var(--faint)">—</div>
          <div class="imp-delta">metrics 입력 필요</div>
        </div>`;
    }
    const hasDelta = k.deltaPrev != null && !isNaN(k.deltaPrev);
    const tone = hasDelta && k.deltaPrev > 0 ? 'up' : hasDelta && k.deltaPrev < 0 ? 'down' : '';
    let deltaStr;
    if (!hasDelta) {
      deltaStr = '— vs 전 분기';
    } else if (k.deltaPrev === 0) {
      deltaStr = '— vs 전 분기';
    } else {
      const arrow = k.deltaPrev > 0 ? '▲' : '▼';
      // %p 는 %에 대한 표준 표기. 그 외 단위는 그대로 (없으면 단위 생략).
      const deltaUnit = k.unit === '%' ? '%p' : (k.unit || '');
      deltaStr = `${arrow} ${Math.abs(k.deltaPrev)}${deltaUnit} vs 전 분기`;
    }
    const sparkHtml = (k.spark && k.spark.length > 1)
      ? renderSparkline(k.spark, { tone })
      : '';
    return `
      <div class="imp-stat">
        <div class="imp-label">${escapeHtml(k.name)}</div>
        <div class="imp-val num">${escapeHtml(formatVal(k.value))}<span class="u">${escapeHtml(k.unit || '')}</span></div>
        <div class="imp-delta ${tone}">${escapeHtml(deltaStr)}</div>
        ${sparkHtml}
      </div>
    `;
  }).join('');
}

function formatVal(v) {
  if (v == null || isNaN(v)) return '—';
  return String(v);
}

function renderSparkline(values, { tone }) {
  // 리뷰 Important #6 — 1개 이하 값은 division by zero 방지
  if (!values || values.length < 2) return '';
  const w = 70, h = 26;
  const min = Math.min(...values), max = Math.max(...values);
  const range = (max - min) || 1;
  const stroke = tone === 'up' ? 'var(--success)' : tone === 'down' ? 'var(--alert)' : 'var(--dim)';
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (w - 2) + 1;
    const y = h - 2 - ((v - min) / range) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `
    <svg class="imp-spark spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none">
      <polyline points="${pts}" stroke="${stroke}" />
    </svg>
  `;
}

/* ----- 분기 하이라이트 ------------------------------------- */

function renderHighlights(q) {
  const host = document.getElementById('sec-highlights');
  const countEl = document.querySelector('[data-count="cnt-highlights"]');
  if (!host) return;

  const launches = currentLaunches(q);
  if (countEl) countEl.textContent = launches.length;

  if (!launches.length) {
    host.innerHTML = emptyHtml({
      kicker: 'NO LAUNCHES',
      msg: `${q} 분기 출시 과제가 아직 없습니다.`,
      hint: 'completed-launches.json (자동) 또는 metrics/launches[] (큐레이션)',
    });
    return;
  }

  // 계위(목표/주제)가 있으면 목표 → 주제로 분류, 없으면(미로그인 등) 평면 목록.
  const plan = state.planByYear[yearOfQuarter(q)];
  const grouped = plan && plan.objectives && plan.objectives.length
    ? groupLaunchesByObjective(launches, plan)
    : null;

  host.innerHTML = grouped
    ? grouped.map(groupHtml).join('')
    : launches.map(entryHtml).join('');
}

/** 출시 1건 → entry HTML */
function entryHtml(l) {
  const key = l.ticketKey || l.key;
  const date = l.launchedAt || l.resolutionDate;
  const title = l.title || l.summary || '';
  const desc = l.description || '';
  const impact = l.impactSummary || '';
  const url = jiraUrl(key);
  const mbr = mbrContent(key);
  return `
    <div class="entry">
      <div class="entry-date">
        ${date ? fmtDate(date) : '—'}
        ${url
          ? `<a class="key" href="${url}" target="_blank" rel="noopener noreferrer" data-jira-key="${escapeAttr(key)}">${escapeHtml(key)}</a>`
          : `<span class="key muted">${escapeHtml(key || '')}</span>`
        }
      </div>
      <div>
        <h3>${escapeHtml(title)}</h3>
        ${desc ? `<p>${escapeHtml(desc)}</p>` : ''}
        ${impact ? `<div class="impact-line">${escapeHtml(impact)}</div>` : ''}
      </div>
      <div class="entry-mbr${mbr ? '' : ' empty'}">${mbr ? escapeHtml(mbr) : '—'}</div>
    </div>
  `;
}

/** 목표 그룹(헤더 + 주제별 하위그룹) HTML */
function groupHtml(g) {
  const color = g.color || 'var(--text)';
  const head = `
    <div class="hl-obj-head" style="margin:18px 0 2px;padding-bottom:6px;border-bottom:1px solid var(--rule);">
      <span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${color};margin-right:8px;vertical-align:middle;"></span>
      <strong style="font-size:14px;color:${color};">${escapeHtml(g.name)}</strong>
      <span class="muted num" style="font-size:11px;margin-left:8px;">${g.count}건</span>
    </div>`;
  const subs = g.subGroups.map(sg => `
    <div style="margin:8px 0 0;">
      ${sg.name ? `<div class="muted dim-mono" style="font-size:11px;margin:6px 0 2px;">↳ ${escapeHtml(sg.name)} · ${sg.items.length}</div>` : ''}
      ${sg.items.map(entryHtml).join('')}
    </div>`).join('');
  return head + subs;
}

/** 출시 목록을 목표 → 주제로 분류. 매핑은 ticket_subjects(overrides) 기준.
 *  멀티 주제 티켓은 각 주제 그룹에 모두 노출(로드맵과 동일). 목표 헤더 count 는 distinct.
 *  매핑 없는 출시는 마지막 '미분류' 그룹. */
function groupLaunchesByObjective(launches, plan) {
  const subjById = new Map(plan.subjects.map(s => [s.id, s]));
  const subjIdsByKey = new Map();
  for (const o of (plan.overrides || [])) {
    if (o.jira_key) subjIdsByKey.set(String(o.jira_key), parseSubjectIds(o.subject_id));
  }
  const keyOf = (l) => String(l.ticketKey || l.key || '');
  const bySubject = new Map();   // subjectId → launches
  const none = [];
  for (const l of launches) {
    const sids = (subjIdsByKey.get(keyOf(l)) || []).filter(sid => subjById.has(sid));
    if (!sids.length) { none.push(l); continue; }
    for (const sid of sids) {
      if (!bySubject.has(sid)) bySubject.set(sid, []);
      bySubject.get(sid).push(l);
    }
  }
  const out = [];
  for (const o of plan.objectives) {
    const subs = plan.subjects.filter(s => s.objective_id === o.id && bySubject.has(s.id));
    if (!subs.length) continue;
    const subGroups = subs.map(s => ({ name: s.name || '(주제)', items: bySubject.get(s.id) }));
    const seen = new Set();
    for (const sg of subGroups) for (const l of sg.items) seen.add(keyOf(l));
    out.push({ name: o.name || '(목표)', color: o.color, count: seen.size, subGroups });
  }
  if (none.length) {
    out.push({ name: '— 미분류 (주제 미지정)', color: 'var(--dim)', count: none.length, subGroups: [{ name: '', items: none }] });
  }
  return out;
}

/* ----- 전체 출시 타임라인 ---------------------------------- */

function renderTimeline(q) {
  const host = document.getElementById('sec-timeline');
  if (!host) return;
  const launches = currentLaunches(q);
  if (!launches.length) {
    host.innerHTML = emptyHtml({ kicker: 'NO TIMELINE', msg: '표시할 출시가 없습니다.' });
    return;
  }
  const months = monthsOfQuarter(q);
  const start = new Date(months[0].start);
  const end = new Date(months[months.length - 1].end);
  const totalMs = end - start;

  // 라벨
  const monthLabels = months.map((m, i) => {
    const leftPct = ((m.start - start) / totalMs) * 100;
    return `<span style="position:absolute;left:${leftPct}%;top:-22px;transform:translateX(-50%);font-family:var(--font-mono);font-size:11px;color:var(--faint)">${m.month}월</span>` +
           `<span style="position:absolute;left:${leftPct}%;top:-4px;width:1px;height:9px;background:var(--rule-strong)"></span>`;
  }).join('');

  // 출시 점 + 60도 기울인 라벨 (겹침 방지)
  const dots = launches.map(l => {
    const date = l.launchedAt || l.resolutionDate;
    if (!date) return '';
    const t = new Date(date);
    if (isNaN(t)) return '';
    const pct = Math.max(0, Math.min(100, ((t - start) / totalMs) * 100));
    const title = (l.title || l.summary || '').slice(0, 32);
    const key = l.ticketKey || l.key || '';
    const tip = `${key} · ${fmtDate(date)} · ${l.title || l.summary || ''}`;
    return `
      <div data-tip="${escapeAttr(tip)}" style="position:absolute;left:${pct}%;top:-5px;transform:translateX(-50%);width:10px;height:10px;background:var(--accent);border:2px solid var(--bg);cursor:pointer;z-index:2" data-jira-key="${escapeAttr(key)}"></div>
      <div class="perf-tl-label" style="left:${pct}%">${escapeHtml(title)}</div>
    `;
  }).join('');

  host.innerHTML = `
    <div class="perf-timeline">
      <div class="perf-timeline-track">
        ${monthLabels}
        ${dots}
      </div>
    </div>
  `;
}

/* ----- Export --------------------------------------------- */

function bindExport() {
  const btn = document.getElementById('btn-print');
  if (!btn) return;
  btn.addEventListener('click', () => window.print());
}

/* ----- helpers -------------------------------------------- */

function currentLaunches(q) {
  // metrics.launches 우선 (큐레이션), 없으면 자동 (yearQuarter 매칭)
  const metrics = state.metricsByQuarter[q];
  if (metrics?.launches?.length) {
    return [...metrics.launches].sort((a, b) =>
      (a.launchedAt || '').localeCompare(b.launchedAt || '')
    );
  }
  const auto = state.launchesAll
    .filter(it => it.yearQuarter === q)
    .map(it => ({
      ticketKey: it.key,
      title: it.summary,
      launchedAt: it.resolutionDate || it.updated,
      description: '',
      impactSummary: '',
    }))
    .sort((a, b) => (a.launchedAt || '').localeCompare(b.launchedAt || ''));
  return auto;
}

function prevQuarter(q) {
  const i = QUARTERS.indexOf(q);
  return i > 0 ? QUARTERS[i - 1] : null;
}

function monthsOfQuarter(q) {
  const m = /^(\d{4})-Q([1-4])$/.exec(q);
  if (!m) return [];
  const year = Number(m[1]);
  const qn = Number(m[2]);
  const startMonth = (qn - 1) * 3 + 1;
  const months = [];
  for (let i = 0; i < 3; i++) {
    const mm = startMonth + i;
    const start = new Date(year, mm - 1, 1);
    const end = new Date(year, mm, 0); // 말일
    months.push({ year, month: mm, start, end });
  }
  return months;
}

