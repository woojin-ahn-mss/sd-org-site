/* =========================================================
   assets/js/api/roadmap-plan-migration.js
   localStorage (sd.roadmapPlan.*) → Google Sheet (roadmap-plan-*) 1회용 이관.

   pure 변환 함수 + sheet bulk append 호출. roadmap-plan.js 의 본 흐름과 독립.
   ========================================================= */

import { sheets, SPREADSHEET_ID, nowIso } from './sheets.js';

/**
 * 사용자 브라우저 localStorage 에서 roadmap-plan 관련 키가 있는 연도 목록 스캔.
 * 키 패턴: sd.roadmapPlan.(cards|jiraOverrides|goals|cardGoals).YYYY
 * @returns {number[]} 정렬된 unique 연도
 */
export function scanRoadmapPlanYears(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return [];
  const years = new Set();
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (!k) continue;
    const m = /^sd\.roadmapPlan\.(cards|jiraOverrides|goals|cardGoals)\.(\d{4})$/.exec(k);
    if (m) years.add(Number(m[2]));
  }
  return [...years].sort((a, b) => a - b);
}

/**
 * 모든 LS 데이터 수집.
 * @returns {{
 *   years: number[],
 *   cards: Array<{year:number, card:object}>,        // 각 연도의 keywordCard 들 평탄화
 *   goals: Array<{year:number, goal:object}>,        // 각 연도의 goal 들 평탄화
 *   cardGoals: Object<string, string>,               // cardId → goalId (모든 연도 통합)
 *   overrides: Array<{year:number, jiraKey:string, quarter:string|null}>,
 * }}
 */
export function collectLocalStorageData(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return { years: [], cards: [], goals: [], cardGoals: {}, overrides: [] };
  const years = scanRoadmapPlanYears(storage);
  const out = { years, cards: [], goals: [], cardGoals: {}, overrides: [] };
  for (const year of years) {
    const cards = readJson(storage, `sd.roadmapPlan.cards.${year}`);
    if (Array.isArray(cards)) for (const c of cards) out.cards.push({ year, card: c });

    const goals = readJson(storage, `sd.roadmapPlan.goals.${year}`);
    if (Array.isArray(goals)) for (const g of goals) out.goals.push({ year, goal: g });

    const cg = readJson(storage, `sd.roadmapPlan.cardGoals.${year}`);
    if (cg && typeof cg === 'object') Object.assign(out.cardGoals, cg);

    const ov = readJson(storage, `sd.roadmapPlan.jiraOverrides.${year}`);
    if (ov && typeof ov === 'object') {
      for (const [jiraKey, val] of Object.entries(ov)) {
        const q = val && typeof val === 'object' ? val.quarter : val;
        out.overrides.push({ year, jiraKey, quarter: q || null });
      }
    }
  }
  return out;
}

function readJson(storage, key) {
  try { return JSON.parse(storage.getItem(key)); } catch (_) { return null; }
}

/* ─── 변환 (pure) ───────────────────────────────────────────────── */

// 시트 실제 컬럼 순서. 데이터 손실 방지 위해 LS 원본 필드를 모두 매핑.
const OBJECTIVES_HEADER = ['id', 'name', 'description', 'color', 'display_order', 'created_at', 'last_updated_at', 'start_month', 'end_month'];
const CARDS_HEADER      = ['id', 'year', 'quarter', 'title', 'notes', 'mainSubject', 'priority', 'projectKey', 'ticketKey', 'objective_id', 'created_at', 'last_updated_at'];
const OVERRIDES_HEADER  = ['jira_key', 'year', 'quarter', 'last_updated_at'];

/**
 * LS 의 goal 들을 objectives 시트 row 로 변환.
 * 여러 연도에 같은 goal.id 가 있으면 첫 등장만 유지 (id 충돌 방지).
 * @param {Array<{year, goal}>} entries
 * @param {string} now ISO
 * @returns {{rows: string[][], header: string[]}}
 */
