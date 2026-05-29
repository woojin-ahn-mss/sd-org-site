/* =========================================================
   one-ticket-meta.js — One 티켓 운영 메타(코멘트 · 수동순위) 데이터 레이어
   Sheet 가 SoT. roadmap-plan-data.js 패턴 축소판 — 시트 1개만 다룸.

   시트: one-ticket-meta
     jira_key | manual_rank | comment | last_updated_at

   - manual_rank: 사용자가 직접 입력하는 숫자 순위 (작을수록 상위). 빈 값 허용.
   - comment: 단일 메모(덮어쓰기). 빈 값 허용.
   - 둘 다 비면 행 자체를 삭제(stale 정리).

   호출 패턴:
     await auth.ensureSignedIn();
     await verifyOneMetaSchema();         // 실패 시 ensureOneMetaSheet() 로 자동 생성
     const rows = await loadOneMeta();
     await upsertOneMeta('ETR-1', { comment: '검토중' }, rows);
   ========================================================= */

import {
  sheets,
  rowsToObjects,
  objectToRow,
  nowIso,
  SPREADSHEET_ID,
} from './sheets.js';

export const ONE_META_SHEET = 'one-ticket-meta';
export const ONE_META_HEADER = ['jira_key', 'manual_rank', 'comment', 'last_updated_at'];

/* ─── 스키마 검증 ─────────────────────────────────────────── */

export class SchemaMismatchError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'SchemaMismatchError';
    this.detail = detail;
  }
}

/** 헤더(A1:Z1)가 ONE_META_HEADER 와 정확히 일치하는지 검증. 불일치/시트없음 시 throw. */
export async function verifyOneMetaSchema() {
  let res;
  try {
    res = await sheets.read(SPREADSHEET_ID, `${ONE_META_SHEET}!A1:Z1`);
  } catch (e) {
    throw new SchemaMismatchError(
      `시트 "${ONE_META_SHEET}" 을 읽을 수 없습니다 (${e.status || 'unknown'}).`,
      { missing: true, cause: e },
    );
  }
  const actual = (res.values && res.values[0]) || [];
  const mismatch = ONE_META_HEADER.some((col, idx) => (actual[idx] || '') !== col);
  if (mismatch || actual.length < ONE_META_HEADER.length) {
    throw new SchemaMismatchError(
      `시트 "${ONE_META_SHEET}" 헤더 불일치.\n  예상: ${ONE_META_HEADER.join(' | ')}\n  실제: ${actual.join(' | ') || '(빈 행)'}`,
      { missing: actual.length === 0 },
    );
  }
  return true;
}

/**
 * one-ticket-meta 시트가 없으면 생성하고 헤더 행을 기록.
 * 이미 있으면 헤더만 덮어써 정합성 보장.
 */
export async function ensureOneMetaSheet() {
  try {
    await sheets.addSheet(SPREADSHEET_ID, ONE_META_SHEET);
  } catch (e) {
    // 이미 존재(400 "already exists")는 무시, 그 외는 surface.
    const msg = String(e && e.message || '');
    if (!/already exists/i.test(msg) && e.status !== 400) throw e;
  }
  resetSheetIdCache();
  await sheets.update(SPREADSHEET_ID, `${ONE_META_SHEET}!A1:D1`, [ONE_META_HEADER]);
  return true;
}

/* ─── 시트 메타 캐시 (sheetId — deleteRow 용) ──────────────── */

let sheetIdCache = null;

async function ensureSheetId() {
  if (sheetIdCache != null) return sheetIdCache;
  const meta = await sheets.meta(SPREADSHEET_ID, { fields: 'sheets.properties(sheetId,title)' });
  for (const s of meta.sheets || []) {
    if (s.properties && s.properties.title === ONE_META_SHEET) {
      sheetIdCache = s.properties.sheetId;
      return sheetIdCache;
    }
  }
  throw new Error(`ensureSheetId: 시트 "${ONE_META_SHEET}" sheetId 미상`);
}

