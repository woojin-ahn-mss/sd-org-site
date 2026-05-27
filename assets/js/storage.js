/* =========================================================
   storage.js — localStorage wrapper
   - 네임스페이스 "sd.*" prefix
   - JSON 직렬화/역직렬화 자동
   - 저장 실패(quota/disabled) 시 silent fail (메모리 fallback)

   ⚠ 데이터(다른 사람과 공유돼야 하는 콘텐츠) 저장 금지.
   localStorage 는 본인 브라우저 한정의 UI state 만 (필터·컬럼·dismiss 등).
   협업·SoT 데이터는 Google Sheet (`assets/js/api/sheets.js`) 를 사용.
   참고: docs/sd-org-site/PRD.md §10, docs/plan/PRD.md §7.
   ========================================================= */

const PREFIX = 'sd.';
const memFallback = new Map();

function key(k) { return PREFIX + k; }

/** 값 읽기 (없으면 fallback) */
export function get(k, fallback = null) {
  const full = key(k);
  try {
    const raw = localStorage.getItem(full);
    if (raw == null) {
      return memFallback.has(full) ? memFallback.get(full) : fallback;
    }
    return JSON.parse(raw);
  } catch (_) {
    return memFallback.has(full) ? memFallback.get(full) : fallback;
  }
}

/** 값 저장. 성공하면 true, localStorage 실패(quota/disabled)로 메모리에만 들어가면 false. */
export function set(k, value) {
  const full = key(k);
  let ok = true;
  try {
    localStorage.setItem(full, JSON.stringify(value));
  } catch (_) {
    memFallback.set(full, value);
    ok = false;
  }
  document.dispatchEvent(new CustomEvent('sd:storage-change', { detail: { key: k, value, persisted: ok } }));
  return ok;
}

/** 키 제거 */
export function remove(k) {
  const full = key(k);
  try { localStorage.removeItem(full); } catch (_) {}
  memFallback.delete(full);
}

/**
 * 한 객체 안의 일부 필드만 patch 저장.
 * 필터 / 컬럼 토글 상태 같은 부분 업데이트에 편리.
 */
export function patch(k, partial) {
  const cur = get(k, {}) || {};
  set(k, { ...cur, ...partial });
}

/**
 * 페이지별 키 (page → state) 헬퍼.
 *   const filters = scoped('roadmap.filters');
 *   filters.get(); filters.set({...});
 *  set 은 boolean 을 반환 (true = LS 저장 성공, false = 메모리 fallback)
 */
export function scoped(k) {
  return {
    get: (fb = null) => get(k, fb),
    set: v => set(k, v),
    patch: p => patch(k, p),
    remove: () => remove(k),
  };
}