export function goalsToObjectiveRows(entries, now) {
  const seen = new Set();
  const rows = [];
  for (const { goal } of entries) {
    if (!goal || !goal.id || seen.has(goal.id)) continue;
    seen.add(goal.id);
    const order = typeof goal.order === 'number' ? goal.order : '';
    rows.push([
      goal.id,
      goal.title || '',
      goal.description || '',
      goal.color || 'accent',
      order === '' ? '' : String(order),
      goal.createdAt || now,
      goal.updatedAt || now,
      goal.startMonth || '',
      goal.endMonth || '',
    ]);
  }
  return { rows, header: OBJECTIVES_HEADER };
}

/**
 * LS 의 keywordCard 들을 roadmap-plan-cards 시트 row 로 변환.
 * objective_id 는 cardGoals[cardId] (이미 1:1). 없으면 빈 문자열.
 */
export function keywordCardsToCardRows(entries, cardGoals, now) {
  const rows = [];
  for (const { year, card } of entries) {
    if (!card || !card.id) continue;
    rows.push([
      card.id,
      String(card.year || year || ''),
      card.quarter || '',
      card.title || '',
      card.notes || '',
      card.mainSubject || '',
      card.priority || '',
      card.projectKey || '',
      card.ticketKey || '',
      cardGoals[card.id] || '',
      card.createdAt || now,
      card.updatedAt || now,
    ]);
  }
  return { rows, header: CARDS_HEADER };
}

/** LS 의 jiraOverrides 들을 overrides 시트 row 로 변환. */
export function overridesToOverrideRows(entries, now) {
  const rows = [];
  for (const e of entries) {
    if (!e || !e.jiraKey) continue;
    rows.push([
      e.jiraKey,
      String(e.year || ''),
      e.quarter || '',
      now,
    ]);
  }
  return { rows, header: OVERRIDES_HEADER };
}

/**
 * 전체 LS 데이터를 sheet bulk append 까지 실행.
 * @param {{cards, goals, cardGoals, overrides}} data — collectLocalStorageData() 결과
 * @returns {Promise<{objectives:number, cards:number, overrides:number}>} 각 시트 append 건수
 */
export async function importToSheets(data, now = nowIso()) {
  const objs = goalsToObjectiveRows(data.goals, now);
  const cards = keywordCardsToCardRows(data.cards, data.cardGoals, now);
  const ovs = overridesToOverrideRows(data.overrides, now);

  // 빈 배열은 append 호출 안 함 (Sheets API 가 400 으로 reject)
  const result = { objectives: 0, cards: 0, overrides: 0 };
  if (objs.rows.length) {
    await sheets.append(SPREADSHEET_ID, 'objectives!A1', objs.rows);
    result.objectives = objs.rows.length;
  }
  if (cards.rows.length) {
    await sheets.append(SPREADSHEET_ID, 'roadmap-plan-cards!A1', cards.rows);
    result.cards = cards.rows.length;
  }
  if (ovs.rows.length) {
    await sheets.append(SPREADSHEET_ID, 'roadmap-plan-overrides!A1', ovs.rows);
    result.overrides = ovs.rows.length;
  }
  return result;
}

/* ─── Backup-to-Sheet (LS + 현재 Sheet 전체를 backup 탭에 한 번에) ───── */

const BACKUP_SHEETS = ['objectives', 'roadmap-plan-cards', 'roadmap-plan-overrides', 'plan', 'meta'];

