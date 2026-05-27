/* =========================================================
   roadmap-plan-data.js — Sheet 가 SoT 인 roadmap-plan 데이터 레이어
   PRD §3.3 (2026-05-27 v3) — Objective → Subject(주제) → Card(키워드)
   Jira 티켓의 subject 매핑 + 분기 override 는 roadmap-plan-overrides 시트.

   호출 패턴:
     await auth.ensureSignedIn();
     await verifySchema();
     const data = await loadAll(2026);
     await createObjective({ name: '검색 품질', color: 'accent' });

   행번호 (_rowNum):
     - 1-based, Sheet UI 와 동일. 헤더 = row 1, 첫 데이터 = row 2.
     - read 시 객체에 부여. update/delete 는 이 값으로 range/index 계산.
   ========================================================= */

import {
  sheets,
  rowsToObjects,
  objectToRow,
  nowIso,
  SPREADSHEET_ID,
} from './sheets.js';

/* ─── 스키마 (PRD §3.3 표) ────────────────────────────────── */

export const OBJECTIVES_SHEET = 'objectives';
export const SUBJECTS_SHEET   = 'subjects';
export const CARDS_SHEET      = 'roadmap-plan-cards';
export const OVERRIDES_SHEET  = 'roadmap-plan-overrides';

export const OBJECTIVES_HEADER = [
  'id', 'name', 'color', 'description', 'display_order',
  'created_at', 'last_updated_at',
];

export const SUBJECTS_HEADER = [
  'id', 'objective_id', 'name', 'description',
  'startMonth', 'endMonth', 'display_order',
  'created_at', 'last_updated_at',
];

export const CARDS_HEADER = [
  'id', 'subject_id', 'year', 'quarter',
  'title', 'notes', 'mainSubject', 'priority', 'projectKey',
  'created_at', 'last_updated_at',
];

export const OVERRIDES_HEADER = [
  'jira_key', 'year', 'subject_id', 'quarter', 'last_updated_at',
];

const SHEETS_SPEC = [
  { name: OBJECTIVES_SHEET, header: OBJECTIVES_HEADER },
  { name: SUBJECTS_SHEET,   header: SUBJECTS_HEADER   },
  { name: CARDS_SHEET,      header: CARDS_HEADER      },
  { name: OVERRIDES_SHEET,  header: OVERRIDES_HEADER  },
];

/* ─── 시트 메타 캐시 (sheetId — deleteRow 용) ──────────────── */

let sheetIdCache = null;  // { [sheetTitle]: number }

async function ensureSheetIds() {
  if (sheetIdCache) return sheetIdCache;
  const meta = await sheets.meta(SPREADSHEET_ID, { fields: 'sheets.properties(sheetId,title)' });
  const map = {};
  for (const s of meta.sheets || []) {
    if (s.properties) map[s.properties.title] = s.properties.sheetId;
  }
  sheetIdCache = map;
  return map;
}

function resetSheetIdCache() { sheetIdCache = null; }

/* ─── 스키마 검증 ─────────────────────────────────────────── */

export class SchemaMismatchError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'SchemaMismatchError';
    this.detail = detail;
  }
}

/**
 * 4 시트의 첫 행(헤더) 이 상수 헤더와 정확히 일치하는지 검증.
 * 시트 없음 / 헤더 불일치 시 SchemaMismatchError throw.
 */
export async function verifySchema() {
  const ranges = SHEETS_SPEC.map(s => `${s.name}!A1:Z1`);
  const results = await Promise.all(
    ranges.map(r => sheets.read(SPREADSHEET_ID, r).catch(e => ({ error: e })))
  );
  const issues = [];
  for (let i = 0; i < SHEETS_SPEC.length; i++) {
    const spec = SHEETS_SPEC[i];
    const r = results[i];
    if (r.error) {
      issues.push(`시트 "${spec.name}" 을 읽을 수 없습니다 (${r.error.status || 'unknown'}).`);
      continue;
    }
    const actual = (r.values && r.values[0]) || [];
    const expected = spec.header;
    const mismatch = expected.some((col, idx) => (actual[idx] || '') !== col);
    if (mismatch || actual.length < expected.length) {
      issues.push(
        `시트 "${spec.name}" 헤더 불일치.\n  예상: ${expected.join(' | ')}\n  실제: ${actual.join(' | ') || '(빈 행)'}`
      );
    }
  }
  if (issues.length) {
    throw new SchemaMismatchError(
      'Sheet 스키마 초기화가 필요합니다.\n\n' + issues.join('\n\n'),
      { issues }
    );
  }
  return true;
}

