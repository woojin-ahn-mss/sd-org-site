/* =========================================================
   assets/js/api/sheets.js
   Google Sheets API v4 wrapper — 사용자 본인 OAuth (GIS token client).
   백엔드 없음. github.io static page 에서 직접 Sheets API 호출.

   사용:
     import { auth, sheets, SPREADSHEET_ID } from '../api/sheets.js';
     await auth.signIn();              // 첫 클릭에서 popup → token 발급
     const data = await sheets.read(SPREADSHEET_ID, 'plan!A1:Z1000');

   인증/권한:
     - OAuth Consent Screen User Type: Internal (musinsa.com 도메인 한정)
     - Scope: spreadsheets (read+write)
     - Sheet 권한: musinsa.com 도메인 편집자 share
   ========================================================= */

// Public values — client id 는 origin 화이트리스트로 보호됨 (secret 아님).
export const GOOGLE_CLIENT_ID =
  '1076041857313-vjqj185s2sp6r18je6uql6f936vqcu53.apps.googleusercontent.com';
export const SPREADSHEET_ID = '1lRm-xfEzuXJVxQcFOM-u-22uaCj_PMkKQDtX-G-QSSM';
export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

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
    s.onerror = () => reject(new Error('Failed to load Google Identity Services script'));
    document.head.appendChild(s);
  });
  return gisLoadingPromise;
}

// ─── Token 관리 ────────────────────────────────────────────────────────
const tokenState = {
  accessToken: null,
  expiresAt: 0,        // epoch ms
  email: null,         // id_token decode 또는 별도 userinfo 호출에서 채움
  tokenClient: null,
};

function decodeJwtPayload(jwt) {
  try {
    const part = jwt.split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch (_) {
    return null;
  }
}

async function fetchUserEmail(accessToken) {
  // Token 만 가지고 식별 정보는 userinfo endpoint 로 한 번 받음 (openid scope 안 받았어도 access token 으로 가능).
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.email || null;
  } catch (_) {
    return null;
  }
}

async function ensureTokenClient() {
  if (tokenState.tokenClient) return tokenState.tokenClient;
  await loadGis();
  tokenState.tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SHEETS_SCOPE,
    callback: () => {},  // per-call 에서 overwrite
  });
  return tokenState.tokenClient;
}

/**
 * 새 token 발급. prompt:
 *   ''         — silent (이미 동의한 사용자는 popup 없이 통과)
 *   'consent'  — 매번 동의 화면 강제
 *   'select_account' — 계정 선택 화면
 */
function requestToken({ prompt = '' } = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      const client = await ensureTokenClient();
      client.callback = async (resp) => {
        if (resp.error) {
          reject(new Error(`OAuth error: ${resp.error} ${resp.error_description || ''}`));
          return;
        }
        tokenState.accessToken = resp.access_token;
        // GIS token client 의 expires_in 은 보통 3600 초.
        tokenState.expiresAt = Date.now() + ((resp.expires_in || 3600) - 60) * 1000;
        tokenState.email = await fetchUserEmail(resp.access_token);
        resolve({ accessToken: resp.access_token, email: tokenState.email });
      };
      client.requestAccessToken({ prompt });
    } catch (e) {
      reject(e);
    }
  });
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
  /** 명시적 로그인. 사용자 클릭 핸들러에서 호출. */
  async signIn() {
    return requestToken({ prompt: 'select_account' });
  },
  /** 토큰 폐기. 다음 호출 시 다시 로그인. */
  signOut() {
    if (tokenState.accessToken && window.google?.accounts?.oauth2?.revoke) {
      window.google.accounts.oauth2.revoke(tokenState.accessToken, () => {});
    }
    tokenState.accessToken = null;
    tokenState.expiresAt = 0;
    tokenState.email = null;
  },
  isSignedIn() {
    return !!tokenState.accessToken && Date.now() < tokenState.expiresAt;
  },
  email() {
    return tokenState.email;
  },
};

// ─── Sheets API 호출 ───────────────────────────────────────────────────
async function apiFetch(pathAndQuery, opts = {}) {
  const token = await getValidToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${pathAndQuery}`;
  const r = await fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (!r.ok) {
    let errBody;
    try { errBody = await r.json(); } catch (_) { errBody = await r.text(); }
    const e = new Error(`Sheets API ${r.status}: ${typeof errBody === 'string' ? errBody : JSON.stringify(errBody)}`);
    e.status = r.status;
    e.body = errBody;
    throw e;
  }
  return r.json();
}

function encodeRange(range) {
  // 시트 이름에 특수문자/공백/한글 포함 가능 → 통째 encodeURIComponent.
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

  /** 행 append. values 는 [[c1,c2,...], ...]. 예: append(id, 'plan!A1', [['TEST-1','우진']]) */
  async append(spreadsheetId, range, values, opts = {}) {
    const params = new URLSearchParams({
      valueInputOption: opts.valueInputOption || 'USER_ENTERED',
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

  /** 범위 update (덮어쓰기). */
  async update(spreadsheetId, range, values, opts = {}) {
    const params = new URLSearchParams({
      valueInputOption: opts.valueInputOption || 'USER_ENTERED',
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

  /** 여러 범위 한 번에 update. data: [{range, values}, ...] */
  async batchUpdate(spreadsheetId, data, opts = {}) {
    return apiFetch(`${spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valueInputOption: opts.valueInputOption || 'USER_ENTERED',
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
};
