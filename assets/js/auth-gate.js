/* =========================================================
   auth-gate.js — 전역 로그인 게이트
   모든 페이지가 renderSidebar(nav.js) 를 호출하므로, 거기서 ensureAuthGate() 를 부른다.
   - 미로그인: 전체화면 로그인 오버레이(디자인 시스템)를 띄워 페이지 전체를 가린다.
   - 로그인(또는 기존 세션): 오버레이 제거 → 모든 페이지 접근.
   - 로그인은 Supabase Google OAuth redirect. 복귀 후 세션 있으면 게이트 자동으로 안 뜸.
   - 사이드바 footer 슬롯([data-auth-slot])에 로그인 이메일 + 로그아웃 노출.

   접근 통제는 RLS(is_musinsa) 가 최종 — 이 게이트는 UX(데이터 못 보는 빈 화면 방지)용.
   ========================================================= */

import { auth } from './api/supabase.js';
import { escapeHtml } from './escape.js';

let overlay = null;
let signingIn = false;
let started = false;

function buildOverlay() {
  const el = document.createElement('div');
  el.id = 'auth-gate';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', '로그인');
  // 레이아웃만 인라인(코드베이스 관행), 색/폰트/컴포넌트는 디자인 토큰·클래스.
  el.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:var(--bg);padding:24px;';
  el.innerHTML = `
    <div class="poc-card" style="max-width:420px;width:100%;text-align:center;padding:40px 32px;background:var(--bg-elev);border:1px solid var(--rule);border-radius:var(--radius);">
      <p class="page-kicker">S&amp;D CONSOLE</p>
      <h1 class="page-title" style="margin:6px 0 14px;">로그인</h1>
      <p class="muted" style="font-size:13px;line-height:1.65;margin:0 0 26px;">
        MSS Search &amp; Discovery 운영 콘솔.<br>
        <strong>musinsa.com</strong> Google 계정으로 로그인하세요.
      </p>
      <button id="auth-gate-signin" type="button" class="btn primary" style="width:100%;height:auto;justify-content:center;padding:11px 16px;">
        Google 로그인 →
      </button>
      <p id="auth-gate-msg" class="muted" style="font-size:11px;margin:16px 0 0;min-height:14px;"></p>
    </div>`;
  el.querySelector('#auth-gate-signin').addEventListener('click', async () => {
    if (signingIn) return;
    signingIn = true;
    const msg = el.querySelector('#auth-gate-msg');
    if (msg) msg.textContent = 'Google 로 이동 중…';
    try {
      await auth.signIn();   // OAuth redirect — 복귀 후 세션 흡수
    } catch (e) {
      signingIn = false;
      if (msg) msg.textContent = '로그인 시작 실패 — 다시 시도해 주세요.';
      console.error('[auth-gate] signIn 실패', e);
    }
  });
  return el;
}

function showGate() {
  if (overlay) return;
  overlay = buildOverlay();
  document.body.appendChild(overlay);
  document.documentElement.style.overflow = 'hidden';
}

function hideGate() {
  if (!overlay) return;
  overlay.remove();
  overlay = null;
  document.documentElement.style.overflow = '';
}

function updateSidebarAuth() {
  const slot = document.querySelector('[data-auth-slot]');
  if (!slot) return;
  if (auth.isSignedIn()) {
    slot.innerHTML = `
      <span class="muted">로그인됨</span><br>
      <span class="num auth-email">${escapeHtml(auth.email() || '')}</span>
      <button type="button" class="sb-logout" data-logout>로그아웃</button>`;
    slot.querySelector('[data-logout]')?.addEventListener('click', () => {
      auth.signOut().catch((e) => { console.error('[auth-gate] 로그아웃 실패', e); sync(); });
    });
  } else {
    slot.innerHTML = '';
  }
}

function sync() {
  if (auth.isSignedIn()) hideGate();
  else showGate();
  updateSidebarAuth();
}

/** 전역 게이트 시작. nav.js renderSidebar 에서 호출(fire-and-forget). idempotent. */
export async function ensureAuthGate() {
  if (started) {
    // 사이드바가 재렌더된 경우 슬롯만 다시 채움
    updateSidebarAuth();
    return;
  }
  started = true;
  // fail-closed: 세션 확인 전엔 일단 잠근다 (미인증 사용자가 콘텐츠를 잠깐이라도 보는 것 방지).
  // 세션이 있으면 init 직후 sync() 가 즉시 해제. init 실패해도 게이트는 유지(노출 방지).
  showGate();
  auth.onChange(() => sync());
  try {
    await auth.init();
  } catch (e) {
    console.error('[auth-gate] 세션 복원 실패', e);
  }
  sync();
}