/* ─── 전체 read ───────────────────────────────────────────── */

/**
 * 4 시트 병렬 read → 객체 배열로 반환. 각 객체에 `_rowNum` (1-based) 부여.
 * year 인자로 cards/overrides 를 해당 연도만 필터링.
 *
 * @param {number} year
 * @returns {Promise<{ objectives:Object[], subjects:Object[], cards:Object[], overrides:Object[] }>}
 */
export async function loadAll(year) {
  const ranges = [
    `${OBJECTIVES_SHEET}!A1:Z2000`,
    `${SUBJECTS_SHEET}!A1:Z2000`,
    `${CARDS_SHEET}!A1:Z5000`,
    `${OVERRIDES_SHEET}!A1:Z5000`,
  ];
  const [oRes, sRes, cRes, ovRes] = await Promise.all(
    ranges.map(r => sheets.read(SPREADSHEET_ID, r))
  );

  const objectives = parseRows(oRes, OBJECTIVES_HEADER);
  const subjects   = parseRows(sRes, SUBJECTS_HEADER);
  const cards      = parseRows(cRes, CARDS_HEADER).filter(c => normalizeYear(c.year) === year);
  const overrides  = parseRows(ovRes, OVERRIDES_HEADER).filter(o => normalizeYear(o.year) === year);

  // display_order 정렬 (숫자 강제, 없으면 뒤)
  objectives.sort((a, b) => orderVal(a) - orderVal(b));
  subjects.sort((a, b) => orderVal(a) - orderVal(b));

  return { objectives, subjects, cards, overrides };
}

function parseRows(res, header) {
  const rows = res.values || [];
  if (!rows.length) return [];
  const dataRows = rows.slice(1);  // 헤더 제외
  const objs = rowsToObjects(dataRows, header);
  // _rowNum 부여: 0번 데이터는 row 2 (헤더가 row 1).
  return objs.map((obj, i) => ({ ...obj, _rowNum: i + 2 }));
}

function orderVal(obj) {
  const n = parseInt(obj.display_order, 10);
  return Number.isFinite(n) ? n : 9999;
}

