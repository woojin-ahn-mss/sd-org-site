/* =========================================================
   assets/js/api/sheets.js
   Google Sheets API v4 wrapper — 사용자 본인 OAuth (GIS token client).
   백엔드 없음. github.io static page 에서 직접 Sheets API 호출.

   사용:
     import { auth, sheets, SPREADSHEET_ID, AuthRequiredError } from '../api/sheets.js';
     try {
       await auth.ensureSignedIn();           // silent → 실패 시 popup
       const data = await sheets.read(SPREADSHEET_ID, 'plan!A1:Z1000');
     } catch (e) {
       if (e instanceof AuthRequiredError) {
         // UI 에 "Google 로그인" 버튼 노출
       } else {
         // network / sheets 일반 에러 처리
       }
     }

   인증/권한:
     - OAuth Consent Screen User Type: Internal (musinsa.com 도메인 한정)
     - Scope: spreadsheets (read+write)
     - Sheet 권한: musinsa.com 도메인 편집자 share

   write 정책:
     - 기본 valueInputOption='RAW' — Sheets 자동 캐스팅 차단.
       plan!H:I (plan_start, plan_end) 는 텍스트 포맷(@) 이라 RAW 필수.
       수식·자동 파싱 필요 시 opts.valueInputOption='USER_ENTERED' 명시.
   ========================================================= */

// Public values — client id 는 origin 화이트리스트로 보호됨 (secret 아님).
export const GOOGLE_CLIENT_ID =
  '1076041857313-vjqj185s2sp6r18je6uql6f936vqcu53.apps.googleusercontent.com';
export const SPREADSHEET_ID = '1lRm-xfEzuXJVxQcFOM-u-22uaCj_PMkKQDtX-G-QSSM';
export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const AUTH_INTERACTION_ERRORS = new Set([
  'interaction_required',
  'consent_required',
  'login_required',
  'popup_closed_by_user',
  'access_denied',
]);

/** 사용자 동의/로그인이 필요한 경우 throw. UI 는 "Google 로그인" 버튼 노출. */
export class AuthRequiredError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'AuthRequiredError';
    this.cause = cause;
  }
}

// ─── GIS 로딩 ──────────────────────────────────────────────────────────
let gisLoadingPromise = null;
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoadingPromise) return gisLoadingPromise;
  gisLoadingPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisLoadingPromise = null;
      reject(new Error('Failed to load Google Identity Services script'));
    };
    document.head.appendChild(s);
  });
  return gisLoadingPromise;
}

// ─── Token 관리 ────────────────────────────────────────────────────────
const tokenState = {
  accessToken: null,
  expiresAt: 0,            // epoch ms
  email: null,
  tokenClient: null,
  abort: new AbortController(),  // in-flight fetch 들에 부착, signOut 시 abort
};

let inflightTokenPromise = null;  // 동시 호출 단일화

async function fetchUserEmail(accessToken) {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) {
      console.warn('[sheets.js] userinfo 실패', r.status);
      return null;
    }
    const j = await r.json();
    return j.email || null;
  } catch (e) {
    console.warn('[sheets.js] userinfo 예외', e);
    return null;
  }
}

async function ensureTokenClient() {
  if (tokenState.tokenClient) return tokenState.tokenClient;
  await loadGis();
  try {
    tokenState.tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SHEETS_SCOPE,
      callback: () => {},  // per-call 에서 overwrite (단일 flight 보장 — 동시 호출 단일화로 race 차단)
    });
  } catch (e) {
    tokenState.tokenClient = null;  // 다음 시도에서 재초기화 가능하게
    throw e;
  }
  return tokenState.tokenClient;
}

/**
 * 새 token 발급. 동시 호출은 단일 promise 로 묶어 callback race 방지.
 * prompt:
 *   ''               — silent (이미 동의한 사용자는 popup 없이 통과)
 *   'consent'        — 매번 동의 화면 강제
 *   'select_account' — 계정 선택 화면
 */
function requestToken({ prompt = '' } = {}) {
  if (inflightTokenPromise) return inflightTokenPromise;
  inflightTokenPromise = (async () => {
    try {
      const client = await ensureTokenClient();
      return await new Promise((resolve, reject) => {
        client.callback = async (resp) => {
          if (resp.error) {
            const code = resp.error;
            const msg = `OAuth error: ${code} ${resp.error_description || ''}`.trim();
            if (AUTH_INTERACTION_ERRORS.has(code)) {
              reject(new AuthRequiredError(msg, resp));
            } else {
              reject(new Error(msg));
            }
            return;
          }
          tokenState.accessToken = resp.access_token;
          const expiresInSec = Math.max(60, (resp.expires_in || 3600) - 60);
          tokenState.expiresAt = Date.now() + expiresInSec * 1000;
          tokenState.email = await fetchUserEmail(resp.access_token);
          resolve({ accessToken: resp.access_token, email: tokenState.email });
        };
        try {
          client.requestAccessToken({ prompt });
        } catch (e) {
          reject(e);
        }
      });
    } finally {
      inflightTokenPromise = null;
    }
  })();
  return inflightTokenPromise;
}

