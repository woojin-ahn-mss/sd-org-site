/* =========================================================
   pages/fasttrack.js — 패스트트랙 (PRD 4.7 + 리뉴얼 2026-05-26)
   ETR + 'one' 레이블 = 인입 / status '검토완료-우선착수' = 트리아지
   - 1행 = 1 ETR, 행 클릭으로 연결 티켓 펼침
   - 상단 6 카드: 총인입 / 트리아지 / 일반과제 / 지난주 인입 / 금주 인입(+트리아지N) / 진행중(FT·MSSCXTF one·개발중)
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
import { openDrilldown } from '../drilldown.js';
import { toast } from '../toast.js';
import { AuthRequiredError } from '../api/supabase.js';
import { addManualTicket, removeManualTicket, loadManualTickets, extractJiraKey } from '../api/ft-manual-tickets.js';

const FILTERS_KEY = 'fasttrack.filters';
const PERIOD_DAYS = { '1m': 30, '3m': 90, 'all': Infinity };
const PAGE_SIZE = 20;

// 상태 분류 (사용자 정의)
const STATUS_TRIAGE = '검토완료-우선착수';   // 패스트트랙 트리아지
const STATUS_NORMAL = '검토완료-백로그';     // 일반 과제 (패스트트랙 진행 X)
const STATUS_DEV = '개발중';                 // 실제 진행중 (FT·MSSCXTF Initiative)
const STATUS_DROPPED = new Set(['반려', '검토완료-미진행', '철회']);

// 패스트트랙 실제 진행 Initiative 가 사는 프로젝트 (TM 은 자동 제외 — 수동 등록분만 it.manual 로 포함)
const FT_PROJECTS = new Set(['FT', 'MSSCXTF', 'PEL', 'TF']);

/* ── 진행 칸반 (2026-06-08) ──────────────────────────────────
   인입 컬럼 = ETR 인입 단계 티켓. 그 외 컬럼 = ETR 에 연결/복사된 Initiative
   (MSSCXTF·TM·PEL·FT·TF) 의 상태로 배치. 매핑/제외 정책은 사용자 확정(2026-06-08):
   - 미착수(SUGGESTED·Backlog) → '대기/백로그' 컬럼
   - 종료(철회/반려/취소·Dropped·반려) + 보류(HOLD) → 보드 제외
   - 'X완료' 중간상태 → 다음 단계로 (기획완료→디자인중, 디자인완료→개발중) */
const KANBAN_PROJECTS = new Set(['MSSCXTF', 'TM', 'PEL', 'FT', 'TF']);
const INTAKE_STATUSES = new Set(['발의', '매니저 승인 대기', 'PMO 검토 중', 'Tech 검토 대기 중', 'Tech 검토 중']);
// 보드 제외 — 종료(취소/반려/철회/Dropped) + 보류(HOLD). 사용자 정책 2026-06-08.
const KANBAN_TERMINAL = new Set([
  '철회/반려/취소', 'Dropped', '반려', '취소', '철회', '검토완료-미진행',
  'HOLD', '보류', 'On Hold',
]);
const STATUS_TO_COL = {
  'SUGGESTED': 'backlog', 'Backlog': 'backlog',
  '준비중': 'plan', '기획중': 'plan',
  '기획완료': 'design', '디자인중': 'design', 'Design Finalization': 'design',
  '디자인완료': 'dev', '개발중': 'dev', 'In Progress': 'dev', 'QA중': 'dev', 'Waiting For Review': 'dev',
  '개발완료': 'devdone',
  '배포완료': 'deployed',
  '론치완료': 'launched', '완료': 'launched',
};
const KANBAN_COLS = [
  { id: 'intake',   label: '요구사항 인입' },
  { id: 'backlog',  label: '대기/백로그' },
  { id: 'plan',     label: '기획중' },
  { id: 'design',   label: '디자인중' },
  { id: 'dev',      label: '개발중' },
  { id: 'devdone',  label: '개발완료' },
  { id: 'deployed', label: '배포완료' },
  { id: 'launched', label: '론치완료' },
];

