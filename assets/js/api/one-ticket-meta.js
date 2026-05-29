/* =========================================================
   one-ticket-meta.js — One 티켓 운영 메타(코멘트·수동순위) 데이터 레이어 (Supabase)
   테이블: one_ticket_meta (jira_key PK, manual_rank int, comment text, updated_at, updated_by)

   - manual_rank: 사용자 입력 숫자 순위(작을수록 상위). 빈 값 허용(null).
   - comment: 단일 메모(덮어쓰기). 빈 값 허용.
   - 둘 다 비면 행 삭제(stale 정리).

   Sheets 판 대체 — export 시그니처 보존. (verifyOneMetaSchema/ensureOneMetaSheet 는
   호환용 stub: Supabase 는 테이블이 migration 으로 항상 존재)
   ========================================================= */

import { supabase, unwrap } from './supabase.js';

/** 호환용 — 컬럼 표기(과거 Sheets 헤더). 페이지 안내 문구에서 참조. 섹션 6 페이지 정리 시 제거 예정. */
export const ONE_META_HEADER = ['jira_key', 'manual_rank', 'comment', 'updated_at'];

export class SchemaMismatchError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'SchemaMismatchError';
    this.detail = detail;
  }
}

/** 연결 확인 (Sheets 헤더 검증 대체). 실패 시 throw. */
export async function verifyOneMetaSchema() {
  try {
    unwrap(await supabase.from('one_ticket_meta').select('jira_key').limit(1));
    return true;
  } catch (e) {
    throw new SchemaMismatchError('one_ticket_meta 연결 확인 실패: ' + (e.message || e), { cause: e });
  }
}

/** 호환용 no-op — Supabase 는 테이블이 항상 존재(migration). */
export async function ensureOneMetaSheet() {
  return true;
}

/* ─── read ────────────────────────────────────────────────── */

/**
 * 전체 행 read → 객체 배열.
 * @returns {Promise<Array<{jira_key, manual_rank, comment, updated_at}>>}
 */
export async function loadOneMeta() {
  return unwrap(await supabase.from('one_ticket_meta').select('*'));
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

/** 순위 정규화: 숫자/숫자문자열만 통과(int), 그 외/빈값은 null. */
function normRank(v) {
  if (v == null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * jira_key 행 upsert. patch 는 {manual_rank?, comment?} — 지정 필드만 덮어쓰고 나머지 보존.
 * 둘 다 비면 행 삭제.
 * @param {string} jiraKey
 * @param {{manual_rank?: string|number, comment?: string}} patch
 * @param {Array} [currentRows] loadOneMeta 결과 — 미지정 필드 보존용(없으면 patch 만 반영)
 * @returns {Promise<object|null>}
 */
export async function upsertOneMeta(jiraKey, patch = {}, currentRows = []) {
  if (!jiraKey) throw new Error('upsertOneMeta: jiraKey 필요');
  const existing = (currentRows || []).find(r => String(r.jira_key) === String(jiraKey));

  const manual_rank = ('manual_rank' in patch)
    ? normRank(patch.manual_rank)
    : (existing ? normRank(existing.manual_rank) : null);
  const commentRaw = ('comment' in patch)
    ? String(patch.comment ?? '')
    : (existing ? String(existing.comment ?? '') : '');
  // store 와 emptiness 판정을 동일 값(trim)으로 — "   " 가 저장됐다 다음 편집에서 오삭제되는 문제 차단.
  const comment = commentRaw.trim();

  const rankEmpty = manual_rank == null;
  const commentEmpty = comment === '';

  if (rankEmpty && commentEmpty) {
    unwrap(await supabase.from('one_ticket_meta').delete().eq('jira_key', jiraKey));
    return null;
  }

  const row = { jira_key: jiraKey, manual_rank, comment };
  return unwrap(await supabase.from('one_ticket_meta').upsert(row, { onConflict: 'jira_key' }).select().single());
}

/* ─── test export ─────────────────────────────────────────── */
export const _internal = { normRank };
