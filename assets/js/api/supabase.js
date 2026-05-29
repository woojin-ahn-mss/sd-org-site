/* =========================================================
   assets/js/api/supabase.js
   Supabase 클라이언트 래퍼 — sheets.js 를 대체하는 데이터 백엔드.
   백엔드 운영 0. github.io static page 에서 supabase-js(브라우저) 직접 사용.

   사용:
     import { supabase, auth, unwrap, subscribe, AuthRequiredError } from '../api/supabase.js';
     try {
       await auth.ensureSignedIn();                 // 세션 없으면 AuthRequiredError
       const rows = unwrap(await supabase.from('objectives').select('*'));
     } catch (e) {
       if (e instanceof AuthRequiredError) {
         // UI 에 "Google 로그인" 버튼 노출 → 클릭 시 auth.signIn()
       } else {
         // network / RLS / 일반 에러 토스트
       }
     }

   인증/권한 (PRD docs/supabase-migration §5):
     - Supabase Auth Google provider (musinsa.com Workspace SSO)
     - 접근 통제: RLS is_musinsa() — @musinsa.com 이메일만 행 접근
     - anon key 는 public (RLS 가 게이트). service_role 은 절대 코드/repo 금지.

   감사(audit):
     - updated_by/updated_at 는 DB 트리거(set_audit_fields)가 JWT 이메일로 자동 기록.
       클라이언트는 이 컬럼을 보내지 않는다.
   ========================================================= */

// 버전 고정 + target 고정(User-Agent 별 빌드 분기 차단). CDN 장애 대비 vendoring 은 PRD §11 R6.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2?target=es2022';

// Public values — anon key 는 RLS 로 보호되므로 public 노출 안전 (Google Client ID 와 동급).
export const SUPABASE_URL = 'https://ablqmnkxhyiejprgfsmf.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFibHFtbmt4aHlpZWpwcmdmc21mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMjIxNTYsImV4cCI6MjA5NTU5ODE1Nn0.sbrkSl4nrZNz4moyc5pqsCQxFMFlTAPEotGIVWKly4s';

const HOSTED_DOMAIN = 'musinsa.com';

/** 사용자 로그인이 필요한 경우 throw. UI 는 "Google 로그인" 버튼 노출. (sheets.js 와 동일 표면) */
export class AuthRequiredError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'AuthRequiredError';
    this.cause = cause;
  }
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,      // localStorage 에 세션 보관 (Supabase 자체 키)
    autoRefreshToken: true,    // 만료 직전 자동 갱신 (수동 renewal 불필요)
    detectSessionInUrl: true,  // OAuth redirect 복귀 시 URL 해시에서 세션 흡수
  },
});

/* ─── 세션 상태 캐시 (isSignedIn/email 동기 응답용) ──────────
   getSession() 은 async 이므로, init() 에서 1회 복원 + onAuthStateChange 로
   캐시를 갱신해 동기 getter 를 제공한다. ───────────────────── */
let currentSession = null;
let initPromise = null;
const changeListeners = new Set();

// module 최상단에서 먼저 등록 — INITIAL_SESSION / SIGNED_IN / SIGNED_OUT 이벤트로 캐시 갱신.
supabase.auth.onAuthStateChange((event, session) => {
  currentSession = session;
  // 초기 상태(INITIAL_SESSION)는 init()/getSession() 로 읽는다 — onChange 는 전이(로그인/로그아웃)만 통지.
  if (event === 'INITIAL_SESSION') return;
  for (const cb of changeListeners) {
    try { cb(session); } catch (e) { console.warn('[supabase.js] onChange 리스너 에러', e); }
  }
});

/**
 * 세션 1회 복원 (idempotent). 페이지 로드 시 호출.
 * getSession() 은 내부 initializePromise(= detectSessionInUrl 로 OAuth redirect 해시 흡수 포함)를
 * await 하므로, redirect 복귀 직후 호출해도 흡수된 세션을 정확히 반환한다.
 */
async function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const { data } = await supabase.auth.getSession();
    currentSession = data?.session || null;
    return currentSession;
  })();
  return initPromise;
}