function projectOfKey(key) {
  return key && key.includes('-') ? key.split('-')[0] : '';
}

// 칸반 'fasttrack' 라벨 필터 — ON 시 라벨에 'fasttrack' 있는 카드만(전체 컬럼 균일)
const KANBAN_LABEL = 'fasttrack';
const KANBAN_LABEL_KEY = 'fasttrack.kanbanLabelOnly';
function cardHasLabel(card, label) {
  return Array.isArray(card.labels) && card.labels.includes(label);
}

// statusCategory='done' 중 '실제 완료' 가 아닌 상태 (취소/반려/Dropped) — 주별 차트 완료 카운트에서 제외
const EXCLUDED_FROM_DONE = new Set(['Dropped', '철회/반려/취소', '취소', '반려', '철회']);
function isRealDone(it) {
  return it.statusCategory === 'done' && !EXCLUDED_FROM_DONE.has(it.status);
}

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
  etrPage: 1,
  ftPage: 1,
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
  renderWeeklyChart();
  renderKanban();
  renderFilters();
  renderTable();
  renderFtTable();
  bindManualBtn();
}

/** FT 섹션 헤더의 '티켓 추가' 버튼 → 수동 등록 모달.
 *  전역 auth-gate 가 페이지를 로그인으로 막으므로 별도 로그인 흐름 불필요. */
function bindManualBtn() {
  const btn = document.getElementById('btn-ft-manual');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', openManualModal);
  }
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

  // 금주 진행중 — FT·MSSCXTF·PEL·TF + 수동 등록분의 'one' 레이블 + 상태 '개발중' 현재 스냅샷
  const inProgressOne = state.ftItems.filter(it =>
    (FT_PROJECTS.has(it.project) || it.manual) &&
    it.status === STATUS_DEV &&
    (it.labels || []).includes('one')
  ).length;
  setStatRaw('inprogress', inProgressOne, '개발중 · one (FT·MSSCXTF·PEL·TF + 수동)', state.ftItems.length === 0);
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
  setStatRaw(id, val, foot, state.items.length === 0);
}

/** setStat 변형 — '—' 표시 조건(blank)을 호출부에서 직접 지정.
 *  FT 기반 카드는 ETR(state.items) 가 아니라 FT 데이터 적재 여부로 판단해야 하므로 분리. */
