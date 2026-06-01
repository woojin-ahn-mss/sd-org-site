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
export const ONE_META_HEADER = ['jira_key', 'manual_rank', 'comment', 'summary_override', 'quick_fix', 'spec', 'updated_at'];

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

/** 편집 메타가 모두 비었는지 (모두 비면 행 삭제 대상). 순수 — 테스트 대상. */
export function metaIsEmpty({ manual_rank, comment, summary_override, quick_fix, spec, hidden, image_path, content, content_image_path } = {}) {
  return manual_rank == null
    && (comment == null || String(comment).trim() === '')
    && (summary_override == null || String(summary_override).trim() === '')
    && (image_path == null || String(image_path).trim() === '')
    && (content == null || String(content).trim() === '')
    && (content_image_path == null || String(content_image_path).trim() === '')
    && !quick_fix && !spec && !hidden;
}

const IMG_BUCKET = 'one-ticket-images';

/**
 * 이미지 URL(만료 가능)을 받아 Storage 로 복사하고 object path 반환.
 * 브라우저에서 fetch → blob → upload (Atlassian CDN 은 CORS 허용).
 */
const IMG_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/** blob/File 을 Storage 에 업로드하고 object path 반환. (드래그앤드랍·붙여넣기·URL 공통 코어) */
export async function uploadTicketImageBlob(jiraKey, blob) {
  const ext = IMG_EXT[blob.type];
  if (!ext) throw new Error(`지원하지 않는 형식입니다 (${blob.type || 'unknown'}) — png/jpg/gif/webp 만 가능`);
  const rand = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
  const path = `${String(jiraKey).replace(/[^A-Za-z0-9_-]/g, '_')}/${rand}.${ext}`;
  const up = await supabase.storage.from(IMG_BUCKET).upload(path, blob, { contentType: blob.type, upsert: false });
  if (up.error) throw new Error(`업로드 실패: ${up.error.message}`);
  return up.data.path;
}

/** 이미지 URL(만료 가능)을 받아 fetch → Storage 복사 → object path 반환. */
export async function uploadTicketImage(jiraKey, srcUrl) {
  // 행이 멈추지 않게 20초 타임아웃 (CORS/응답 지연 대비).
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let blob;
  try {
    const res = await fetch(srcUrl, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`이미지 fetch 실패: HTTP ${res.status}`);
    blob = await res.blob();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? '이미지 요청 시간 초과(20초)' : (`이미지 가져오기 실패: ${e.message || e}`));
  } finally { clearTimeout(timer); }
  return uploadTicketImageBlob(jiraKey, blob);
}

/** object path → 서명 URL (기본 1시간). 실패 시 null. */
export async function signedImageUrl(path, expiresIn = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(IMG_BUCKET).createSignedUrl(path, expiresIn);
  if (error) { console.warn('[one-ticket-meta] signed url 실패', error); return null; }
  return data.signedUrl;
}

/** Storage 에서 이미지 삭제 (실패해도 throw 안 함 — best effort). */
export async function removeTicketImage(path) {
  if (!path) return;
  try { await supabase.storage.from(IMG_BUCKET).remove([path]); }
  catch (e) { console.warn('[one-ticket-meta] 이미지 삭제 실패', e); }
}

/** 순위 정규화: 숫자/숫자문자열만 통과(int), 그 외/빈값은 null. */
function normRank(v) {
  if (v == null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * jira_key 행 upsert. patch 는 {manual_rank?, comment?, summary_override?, quick_fix?, spec?} —
 * 지정 필드만 덮어쓰고 나머지 보존. 모든 편집 필드가 비면 행 삭제.
 * @param {string} jiraKey
 * @param {{manual_rank?: string|number, comment?: string, summary_override?: string, quick_fix?: boolean, spec?: boolean}} patch
 * @param {Array} [currentRows] loadOneMeta 결과 — 미지정 필드 보존용(없으면 patch 만 반영)
 * @returns {Promise<object|null>}
 */
export async function upsertOneMeta(jiraKey, patch = {}, currentRows = []) {
  if (!jiraKey) throw new Error('upsertOneMeta: jiraKey 필요');
  const existing = (currentRows || []).find(r => String(r.jira_key) === String(jiraKey));

  const manual_rank = ('manual_rank' in patch)
    ? normRank(patch.manual_rank)
    : (existing ? normRank(existing.manual_rank) : null);
  // 코멘트는 멀티라인(textarea) — 의도된 줄바꿈 보존. 빈 값(공백뿐)만 ''로 정규화.
  const commentRaw = ('comment' in patch)
    ? String(patch.comment ?? '')
    : (existing ? String(existing.comment ?? '') : '');
  const comment = commentRaw.trim() === '' ? '' : commentRaw;
  const summary_override = (('summary_override' in patch)
    ? String(patch.summary_override ?? '')
    : (existing ? String(existing.summary_override ?? '') : '')).trim();
  const quick_fix = ('quick_fix' in patch)
    ? !!patch.quick_fix
    : (existing ? !!existing.quick_fix : false);
  const spec = ('spec' in patch)
    ? !!patch.spec
    : (existing ? !!existing.spec : false);
  const hidden = ('hidden' in patch)
    ? !!patch.hidden
    : (existing ? !!existing.hidden : false);
  const image_path = (('image_path' in patch)
    ? String(patch.image_path ?? '')
    : (existing ? String(existing.image_path ?? '') : '')).trim();
  // 내용도 멀티라인 — 의도된 줄바꿈 보존. 빈 값(공백뿐)만 ''로.
  const contentRaw = ('content' in patch)
    ? String(patch.content ?? '')
    : (existing ? String(existing.content ?? '') : '');
  const content = contentRaw.trim() === '' ? '' : contentRaw;
  const content_image_path = (('content_image_path' in patch)
    ? String(patch.content_image_path ?? '')
    : (existing ? String(existing.content_image_path ?? '') : '')).trim();

  const summaryEmpty = summary_override === '';
  const imageEmpty = image_path === '';
  const contentImageEmpty = content_image_path === '';

  // 편집 필드가 모두 비면 행 삭제(stale 정리).
  if (metaIsEmpty({ manual_rank, comment, summary_override, quick_fix, spec, hidden, image_path, content, content_image_path })) {
    unwrap(await supabase.from('one_ticket_meta').delete().eq('jira_key', jiraKey));
    return null;
  }

  const row = {
    jira_key: jiraKey,
    manual_rank,
    comment,
    summary_override: summaryEmpty ? null : summary_override,
    quick_fix,
    spec,
    hidden,
    image_path: imageEmpty ? null : image_path,
    content: content === '' ? null : content,
    content_image_path: contentImageEmpty ? null : content_image_path,
  };
  return unwrap(await supabase.from('one_ticket_meta').upsert(row, { onConflict: 'jira_key' }).select().single());
}

/* ─── test export ─────────────────────────────────────────── */
export const _internal = { normRank, metaIsEmpty };
