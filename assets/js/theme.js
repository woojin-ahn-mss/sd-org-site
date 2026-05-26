/* =========================================================
   theme.js — Dark/Light 테마 토글
   - localStorage("sd.theme") = "dark" | "light"
   - 초기값: prefers-color-scheme
   - data-theme 속성을 <html> 에 설정 → tokens.css 가 가져감
   ========================================================= */

const STORAGE_KEY = 'sd.theme';
const ATTR = 'data-theme';

/** OS 기본값 */
function systemTheme() {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** 현재 적용된 테마 (DOM 기준) */
export function getTheme() {
  return document.documentElement.getAttribute(ATTR) || systemTheme();
}

/** 테마 적용 + 저장 */
export function setTheme(theme) {
  if (theme !== 'dark' && theme !== 'light') return;
  document.documentElement.setAttribute(ATTR, theme);
  try { localStorage.setItem(STORAGE_KEY, theme); } catch (_) {}
  document.dispatchEvent(new CustomEvent('sd:theme-change', { detail: { theme } }));
}

/** 토글 */
export function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

/**
 * 초기화 — <head> 안에서 가능한 빨리 호출.
 * 저장값 있으면 그걸로, 없으면 OS prefers 로.
 */
export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch (_) {}
  const initial = saved === 'dark' || saved === 'light' ? saved : systemTheme();
  document.documentElement.setAttribute(ATTR, initial);

  // OS 설정이 바뀌면 저장값이 없을 때만 따라감
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
      let s = null;
      try { s = localStorage.getItem(STORAGE_KEY); } catch (_) {}
      if (!s) {
        document.documentElement.setAttribute(ATTR, e.matches ? 'light' : 'dark');
      }
    });
  } catch (_) {}
}

/**
 * 사이드바 풋터의 토글 버튼들에 바인딩.
 * <div class="sb-theme">
 *   <button data-theme-set="dark">Dark</button>
 *   <button data-theme-set="light">Light</button>
 * </div>
 */
export function bindThemeButtons(root = document) {
  const sync = () => {
    const cur = getTheme();
    root.querySelectorAll('[data-theme-set]').forEach(btn => {
      btn.classList.toggle('on', btn.dataset.themeSet === cur);
    });
  };
  root.querySelectorAll('[data-theme-set]').forEach(btn => {
    btn.addEventListener('click', () => setTheme(btn.dataset.themeSet));
  });
  document.addEventListener('sd:theme-change', sync);
  sync();
}