function setStatRaw(id, val, foot, blank) {
  const v = document.querySelector(`[data-stat="${id}"]`);
  const f = document.querySelector(`[data-stat-foot="${id}"]`);
  if (v) {
    const unit = v.querySelector('.u');
    v.textContent = blank ? '—' : val;
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
  const etrTotal = document.getElementById('dwell-etr-total');
  const ftTotal = document.getElementById('dwell-ft-total');
  if (etrTable) renderDwellGroup(etrTable, dwellStats(state.items, ETR_STATUS_ORDER));
  if (ftTable)  renderDwellGroup(ftTable,  dwellStats(state.ftItems));
  if (etrTotal) etrTotal.textContent = state.items.length ? `${state.items.length}건` : '—';
  if (ftTotal)  ftTotal.textContent  = state.ftItems.length ? `${state.ftItems.length}건` : '—';
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

/**
 * 최근 N주의 ETR 인입(created) 과 FT 완료(resolutionDate) 카운트.
 * KST 월~일 주차. 가장 오래된 주부터 최근 주 순서.
 * @returns {Array<{label, start, end, intake, done}>}
 */
export function weeklyTrend(etrItems, ftItems, now = new Date(), weeks = 12) {
  const { thisStart } = kstWeekRange(now);
  const arr = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = thisStart - i * 7 * 86400 * 1000;
    const end = start + 7 * 86400 * 1000;
    arr.push({ start, end, intake: 0, done: 0, label: weekLabel(start) });
  }
  for (const it of etrItems) {
    if (!it.created) continue;
    const t = new Date(it.created).getTime();
    if (isNaN(t)) continue;
    const w = arr.find(b => t >= b.start && t < b.end);
    if (w) w.intake++;
  }
  for (const it of ftItems) {
    // 실제 완료 = done 카테고리 + Dropped/취소/반려 제외
    if (!isRealDone(it)) continue;
    const rd = it.resolutionDate || it.updated;
    if (!rd) continue;
    const t = new Date(rd).getTime();
    if (isNaN(t)) continue;
    const w = arr.find(b => t >= b.start && t < b.end);
    if (w) w.done++;
  }
  return arr;
}

/**
 * 단일 타임라인 — 과거 N주(인입 created · 완료 resolutionDate) + 현재~미래 M주(완료 예정: 미완료 dueDate).
 * 기한 초과(이번 주 시작 이전 마감)는 제외. 현재 주는 과거 구간에 포함되며 완료 예정도 함께 집계.
 * @returns {Array<{label, start, end, intake, done, forecast, isFuture}>}
 */
export function weeklyCombined(etrItems, ftItems, now = new Date(), past = 12, future = 12) {
  const { thisStart } = kstWeekRange(now);
  const weeks = [];
  for (let i = past - 1; i >= 0; i--) {
    const start = thisStart - i * 7 * 86400 * 1000;
    weeks.push({ start, end: start + 7 * 86400 * 1000, label: weekLabel(start), intake: 0, done: 0, forecast: 0, isFuture: false });
  }
  for (let i = 1; i <= future; i++) {
    const start = thisStart + i * 7 * 86400 * 1000;
    weeks.push({ start, end: start + 7 * 86400 * 1000, label: weekLabel(start), intake: 0, done: 0, forecast: 0, isFuture: true });
  }
  const findWeek = (t) => weeks.find(w => t >= w.start && t < w.end);

  for (const it of (etrItems || [])) {
    if (!it.created) continue;
    const t = new Date(it.created).getTime();
    if (isNaN(t)) continue;
    const w = findWeek(t); if (w) w.intake++;
  }
  for (const it of (ftItems || [])) {
    if (isRealDone(it)) {
      // 완료 — resolutionDate(없으면 updated) 주차
      const rd = it.resolutionDate || it.updated;
      const t = rd ? new Date(rd).getTime() : NaN;
      if (!isNaN(t)) { const w = findWeek(t); if (w) w.done++; }
      continue;
    }
    // 완료 예정 — 미완료(open) 티켓의 dueDate 주차. 종료(취소/반려/Dropped) 제외, 기한 초과(과거) 제외.
    if (it.statusCategory === 'done' || !it.dueDate) continue;
    const t = new Date(it.dueDate).getTime();
    if (isNaN(t) || t < thisStart) continue;
    const w = findWeek(t); if (w) w.forecast++;
  }
  return weeks;
}

function weekLabel(startMs) {
  const d = new Date(startMs);
  // KST 기준 라벨 (월요일)
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const m = kst.getUTCMonth() + 1;
  const day = kst.getUTCDate();
  return `${m}/${day}`;
}

function renderWeeklyChart() {
  const host = document.getElementById('weekly-chart');
  if (!host) return;
  const data = weeklyCombined(state.items, state.ftItems, new Date(), 12, 4);
  const maxVal = Math.max(1, ...data.map(d => Math.max(d.intake, d.done, d.forecast)));

  // SVG 크기 — W 를 컨테이너 실제 폭에 맞춰 viewBox 비율을 유지(글자 가로 찌그러짐 방지).
  // CSS: .wc-svg { width:100%; height:auto } → viewBox 종횡비대로 균일 스케일.
  const W = Math.max(360, Math.round(host.clientWidth) || 1000), H = 220;
  const padL = 32, padR = 12, padT = 12, padB = 36;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const groupW = innerW / data.length;
  const barW = Math.max(4, Math.min(groupW * 0.28, 15));
  const gap = 2;

  const colorIntake = 'var(--accent)';
  const colorDone = 'var(--success, #6cc486)';
  const colorFore = 'var(--info, #7aa7d9)';
  const META = {
    intake: { label: '인입', color: colorIntake, op: 1 },
    done: { label: '완료', color: colorDone, op: 0.75 },
    forecast: { label: '완료 예정', color: colorFore, op: 0.85 },
  };

  // 과거/미래 경계(이번 주 시작) 구분선 — 첫 미래 주 앞.
  let boundaryX = null;
  const firstFuture = data.findIndex(d => d.isFuture);
  if (firstFuture > 0) boundaryX = padL + firstFuture * groupW;

  let bars = '';
  let xlabels = '';
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    const cx = padL + i * groupW + groupW / 2;
    // 해당 주에 값이 있는 시리즈만, 중앙 정렬로 배치.
    const series = ['intake', 'done', 'forecast'].filter(k => d[k] > 0);
    const n = series.length;
    const totalW = n * barW + (n - 1) * gap;
    let bx = cx - totalW / 2;
    for (const k of series) {
      const m = META[k];
      const h = (d[k] / maxVal) * innerH;
      bars += `
      <rect x="${bx.toFixed(1)}" y="${(padT + innerH - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}"
            fill="${m.color}" ${m.op < 1 ? `opacity="${m.op}"` : ''} class="wc-bar" data-kind="${k}" data-week-idx="${i}"
            data-tip="${m.label} ${d[k]}건 · ${d.label} 주차 (클릭: 티켓 보기)" tabindex="0" role="button" aria-label="${d.label} 주차 ${m.label} ${d[k]}건" />
      <text x="${(bx + barW / 2).toFixed(1)}" y="${(padT + innerH - h - 3).toFixed(1)}" class="wc-val">${d[k]}</text>`;
      bx += barW + gap;
    }
    xlabels += `<text x="${cx.toFixed(1)}" y="${H - padB + 14}" class="wc-xlabel">${d.label}</text>`;
  }

  // Y축 눈금 (0, mid, max)
  const ticks = [0, Math.ceil(maxVal / 2), maxVal];
  let yticks = '';
  for (const t of ticks) {
    const y = padT + innerH - (t / maxVal) * innerH;
    yticks += `
      <line x1="${padL}" x2="${W - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="wc-grid" />
      <text x="${padL - 4}" y="${(y + 3).toFixed(1)}" class="wc-ylabel">${t}</text>
    `;
  }
  const boundary = boundaryX == null ? '' : `
      <line x1="${boundaryX.toFixed(1)}" x2="${boundaryX.toFixed(1)}" y1="${padT}" y2="${padT + innerH}" class="wc-divider" />
      <text x="${boundaryX.toFixed(1)}" y="${(padT - 2).toFixed(1)}" class="wc-divider-label">이번 주 →</text>`;

  host.innerHTML = `
    <div class="wc-legend">
      <span class="wc-key"><span class="wc-sw" style="background:${colorIntake}"></span>인입 (ETR created)</span>
      <span class="wc-key"><span class="wc-sw" style="background:${colorDone};opacity:0.75"></span>완료 (MSSCXTF·FT·PEL·TF + 수동 resolutionDate)</span>
      <span class="wc-key"><span class="wc-sw" style="background:${colorFore};opacity:0.85"></span>완료 예정 (미완료 dueDate)</span>
      <span class="wc-key muted dim-mono" style="margin-left:auto">막대 클릭 → 해당 주 티켓 보기</span>
    </div>
    <svg class="wc-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="주별 인입·완료·완료예정 추이">
      ${yticks}
      ${boundary}
      ${bars}
      ${xlabels}
    </svg>
  `;

  // 막대 클릭 / Enter / Space → 해당 주의 티켓 모달
  host.querySelectorAll('.wc-bar').forEach(rect => {
    const open = () => openWeekDrilldown(data, +rect.dataset.weekIdx, rect.dataset.kind);
    rect.addEventListener('click', open);
    rect.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });
}