function resetSheetIdCache() { sheetIdCache = null; }

/* ─── read ────────────────────────────────────────────────── */

/**
 * 전체 행 read → 객체 배열 (_rowNum 1-based, 헤더 = row 1).
 * @returns {Promise<Array<{jira_key, manual_rank, comment, last_updated_at, _rowNum}>>}
 */
export async function loadOneMeta() {
  const res = await sheets.read(SPREADSHEET_ID, `${ONE_META_SHEET}!A1:Z5000`);
  const rows = res.values || [];
  if (rows.length <= 1) return [];
  const objs = rowsToObjects(rows.slice(1), ONE_META_HEADER);
  return objs.map((obj, i) => ({ ...obj, _rowNum: i + 2 }));
}

/** loadOneMeta 결과를 jira_key → row 맵으로. */
export function metaByKey(rows) {
  const m = new Map();
  for (const r of rows || []) {
    if (r && r.jira_key) m.set(String(r.jira_key), r);
  }
  return m;
}

/* ─── upsert / delete ─────────────────────────────────────── */

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

function parseRowNumFromRange(range) {
  if (typeof range !== 'string') return null;
  const m = /![A-Z]+(\d+)/.exec(range);
  return m ? parseInt(m[1], 10) : null;
}

function isEmptyMeta(row) {
  const r = String(row.manual_rank ?? '').trim();
  const c = String(row.comment ?? '').trim();
  return r === '' && c === '';
}

/**
 * jira_key 행을 upsert. patch 는 {manual_rank?, comment?} — 지정한 필드만 덮어쓰고 나머지는 보존.
 * manual_rank/comment 가 모두 비면 기존 행을 삭제(stale 정리).
 *
 * @param {string} jiraKey
 * @param {{manual_rank?: string|number, comment?: string}} patch
 * @param {Array} currentRows loadOneMeta 결과 (_rowNum 보유) — 기존 행 탐색용
 * @returns {Promise<object|null>} 저장된 행(또는 삭제 시 null)
 */
export async function upsertOneMeta(jiraKey, patch = {}, currentRows = []) {
  if (!jiraKey) throw new Error('upsertOneMeta: jiraKey 필요');
  const existing = currentRows.find(r => String(r.jira_key) === String(jiraKey));

  const merged = {
    jira_key: jiraKey,
    manual_rank: 'manual_rank' in patch ? normRank(patch.manual_rank) : (existing ? existing.manual_rank : ''),
    comment: 'comment' in patch ? String(patch.comment ?? '') : (existing ? existing.comment : ''),
    last_updated_at: nowIso(),
  };

  // 둘 다 비면 행 삭제
  if (isEmptyMeta(merged)) {
    if (existing && existing._rowNum) {
      const sheetId = await ensureSheetId();
      await sheets.deleteRow(SPREADSHEET_ID, sheetId, existing._rowNum - 1);
    }
    return null;
  }

  if (existing && existing._rowNum) {
    const lastCol = colLetter(ONE_META_HEADER.length - 1);
    const range = `${ONE_META_SHEET}!A${existing._rowNum}:${lastCol}${existing._rowNum}`;
    await sheets.update(SPREADSHEET_ID, range, [objectToRow(merged, ONE_META_HEADER)]);
    return { ...merged, _rowNum: existing._rowNum };
  }

  const res = await sheets.append(SPREADSHEET_ID, `${ONE_META_SHEET}!A1`, [objectToRow(merged, ONE_META_HEADER)]);
  return { ...merged, _rowNum: parseRowNumFromRange(res?.updates?.updatedRange) };
}

/** 순위 정규화: 숫자/숫자문자열만 통과(문자열로 보존), 그 외는 '' . */
function normRank(v) {
  if (v == null || v === '') return '';
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? String(n) : '';
}

/* ─── test export ─────────────────────────────────────────── */

export const _internal = {
  colLetter, parseRowNumFromRange, isEmptyMeta, normRank, resetSheetIdCache,
};