/** KST 기준 YYYY-MM-DD-HH-MM-SS 타임스탬프. backup 탭 이름 suffix. */
export function backupTabTimestamp(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);  // UTC + 9h
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mm = String(kst.getUTCMinutes()).padStart(2, '0');
  const ss = String(kst.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${d}-${hh}-${mm}-${ss}`;
}

/**
 * LS 전체 데이터 + 현재 Sheet 전체 스냅샷을 backup row 들로 직렬화 (pure).
 * 각 row: [source, key, value_json, exported_at]
 * 컬럼 다양성을 단일 4컬럼 스키마로 흡수 — 손실 없이 모든 원본 JSON 보존.
 */
export function buildBackupRows(lsData, sheetSnapshot, exportedAt) {
  const rows = [
    ['source', 'key', 'value_json', 'exported_at'],
  ];
  // localStorage 측 — collectLocalStorageData() 가 이미 평탄화
  rows.push(['localStorage', 'years', JSON.stringify(lsData?.years || []), exportedAt]);
  rows.push(['localStorage', 'cards', JSON.stringify(lsData?.cards || []), exportedAt]);
  rows.push(['localStorage', 'goals', JSON.stringify(lsData?.goals || []), exportedAt]);
  rows.push(['localStorage', 'cardGoals', JSON.stringify(lsData?.cardGoals || {}), exportedAt]);
  rows.push(['localStorage', 'overrides', JSON.stringify(lsData?.overrides || []), exportedAt]);
  // sheet 측 — 5개 시트의 2D values 그대로
  for (const name of BACKUP_SHEETS) {
    const vals = sheetSnapshot?.[name] || [];
    rows.push(['sheet', name, JSON.stringify(vals), exportedAt]);
  }
  return rows;
}

/**
 * 현재 시트들의 스냅샷 (헤더 포함 2D). 빈 시트는 빈 배열.
 */
export async function snapshotAllSheets() {
  const ranges = BACKUP_SHEETS.map((name) => `${name}!A1:Z2000`);
  const results = await Promise.all(ranges.map((r) => sheets.read(SPREADSHEET_ID, r)));
  const out = {};
  BACKUP_SHEETS.forEach((name, i) => {
    out[name] = results[i].values || [];
  });
  return out;
}

/**
 * 한 번에 처리: LS 전체 + 현재 Sheet 전체를 backup-{KST timestamp} 탭에 적재.
 * 사용자 클릭 1번 → tab 생성 + 단일 append.
 *
 * @param {object} lsData collectLocalStorageData() 결과
 * @returns {Promise<{tabName:string, rowCount:number}>}
 */
export async function backupAllToSheet(lsData, now = new Date()) {
  const tabName = `backup-${backupTabTimestamp(now)}`;
  // 1. 시트(탭) 생성 — 실패 시 (예: 동일 이름 존재) throw 그대로
  await sheets.addSheet(SPREADSHEET_ID, tabName);
  // 2. 현재 sheet 스냅샷 — addSheet 직후 호출해도 신규 탭은 비어 있고 BACKUP_SHEETS 에 포함 안 됨
  const snapshot = await snapshotAllSheets();
  // 3. row 직렬화 (LS + sheet 통합)
  const exportedAt = now.toISOString();
  const rows = buildBackupRows(lsData, snapshot, exportedAt);
  // 4. 단일 append — "한 번에 처리"
  await sheets.append(SPREADSHEET_ID, `${tabName}!A1`, rows);
  return { tabName, rowCount: rows.length };
}

/** 현재 sheet 의 데이터 카운트 — 이관 전 충돌 경고용. */
export async function readSheetCounts() {
  const [o, c, v] = await Promise.all([
    sheets.read(SPREADSHEET_ID, 'objectives!A1:A2000'),
    sheets.read(SPREADSHEET_ID, 'roadmap-plan-cards!A1:A2000'),
    sheets.read(SPREADSHEET_ID, 'roadmap-plan-overrides!A1:A2000'),
  ]);
  // 헤더 1행 제외
  return {
    objectives: Math.max(0, (o.values?.length || 1) - 1),
    cards: Math.max(0, (c.values?.length || 1) - 1),
    overrides: Math.max(0, (v.values?.length || 1) - 1),
  };
}