function openWeekDrilldown(data, weekIdx, kind) {
  const bucket = data[weekIdx];
  if (!bucket) return;
  const inWeek = (v) => {
    if (!v) return false;
    const t = new Date(v).getTime();
    return !isNaN(t) && t >= bucket.start && t < bucket.end;
  };
  let tickets, kicker;
  if (kind === 'intake') {
    kicker = 'ETR 인입';
    tickets = state.items.filter(it => inWeek(it.created));
  } else if (kind === 'done') {
    kicker = 'FT 완료';
    tickets = state.ftItems.filter(it => isRealDone(it) && inWeek(it.resolutionDate || it.updated));
  } else { // forecast — 미완료(open) 티켓의 마감 주차
    kicker = '완료 예정';
    tickets = state.ftItems.filter(it => it.statusCategory !== 'done' && inWeek(it.dueDate));
  }
  openDrilldown(tickets, {
    kicker,
    title: `${bucket.label} 주차 · ${kicker} ${tickets.length}건`,
  });
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

  const row = (inner) => (inner ? `<div class="filter-row">${inner}</div>` : '');
  host.innerHTML = `
    ${row(chipGroup('status', '상태', statuses.map(s => ({ v: s, label: s })), state.filters.status))}
    ${row(chipGroup('reporter', '요청자', reporters.map(r => ({ v: r, label: r })), state.filters.reporter))}
    ${row(chipGroup('period', '기간', periods, state.filters.period))}
    ${hasAny ? '<div class="filter-row"><button type="button" class="tlink" data-filter-reset>필터 초기화</button></div>' : ''}
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
      state.etrPage = 1;  // 필터 변경 시 첫 페이지로
      renderFilters();
      renderTable();
    });
  });
  const reset = host.querySelector('[data-filter-reset]');
  if (reset) reset.addEventListener('click', () => {
    state.filters = { status: null, reporter: null, period: 'all' };
    scoped(FILTERS_KEY).set(state.filters);
    state.etrPage = 1;
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
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if (state.etrPage > totalPages) state.etrPage = totalPages;
  if (state.etrPage < 1) state.etrPage = 1;
  const start = (state.etrPage - 1) * PAGE_SIZE;
  const slice = rows.slice(start, start + PAGE_SIZE);

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
      <tbody>${slice.map(rowHtml).join('')}</tbody>
    </table>
    ${pagerHtml('etr', rows.length, totalPages, state.etrPage, start, slice.length)}
  `;
  bindRowToggle(host);
  bindPager(host, 'etr');
}

