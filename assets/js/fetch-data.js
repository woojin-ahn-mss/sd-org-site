/* =========================================================
   fetch-data.js — JSON 데이터 로더
   - 경로는 사이트 root 기준 (e.g. "data/jira/initiatives.json")
   - 로딩/에러/빈 상태는 states.js 의 헬퍼 재사용
   ========================================================= */

import { loadingHtml, emptyHtml, errorHtml } from './states.js';

/**
 * JSON 가져오기.
 * @param {string} url
 * @param {{ bustCache?: boolean, signal?: AbortSignal }} opts
 * @returns {Promise<any>}
 */
export async function loadJson(url, opts = {}) {
  const finalUrl = opts.bustCache ? `${url}?t=${Date.now()}` : url;
  const res = await fetch(finalUrl, { signal: opts.signal, cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.json();
}

/**
 * 여러 JSON 을 병렬로 로드.
 * 하나라도 실패하면 throw (전체 페이지 에러 상태로 처리).
 * @param {Record<string, string>} map { key: url, ... }
 */
export async function loadJsonMap(map, opts = {}) {
  const keys = Object.keys(map);
  const vals = await Promise.all(keys.map(k => loadJson(map[k], opts)));
  return Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
}

/**
 * 데이터 페치 + 컨테이너에 로딩/에러/빈 상태 자동 렌더링.
 * @param {{
 *   container: HTMLElement,
 *   url: string | Record<string,string>,
 *   render: (data: any) => void | Promise<void>,
 *   isEmpty?: (data: any) => boolean,
 *   loadingHtml?: string,
 *   bustCache?: boolean
 * }} cfg
 */
export async function fetchAndRender(cfg) {
  const { container, url, render, isEmpty, loadingHtml: customLoading, bustCache } = cfg;
  container.innerHTML = customLoading || loadingHtml();
  try {
    const data = typeof url === 'string'
      ? await loadJson(url, { bustCache })
      : await loadJsonMap(url, { bustCache });
    if (isEmpty && isEmpty(data)) {
      container.innerHTML = emptyHtml();
      return;
    }
    container.innerHTML = '';
    await render(data);
  } catch (err) {
    console.error('[fetchAndRender]', err);
    container.innerHTML = errorHtml(err);
  }
}