function normalizeYear(v) {
  if (typeof v === 'number') return v;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/* ─── ID 생성 ─────────────────────────────────────────────── */

function uid(prefix) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newObjectiveId() { return uid('obj'); }
export function newSubjectId()   { return uid('sub'); }
export function newCardId()      { return uid('card'); }

/* ─── append/update/delete 공통 ───────────────────────────── */

function parseRowNumFromRange(range) {
  if (typeof range !== 'string') return null;
  const m = /![A-Z]+(\d+)/.exec(range);
  return m ? parseInt(m[1], 10) : null;
}

function rowRange(sheetName, rowNum, header) {
  const lastCol = colLetter(header.length - 1);
  return `${sheetName}!A${rowNum}:${lastCol}${rowNum}`;
}

function colLetter(n) {
  if (typeof n !== 'number' || n < 0 || !Number.isFinite(n)) return '';
  n = Math.floor(n);
  let s = '';
  while (true) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return s;
}

async function appendRow(sheetName, header, obj) {
  const row = objectToRow(obj, header);
  const res = await sheets.append(SPREADSHEET_ID, `${sheetName}!A1`, [row]);
  return parseRowNumFromRange(res?.updates?.updatedRange);
}

async function updateRow(sheetName, header, obj) {
  if (!obj._rowNum) throw new Error('updateRow: _rowNum 누락');
  const range = rowRange(sheetName, obj._rowNum, header);
  const row = objectToRow(obj, header);
  await sheets.update(SPREADSHEET_ID, range, [row]);
}

async function deleteRow(sheetName, rowNum) {
  if (!rowNum) throw new Error('deleteRow: rowNum 누락');
  const ids = await ensureSheetIds();
  const sheetId = ids[sheetName];
  if (sheetId === undefined) throw new Error(`deleteRow: 시트 "${sheetName}" 의 sheetId 미상`);
  // rowNum (1-based, 헤더 포함) → rowIndex (0-based) = rowNum - 1
  await sheets.deleteRow(SPREADSHEET_ID, sheetId, rowNum - 1);
}

/* ─── Objective CRUD ─────────────────────────────────────── */

export async function createObjective(input) {
  const now = nowIso();
  const obj = {
    id: input.id || newObjectiveId(),
    name: input.name || '',
    color: input.color || 'accent',
    description: input.description || '',
    display_order: Number.isFinite(input.display_order) ? input.display_order : 0,
    created_at: now,
    last_updated_at: now,
  };
  const rowNum = await appendRow(OBJECTIVES_SHEET, OBJECTIVES_HEADER, obj);
  return { ...obj, _rowNum: rowNum };
}

export async function updateObjective(obj, patch = {}) {
  const merged = {
    ...obj,
    ...patch,
    last_updated_at: nowIso(),
  };
  // _rowNum 보존
  merged._rowNum = obj._rowNum;
  await updateRow(OBJECTIVES_SHEET, OBJECTIVES_HEADER, merged);
  return merged;
}

/** 삭제 가능 여부 검증. 매핑된 subject 있으면 false. */
export function validateObjectiveDelete(id, subjects) {
  if (!Array.isArray(subjects)) return { ok: true };
  const using = subjects.filter(s => s.objective_id === id);
  if (using.length) {
    return {
      ok: false,
      reason: `이 Objective 에 속한 주제(${using.length}개)가 있습니다. 먼저 주제를 이동하거나 삭제하세요.`,
      using,
    };
  }
  return { ok: true };
}

export async function deleteObjective(obj) {
  await deleteRow(OBJECTIVES_SHEET, obj._rowNum);
}

/* ─── Subject CRUD ───────────────────────────────────────── */

export async function createSubject(input) {
  const now = nowIso();
  const subj = {
    id: input.id || newSubjectId(),
    objective_id: input.objective_id || '',
    name: input.name || '',
    description: input.description || '',
    startMonth: input.startMonth || '',
    endMonth: input.endMonth || '',
    display_order: Number.isFinite(input.display_order) ? input.display_order : 0,
    created_at: now,
    last_updated_at: now,
  };
  const rowNum = await appendRow(SUBJECTS_SHEET, SUBJECTS_HEADER, subj);
  return { ...subj, _rowNum: rowNum };
}

export async function updateSubject(subj, patch = {}) {
  const merged = {
    ...subj,
    ...patch,
    last_updated_at: nowIso(),
  };
  merged._rowNum = subj._rowNum;
  await updateRow(SUBJECTS_SHEET, SUBJECTS_HEADER, merged);
  return merged;
}

/** cards/overrides 가 가리키는 subject 면 삭제 차단. */
export function validateSubjectDelete(id, cards, overrides) {
  const cardUsing = (cards || []).filter(c => c.subject_id === id);
  const ovUsing   = (overrides || []).filter(o => o.subject_id === id);
  if (cardUsing.length || ovUsing.length) {
    return {
      ok: false,
      reason: `이 주제에 속한 카드(${cardUsing.length}) / 티켓 매핑(${ovUsing.length})이 있습니다. 먼저 정리하세요.`,
      cardUsing, ovUsing,
    };
  }
  return { ok: true };
}

export async function deleteSubject(subj) {
  await deleteRow(SUBJECTS_SHEET, subj._rowNum);
}

/* ─── Card CRUD (키워드 카드 전용) ──────────────────────── */

export async function createCard(input) {
  const now = nowIso();
  const card = {
    id: input.id || newCardId(),
    subject_id: input.subject_id || '',
    year: Number.isFinite(input.year) ? input.year : (parseInt(input.year, 10) || new Date().getFullYear()),
    quarter: input.quarter || '',
    title: input.title || '',
    notes: input.notes || '',
    mainSubject: input.mainSubject || '',
    priority: input.priority || '',
    projectKey: input.projectKey || '',
    created_at: now,
    last_updated_at: now,
  };
  const rowNum = await appendRow(CARDS_SHEET, CARDS_HEADER, card);
  return { ...card, _rowNum: rowNum };
}

export async function updateCard(card, patch = {}) {
  const merged = {
    ...card,
    ...patch,
    last_updated_at: nowIso(),
  };
  merged._rowNum = card._rowNum;
  await updateRow(CARDS_SHEET, CARDS_HEADER, merged);
  return merged;
}

export async function deleteCard(card) {
  await deleteRow(CARDS_SHEET, card._rowNum);
}

/* ─── Jira 티켓 override (subject 매핑 + 분기) ──────────── */

/**
 * jira_key 의 override 행을 upsert. 분기를 비우려면 quarter='', subject_id 도 ''.
 * 둘 다 '' 면 행 자체를 삭제(stale 정리).
 * @param {string} jiraKey
 * @param {{year:number, subject_id?:string, quarter?:string}} patch
 * @param {Object[]} currentOverrides loadAll 의 overrides — 기존 행 탐색용 (_rowNum 필요)
 */
export async function setTicketMapping(jiraKey, patch, currentOverrides = []) {
  const year = Number.isFinite(patch.year) ? patch.year : (parseInt(patch.year, 10) || new Date().getFullYear());
  const subject_id = patch.subject_id || '';
  const quarter = patch.quarter || '';
  const existing = currentOverrides.find(o => o.jira_key === jiraKey && normalizeYear(o.year) === year);

  // 비어 있으면 행 삭제 (stale 방지)
  if (!subject_id && !quarter) {
    if (existing) await deleteRow(OVERRIDES_SHEET, existing._rowNum);
    return null;
  }

  const row = {
    jira_key: jiraKey,
    year,
    subject_id,
    quarter,
    last_updated_at: nowIso(),
  };
  if (existing) {
    row._rowNum = existing._rowNum;
    await updateRow(OVERRIDES_SHEET, OVERRIDES_HEADER, row);
    return row;
  }
  const rowNum = await appendRow(OVERRIDES_SHEET, OVERRIDES_HEADER, row);
  return { ...row, _rowNum: rowNum };
}

export async function clearTicketOverride(jiraKey, currentOverrides = []) {
  return setTicketMapping(jiraKey, { year: new Date().getFullYear() }, currentOverrides);
}

/* ─── Jira 티켓에 override 결합 (pure, 테스트 대상) ─────── */

/**
 * Jira 티켓 배열에 overrides 의 subject_id/quarter 를 덮어씌움.
 * Jira 자체 yearQuarter 도 보존. override 없으면 원본 그대로.
 *
 * @param {Object[]} jiraTickets initiatives.json items (mainSubject/yearQuarter/priority/...)
 * @param {Object[]} overrides loadAll 의 overrides (year 필터 적용된 상태)
 * @param {number} year
 * @returns {Object[]} {key, summary, yearQuarter, ..., subject_id, quarter, _override:boolean}
 */
export function joinTicketsWithOverrides(jiraTickets, overrides, year) {
  if (!Array.isArray(jiraTickets)) return [];
  const idx = new Map();
  for (const o of (overrides || [])) {
    if (o.jira_key) idx.set(String(o.jira_key), o);
  }
  return jiraTickets.map(t => {
    const o = idx.get(String(t.key));
    const baseQuarter = parseQuarterFromYearQuarter(t.yearQuarter, year);
    if (!o) {
      return {
        ...t,
        subject_id: '',
        quarter: baseQuarter,
        baseQuarter,
        _override: false,
      };
    }
    return {
      ...t,
      subject_id: o.subject_id || '',
      quarter: o.quarter || baseQuarter,
      baseQuarter,
      _override: !!(o.subject_id || (o.quarter && o.quarter !== baseQuarter)),
    };
  });
}

/** "2026-Q3" 같은 string 에서 해당 연도면 'Q3' 반환, 아니면 ''. */
function parseQuarterFromYearQuarter(yq, year) {
  if (typeof yq !== 'string') return '';
  const m = /^(\d{4})-(Q[1-4])$/.exec(yq.trim());
  if (!m) return '';
  if (parseInt(m[1], 10) !== year) return '';
  return m[2];
}

/* ─── test export ─────────────────────────────────────────── */

export const _internal = {
  parseRows, orderVal, normalizeYear,
  parseRowNumFromRange, rowRange, colLetter,
  parseQuarterFromYearQuarter,
  resetSheetIdCache,
};