/* ----- FT 티켓 섹션 ----- */

function renderFtTable() {
  const host = document.getElementById('ft-table');
  if (!host) return;
  const rows = state.ftItems;
  if (!rows.length) {
    host.innerHTML = emptyHtml({
      kicker: 'NO FT TICKETS',
      msg: '동기화 대기 중 — FT 프로젝트 sync 후 표시됩니다.',
    });
    return;
  }
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if (state.ftPage > totalPages) state.ftPage = totalPages;
  if (state.ftPage < 1) state.ftPage = 1;
  const start = (state.ftPage - 1) * PAGE_SIZE;
  const slice = rows.slice(start, start + PAGE_SIZE);

  host.innerHTML = `
    <table class="tbl">
      <thead>
        <tr>
          <th style="width:90px">키</th>
          <th>요약</th>
          <th style="width:140px">담당자</th>
          <th style="width:160px">상태</th>
          <th style="width:60px">우선</th>
          <th style="width:80px">생성</th>
          <th style="width:80px">기한</th>
        </tr>
      </thead>
      <tbody>${slice.map(ftRowHtml).join('')}</tbody>
    </table>
    ${pagerHtml('ft', rows.length, totalPages, state.ftPage, start, slice.length)}
  `;
  bindPager(host, 'ft');
}