// ─── 공개 auth API (sheets.js 와 호환되는 표면) ──────────────
export const auth = {
  /** 세션 복원 보장 후 현재 세션 반환 (없으면 null). */
  async init() {
    return init();
  },

  /**
   * 세션 보장. 없으면 AuthRequiredError throw → caller 가 "Google 로그인" 버튼 노출.
   * 페이지 진입 시 권장 패턴.
   * @returns {Promise<{email: string|null}>}
   */
  async ensureSignedIn() {
    await init();
    if (!auth.isSignedIn()) {
      throw new AuthRequiredError('로그인이 필요합니다.');
    }
    return { email: auth.email() };
  },

  /**
   * Google 로그인.
   *
   * - `signIn({ silent: true })` — **리다이렉트 없음.** 세션 복원만 시도(init).
   *   기존 세션이 있으면 통과, 없으면 그대로 반환(throw 안 함). 페이지 bootstrap 에서
   *   "조용히 로그인 시도" 용도. (sheets.js 의 silent 토큰 요청을 대체)
   * - `signIn()` — **사용자 클릭 핸들러 전용.** Google 로 페이지 리다이렉트 후
   *   복귀(detectSessionInUrl) 시 세션 흡수. user gesture 없이 호출 금지.
   *
   * @param {{silent?: boolean, redirectTo?: string}} [opts]
   */
  async signIn(opts = {}) {
    if (opts.silent) {
      await init();
      return;
    }
    // OAuth 허용 redirect 목록과 매칭되도록 query/hash 제거한 정규 URL 사용.
    const canonical = opts.redirectTo
      || (window.location.origin + window.location.pathname);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: canonical,
        queryParams: { hd: HOSTED_DOMAIN, prompt: 'select_account' },
      },
    });
    if (error) throw new Error(`Google 로그인 실패: ${error.message}`);
  },

  /** 로그아웃. 세션 폐기. (SIGNED_OUT 이벤트도 캐시를 비우지만, await 직후 동기 getter 정확성을 위해 즉시 클리어) */
  async signOut() {
    await supabase.auth.signOut();
    currentSession = null;
  },

  /** 현재 로그인 여부 (동기 — init() 이후 정확). */
  isSignedIn() {
    return !!currentSession?.user;
  },

  /** 현재 사용자 이메일 (없으면 null). */
  email() {
    return currentSession?.user?.email || null;
  },

  /**
   * 인증 상태 변경 구독. 로그인/로그아웃 시 페이지 재렌더용.
   * ⚠ **전이(transition)에만** 발화한다. 초기 상태는 `await auth.init()` 후 `isSignedIn()` 로 직접 읽을 것.
   * @param {(session: object|null) => void} cb
   * @returns {() => void} 구독 해제 함수
   */
  onChange(cb) {
    changeListeners.add(cb);
    return () => changeListeners.delete(cb);
  },
};

// ─── 쿼리 결과 처리 ─────────────────────────────────────────

/**
 * supabase-js 응답 `{data, error}` 를 풀어 data 반환, error 면 throw.
 * 데이터 레이어가 throw 기반 흐름(try/catch)을 쓰도록 통일.
 * @template T
 * @param {{data: T, error: any}} res
 * @returns {T}
 */
export function unwrap(res) {
  if (!res) throw new Error('빈 응답');
  if (res.error) {
    const e = res.error;
    // JWT 만료/무효 → AuthRequiredError 로 매핑해 caller 의 재로그인 UI 분기를 태운다.
    const code = String(e.code || '');
    const msg = String(e.message || '');
    if (e.status === 401 || code === 'PGRST301' || /jwt|token/i.test(msg)) {
      throw new AuthRequiredError(msg || '인증이 만료되었습니다.', e);
    }
    const err = new Error(msg || 'Supabase 오류');
    err.code = e.code;
    err.details = e.details;
    err.hint = e.hint;
    err.status = e.status;
    throw err;
  }
  return res.data;
}

// ─── Realtime ───────────────────────────────────────────────

/**
 * 여러 테이블의 변경을 한 채널로 구독. 변경 수신 시 onChange(payload) 호출.
 * 페이지 이탈 시 반드시 반환된 함수로 해제(누수/quota 방지).
 *
 * @param {string} channelName 고유 채널 이름 (페이지별)
 * @param {string[]} tables 구독할 public 테이블 이름들
 * @param {(payload: object) => void} onChange
 * @returns {{ channel: object, unsubscribe: () => void }}
 */
export function subscribe(channelName, tables, onChange, opts = {}) {
  // 같은 이름 채널이 이미 있으면 먼저 제거 — 재진입 시 중복 구독(누수·중복 발화) 차단.
  for (const ch of supabase.getChannels()) {
    if (ch.topic === `realtime:${channelName}`) supabase.removeChannel(ch);
  }
  let channel = supabase.channel(channelName);
  for (const table of tables) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      onChange,
    );
  }
  channel.subscribe((status, err) => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.warn(`[supabase.js] realtime "${channelName}" 상태: ${status}`, err || '');
    }
    if (typeof opts.onStatus === 'function') opts.onStatus(status, err);
  });
  return {
    channel,
    /** 채널 해제. teardown 을 await 하려면 반환 promise 사용. */
    unsubscribe: () => supabase.removeChannel(channel),
  };
}

/** 현재 시각 ISO 8601 (created_at 등 클라이언트 기록이 필요한 드문 경우용). */
export function nowIso() {
  return new Date().toISOString();
}