async function getValidToken() {
  if (tokenState.accessToken && Date.now() < tokenState.expiresAt) {
    return tokenState.accessToken;
  }
  const { accessToken } = await requestToken({ prompt: '' });
  return accessToken;
}

// ─── 공개 auth API ─────────────────────────────────────────────────────
export const auth = {
  /**
   * 로그인. 사용자 클릭 핸들러에서 호출.
   * @param {{silent?: boolean}} [opts] silent=true → popup 없이 silent 시도
   * @returns {Promise<{accessToken: string, email: string|null}>}
   */
  async signIn(opts = {}) {
    return requestToken({ prompt: opts.silent ? '' : 'select_account' });
  },
  /**
   * silent 먼저 시도하고 실패 시 popup 으로 fallback — 페이지 진입 시 권장 패턴.
   * AuthRequiredError 가 throw 되면 caller 가 "로그인" 버튼 UI 노출.
   */
  async ensureSignedIn() {
    if (auth.isSignedIn()) return { accessToken: tokenState.accessToken, email: tokenState.email };
    try {
      return await requestToken({ prompt: '' });
    } catch (e) {
      if (e instanceof AuthRequiredError) {
        return await requestToken({ prompt: 'select_account' });
      }
      throw e;
    }
  },
  /** 토큰 폐기 + 진행 중 fetch 모두 abort. 다음 호출 시 다시 로그인. */
  signOut() {
    const oldToken = tokenState.accessToken;
    tokenState.accessToken = null;
    tokenState.expiresAt = 0;
    tokenState.email = null;
    // in-flight 들 즉시 중단
    tokenState.abort.abort();
    tokenState.abort = new AbortController();
    if (oldToken && window.google?.accounts?.oauth2?.revoke) {
      window.google.accounts.oauth2.revoke(oldToken, () => {});
    }
  },
  isSignedIn() {
    return !!tokenState.accessToken && Date.now() < tokenState.expiresAt;
  },
  email() {
    return tokenState.email;
  },
  /** 현재 access token (만료 시 null). 디버깅·외부 API 직접 호출용. */
  accessToken() {
    return auth.isSignedIn() ? tokenState.accessToken : null;
  },
};