function ftRowHtml(it) {
  const g = STATUS_GROUPS.find(x => x.id === statusGroup(it));
  const isDone = it.statusCategory === 'done' || statusGroup(it) === 'done';
  const dueClass = (() => {
    if (isDone) return 'date num';
    const d = daysUntil(it.dueDate);
    return d !== null && d < 0 ? 'date num alert-color' : 'date num';
  })();
  const priCls = `pri-${(it.priority || '').toLowerCase() || 'p3'}`;
  return `
    <tr>
      <td>${jiraKeyHtml(it.key)}</td>
      <td class="ft-summary">${escapeHtml(it.summary || '')}</td>
      <td><span class="who"><span class="who-dot"></span>${escapeHtml((it.assignee && it.assignee.name) || '—')}</span></td>
      <td><span class="st ${g ? g.stClass : 'st-wait'}">${escapeHtml(it.status || '—')}</span></td>
      <td><span class="pri ${priCls}">${escapeHtml(it.priority || '—')}</span></td>
      <td class="date num">${it.created ? fmtDate(it.created) : '—'}</td>
      <td class="${dueClass}">${it.dueDate ? fmtDate(it.dueDate) : '—'}</td>
    </tr>
  `;
}

/* ----- 페이저 (etr/ft 공용) ----- */

function pagerHtml(kind, total, totalPages, cur, start, sliceLen) {
  if (totalPages <= 1) {
    return `<div class="pager"><span class="pager-info"><span class="num">${total}</span>건</span></div>`;
  }
  return `
    <nav class="pager" role="navigation" aria-label="페이지네이션">
      <button type="button" data-pg-kind="${kind}" data-pg="prev" ${cur === 1 ? 'disabled' : ''}>‹ 이전</button>
      <span class="num">${start + 1}–${start + sliceLen}</span>
      <span class="pager-sep">/</span>
      <span class="num">${total}</span>
      <button type="button" data-pg-kind="${kind}" data-pg="next" ${cur === totalPages ? 'disabled' : ''}>다음 ›</button>
      <span class="pager-info"><span class="num">${cur}</span>/<span class="num">${totalPages}</span></span>
    </nav>
  `;
}

function bindPager(host, kind) {
  host.querySelectorAll(`button[data-pg-kind="${kind}"]`).forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const stKey = kind === 'etr' ? 'etrPage' : 'ftPage';
      if (btn.dataset.pg === 'prev') state[stKey]--;
      else state[stKey]++;
      if (kind === 'etr') renderTable(); else renderFtTable();
      const reduce = typeof matchMedia === 'function'
        && matchMedia('(prefers-reduced-motion: reduce)').matches;
      host.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    });
  });
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

/* ─── 진행 칸반 ──────────────────────────────────────────── */

/** 인입(ETR) + 연결/복사 Initiative 를 컬럼별로 분류.
 *  @returns {Record<string, object[]>} 컬럼 id → 카드 배열 */
export function buildKanban(etrItems = state.items, ftItems = state.ftItems) {
  const cols = {};
  for (const c of KANBAN_COLS) cols[c.id] = [];

  // 1) 요구사항 인입 — ETR 인입 단계 티켓
  for (const it of etrItems) {
    if (INTAKE_STATUSES.has(it.status)) cols.intake.push(kanbanCard(it, it.project || 'ETR'));
  }

  // 2) 다운스트림 — ft-tickets(풀필드) + ETR linkedTickets(stub), 패스트트랙 프로젝트만, 키로 dedup
  const seen = new Set();
  const consider = (raw, proj) => {
    const key = raw && raw.key;
    if (!key || seen.has(key) || !KANBAN_PROJECTS.has(proj)) return;
    seen.add(key);
    if (KANBAN_TERMINAL.has(raw.status)) return;           // 종료 — 보드 제외
    const col = STATUS_TO_COL[raw.status] || 'backlog';    // 미매핑 비종료 상태는 대기로(누락 방지)
    cols[col].push(kanbanCard(raw, proj));
  };
  for (const it of ftItems) consider(it, it.project || projectOfKey(it.key));
  for (const etr of etrItems) {
    for (const l of (etr.linkedTickets || [])) consider(l, projectOfKey(l.key));
  }
  return cols;
}

function kanbanCard(raw, proj) {
  return {
    key: raw.key,
    summary: raw.summary || '',
    status: raw.status || '',
    statusCategory: raw.statusCategory,
    project: proj,
    assignee: (raw.assignee && raw.assignee.name) || null,
    manual: !!raw.manual,
    labels: Array.isArray(raw.labels) ? raw.labels : [],
  };
}