// ─── Sheets API 호출 ───────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function apiFetch(pathAndQuery, opts = {}, { retryAuth = true, retry429 = true } = {}) {
  const token = await getValidToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${pathAndQuery}`;
  const r = await fetch(url, {
    ...opts,
    signal: tokenState.abort.signal,
    headers: {
      ...(opts.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });

  // 401: 토큰 stale — 무효화 후 silent 재발급. 두 번째 401 은 AuthRequiredError 로 surface.
  if (r.status === 401 && retryAuth) {
    tokenState.accessToken = null;
    tokenState.expiresAt = 0;
    try {
      await requestToken({ prompt: '' });
    } catch (e) {
      if (e instanceof AuthRequiredError) throw e;
      throw new AuthRequiredError('토큰 재발급 실패', e);
    }
    return apiFetch(pathAndQuery, opts, { retryAuth: false, retry429 });
  }

  // 429: Retry-After 존중하여 1회 재시도.
  if (r.status === 429 && retry429) {
    const ra = parseFloat(r.headers.get('Retry-After') || '1');
    await sleep(Math.max(500, ra * 1000));
    return apiFetch(pathAndQuery, opts, { retryAuth, retry429: false });
  }

  if (!r.ok) {
    let errBody;
    try { errBody = await r.json(); } catch (_) { errBody = await r.text(); }
    const summary = (errBody && typeof errBody === 'object' && errBody.error && errBody.error.message)
      ? errBody.error.message
      : (typeof errBody === 'string' ? errBody.slice(0, 200) : '');
    const e = new Error(`Sheets API ${r.status}: ${summary}`);
    e.status = r.status;
    e.body = errBody;
    throw e;
  }
  return r.json();
}

function encodeRange(range) {
  // 시트 이름에 공백/한글/특수문자 포함 가능 — 통째 encodeURIComponent.
  // 시트 이름에 작은따옴표(') 가 들어가는 경우는 caller 가 시트 API 규칙에 따라
  // 'It''s' 형태로 quote escape 후 넘긴다 (현 사이트는 해당 사례 없음).
  return encodeURIComponent(range);
}

export const sheets = {
  /** 범위 read. 예: read(id, 'plan!A1:Z1000') */
  async read(spreadsheetId, range, opts = {}) {
    const params = new URLSearchParams();
    if (opts.majorDimension) params.set('majorDimension', opts.majorDimension);
    if (opts.valueRenderOption) params.set('valueRenderOption', opts.valueRenderOption);
    const qs = params.toString();
    return apiFetch(
      `${spreadsheetId}/values/${encodeRange(range)}${qs ? '?' + qs : ''}`
    );
  },

  /**
   * 행 append. values 는 [[c1,c2,...], ...]. 예: append(id, 'plan!A1', [['TEST-1','우진']])
   * 기본 RAW — Sheets 자동 캐스팅(예: "2026-05-27" → date serial) 차단.
   */
  async append(spreadsheetId, range, values, opts = {}) {
    const params = new URLSearchParams({
      valueInputOption: opts.valueInputOption || 'RAW',
      insertDataOption: opts.insertDataOption || 'INSERT_ROWS',
    });
    return apiFetch(
      `${spreadsheetId}/values/${encodeRange(range)}:append?${params.toString()}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      }
    );
  },

  /** 범위 update (덮어쓰기). 기본 RAW. */
  async update(spreadsheetId, range, values, opts = {}) {
    const params = new URLSearchParams({
      valueInputOption: opts.valueInputOption || 'RAW',
    });
    return apiFetch(
      `${spreadsheetId}/values/${encodeRange(range)}?${params.toString()}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ range, values }),
      }
    );
  },

  /** 여러 범위 한 번에 update. data: [{range, values}, ...]. 기본 RAW. */
  async batchUpdate(spreadsheetId, data, opts = {}) {
    return apiFetch(`${spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valueInputOption: opts.valueInputOption || 'RAW',
        data,
      }),
    });
  },

  /** 스프레드시트 메타 (시트 목록, 헤더 등). */
  async meta(spreadsheetId, opts = {}) {
    const params = new URLSearchParams();
    if (opts.fields) params.set('fields', opts.fields);
    const qs = params.toString();
    return apiFetch(`${spreadsheetId}${qs ? '?' + qs : ''}`);
  },

  /**
   * 새 시트(탭) 추가. spreadsheets:batchUpdate addSheet 요청.
   * @returns {Promise<object>} 응답에서 replies[0].addSheet.properties.sheetId 등 확인 가능
   */
  async addSheet(spreadsheetId, title) {
    return apiFetch(`${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title } } }],
      }),
    });
  },
};

// ─── 헬퍼 (Sheets API 호출과 무관, pure util) ─────────────────────────
// 타입 보존 규칙:
//   - read 응답에서 trailing empty 셀은 undefined → '' 로 normalize (rowsToObjects)
//   - write 시 객체 필드가 undefined 면 '' 로 채움 (objectToRow). 명시적 ''/null 도 동일.
//   - number/boolean 은 String() 으로 강제 변환하지 않고 그대로 전달 — Sheets v4 JSON 이 처리.
//   → 따라서 plan 처럼 모든 컬럼이 문자열이면 안전, 미래에 숫자 컬럼이 생겨도 round-trip 보존.

function serializeCell(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v;
  // 객체/배열은 셀에 들어갈 수 없음 — 명백한 버그라 throw 로 빨리 노출.
  throw new TypeError(`objectToRow: 셀 값은 string/number/boolean 만 가능. got ${typeof v}`);
}

/**
 * Sheets row 배열 (2D) 을 헤더 기반 객체 배열로 변환.
 * rows: [['TEST-1','우진'], ['TEST-2','다른']]
 * header: ['jira_key','pm']
 * → [{jira_key:'TEST-1', pm:'우진'}, {jira_key:'TEST-2', pm:'다른'}]
 *
 * 빈 셀(trailing 포함) 은 빈 문자열로 normalize.
 */
export function rowsToObjects(rows, header) {
  if (!Array.isArray(rows) || !Array.isArray(header)) return [];
  return rows.map((row) => {
    const obj = {};
    for (let i = 0; i < header.length; i++) {
      const v = row ? row[i] : undefined;
      obj[header[i]] = v == null ? '' : v;
    }
    return obj;
  });
}

/**
 * 객체를 헤더 순서대로 cell 배열로 변환.
 * 누락 필드는 '' 로 채움. number/boolean 은 타입 보존 (Sheets API JSON 이 그대로 직렬화).
 * 객체/배열 값은 TypeError throw (셀에 들어갈 수 없는 값을 빨리 잡음).
 */
export function objectToRow(obj, header) {
  if (!obj || !Array.isArray(header)) return [];
  return header.map((col) => serializeCell(obj[col]));
}

/**
 * rows 에서 keyField 컬럼의 값이 keyValue 와 일치하는 첫 행의 인덱스 반환 (없으면 -1).
 * 비교는 String 강제 변환 후 === (Sheets 가 텍스트 포맷 셀을 string 으로, 일반 셀을 number 로 돌려줄 수 있음).
 */
export function findRowByKey(rows, header, keyField, keyValue) {
  if (!Array.isArray(rows) || !Array.isArray(header)) return -1;
  const keyIdx = header.indexOf(keyField);
  if (keyIdx < 0) return -1;
  const target = keyValue == null ? '' : String(keyValue);
  for (let i = 0; i < rows.length; i++) {
    const cell = rows[i] && rows[i][keyIdx];
    if ((cell == null ? '' : String(cell)) === target) return i;
  }
  return -1;
}

/** 현재 시각 ISO 8601 문자열. last_updated_at 자동 기록용. */
export function nowIso() {
  return new Date().toISOString();
}