function renderKanban() {
  const host = document.getElementById('ft-kanban');
  if (!host) return;
  if (!state.items.length && !state.ftItems.length) {
    host.innerHTML = emptyHtml({ kicker: 'NO DATA', msg: '데이터 동기화 대기 중.' });
    return;
  }
  const labelOnly = !!scoped(KANBAN_LABEL_KEY).get(false);
  const cols = buildKanban();
  const keep = (c) => !labelOnly || cardHasLabel(c, KANBAN_LABEL);
  const total = KANBAN_COLS.reduce((n, c) => n + (cols[c.id] || []).filter(keep).length, 0);

  host.innerHTML = `
    <div class="ftk-toolbar">
      <button type="button" class="tlink ${labelOnly ? 'active' : ''}" data-ft-label
              aria-pressed="${labelOnly}" title="'fasttrack' 레이블이 붙은 카드만 표시">
        ⚡ fasttrack 레이블만
      </button>
      <span class="ftk-toolbar-ct muted num">${total}건${labelOnly ? ' (필터됨)' : ''}</span>
    </div>
    <div class="ftk-board">
      ${KANBAN_COLS.map(c => {
        const cards = (cols[c.id] || []).filter(keep);
        return `
          <div class="ftk-col" data-col="${c.id}">
            <div class="ftk-col-h">
              <span class="ftk-col-name">${escapeHtml(c.label)}</span>
              <span class="ct num">${cards.length}</span>
            </div>
            <div class="ftk-col-body">
              ${cards.length ? cards.map(kanbanCardHtml).join('') : '<div class="ftk-empty">—</div>'}
            </div>
          </div>`;
      }).join('')}
    </div>`;

  const toggle = host.querySelector('[data-ft-label]');
  if (toggle) toggle.addEventListener('click', () => {
    scoped(KANBAN_LABEL_KEY).set(!labelOnly);
    renderKanban();
  });
}

function kanbanCardHtml(c) {
  const g = STATUS_GROUPS.find(x => x.id === statusGroup(c));
  const stCls = g ? g.stClass : 'st-wait';
  const who = c.assignee
    ? `<span class="who"><span class="who-dot"></span>${escapeHtml(c.assignee)}</span>`
    : '<span class="who muted">미배정</span>';
  const manualTag = c.manual ? '<span class="ftk-tag">수동</span>' : '';
  return `
    <div class="ftk-card">
      <div class="ftk-card-top">
        <span class="ftk-proj">${escapeHtml(c.project)}</span>${manualTag}
        ${jiraKeyHtml(c.key)}
      </div>
      <div class="ftk-card-sum">${escapeHtml(c.summary)}</div>
      <div class="ftk-card-meta">
        <span class="st ${stCls}">${escapeHtml(c.status)}</span>
        ${who}
      </div>
    </div>`;
}

/* ─── 수동 티켓 등록(키) 모달 ──────────────────────────────
   키/링크로 Jira 티켓을 ft_manual_tickets 에 등록 → 다음 sync 가 issuekey IN(...)
   로 조회해 ft-tickets.json 에 manual:true 로 포함. 등록 즉시 반영 안 됨(동기화 필요).
   one-tickets 의 동일 모달을 패스트트랙용 테이블로 옮긴 것. */
async function openManualModal() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-label="키로 티켓 추가" style="max-width:480px;">
      <div class="modal-head">
        <div>
          <div class="modal-kicker">MANUAL TICKET</div>
          <h3 class="modal-title">키로 패스트트랙 티켓 추가</h3>
        </div>
        <button class="modal-close" type="button" data-mt-close>CLOSE</button>
      </div>
      <div class="modal-body">
        <div style="display:flex; gap:8px; align-items:center;">
          <input type="text" data-mt-input placeholder="Jira URL 또는 키 (예: TM-1234)"
                 style="flex:1; min-width:0;" aria-label="Jira URL 또는 키" />
          <button type="button" class="btn primary" data-mt-add>추가</button>
        </div>
        <p class="muted" style="font-size:11.5px; margin:8px 0 0;">
          자동 동기화(MSSCXTF·FT·PEL·TF Initiative)에 안 잡히는 티켓(예: 특정 TM Initiative)을 명시 노출합니다.
          등록한 티켓은 <strong>다음 동기화(매일 06:00 KST) 후</strong> 목록에 반영됩니다.
        </p>
        <div data-mt-list style="margin-top:14px; display:flex; flex-direction:column; gap:6px;">
          <div class="muted" style="font-size:12px;">불러오는 중…</div>
        </div>
      </div>
      <div class="modal-foot" style="justify-content:flex-end;">
        <button type="button" class="btn ghost" data-mt-close>닫기</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const input = backdrop.querySelector('[data-mt-input]');
  const listHost = backdrop.querySelector('[data-mt-list]');
  const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelectorAll('[data-mt-close]').forEach(b => b.addEventListener('click', close));

  const renderList = (rows) => {
    if (!rows || !rows.length) {
      listHost.innerHTML = `<div class="muted" style="font-size:12px;">등록된 수동 티켓이 없습니다.</div>`;
      return;
    }
    listHost.innerHTML = rows.map(r => {
      const k = escapeAttr(r.jira_key);
      return `<div style="display:flex; align-items:center; gap:8px; justify-content:space-between;">
        <span>${jiraKeyHtml(r.jira_key)}${r.note ? ` <span class="muted" style="font-size:11px;">${escapeHtml(r.note)}</span>` : ''}</span>
        <button type="button" class="tlink" data-mt-remove="${k}" title="등록 해제">✕</button>
      </div>`;
    }).join('');
    listHost.querySelectorAll('[data-mt-remove]').forEach(b => {
      b.addEventListener('click', () => doRemove(b.dataset.mtRemove));
    });
  };

  const reload = async () => {
    try {
      renderList(await loadManualTickets());
    } catch (e) {
      if (e instanceof AuthRequiredError) { toast({ kicker: '로그인 필요', msg: '다시 로그인하세요.', kind: 'alert' }); close(); return; }
      listHost.innerHTML = `<div class="muted" style="font-size:12px;">목록 로드 실패: ${escapeHtml(e.message || String(e))}</div>`;
    }
  };

  const doAdd = async () => {
    const key = extractJiraKey(input.value);
    if (!key) { toast({ kicker: '형식 오류', msg: '유효한 Jira 키/링크가 아닙니다 (예: TM-1234).', kind: 'alert' }); return; }
    try {
      await addManualTicket(key);
      input.value = '';
      toast({ kicker: '등록됨', msg: `${key} · 다음 동기화 후 목록에 반영됩니다.`, kind: 'success' });
      await reload();
    } catch (e) {
      if (e instanceof AuthRequiredError) { toast({ kicker: '로그인 필요', msg: '다시 로그인하세요.', kind: 'alert' }); close(); return; }
      toast({ kicker: '등록 실패', msg: e.message || String(e), kind: 'alert' });
    }
  };

  const doRemove = async (key) => {
    try {
      await removeManualTicket(key);
      toast({ kicker: '해제됨', msg: `${key} 등록 해제 · 다음 동기화 후 목록에서 제외됩니다.`, kind: 'success' });
      await reload();
    } catch (e) {
      if (e instanceof AuthRequiredError) { toast({ kicker: '로그인 필요', msg: '다시 로그인하세요.', kind: 'alert' }); close(); return; }
      toast({ kicker: '해제 실패', msg: e.message || String(e), kind: 'alert' });
    }
  };

  backdrop.querySelector('[data-mt-add]').addEventListener('click', doAdd);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
  setTimeout(() => input.focus(), 0);
  reload();
}

export const _internal = {
  isItemDone, normalizeItem, PERIOD_DAYS, PAGE_SIZE,
  STATUS_TRIAGE, STATUS_NORMAL,
  dwellStats, weekBuckets, kstWeekRange, pickElapsedAnchor,
  weeklyTrend, weeklyCombined, isRealDone,
};
