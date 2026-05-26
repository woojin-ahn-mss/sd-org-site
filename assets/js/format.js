/* =========================================================
   format.js — 날짜·기간·숫자·% 포매터
   ========================================================= */

const KST_TZ = 'Asia/Seoul';

/** Date-ish → Date (null/undefined 안전) */
function toDate(d) {
  if (!d) return null;
  if (d instanceof Date) return isNaN(d) ? null : d;
  const t = new Date(d);
  return isNaN(t) ? null : t;
}

/** "2026-05-22" (KST) */
export function fmtDate(d) {
  const t = toDate(d);
  if (!t) return '—';
  return t.toLocaleDateString('en-CA', { timeZone: KST_TZ });
}

/** "2026-05-22 14:30" (KST) */
export function fmtDateTime(d) {
  const t = toDate(d);
  if (!t) return '—';
  const ymd = t.toLocaleDateString('en-CA', { timeZone: KST_TZ });
  const hm = t.toLocaleTimeString('en-GB', {
    timeZone: KST_TZ, hour: '2-digit', minute: '2-digit', hour12: false
  });
  return `${ymd} ${hm}`;
}

/** "오늘" / "어제" / "3일 전" / "2주 전" / 정확 날짜 */
export function fmtAgo(d, now = new Date()) {
  const t = toDate(d);
  if (!t) return '—';
  const ms = now - t;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return '방금';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day === 0) return '오늘';
  if (day === 1) return '어제';
  if (day < 7) return `${day}일 전`;
  if (day < 30) return `${Math.floor(day / 7)}주 전`;
  if (day < 365) return `${Math.floor(day / 30)}개월 전`;
  return fmtDate(d);
}

/** 기간 일수 (start ~ end 포함) */
export function daysBetween(start, end) {
  const a = toDate(start), b = toDate(end);
  if (!a || !b) return null;
  const ms = Math.abs(b - a);
  return Math.round(ms / 86400000);
}

/** 기한까지 남은 일수 (음수면 지연). 자정 기준. */
export function daysUntil(due, now = new Date()) {
  const d = toDate(due);
  if (!d) return null;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((end - start) / 86400000);
}

/** "12.4%" — 소수점 1자리, NaN 안전 */
export function fmtPct(value, { digits = 1, sign = false } = {}) {
  if (value == null || isNaN(value)) return '—';
  const v = Number(value);
  const out = v.toFixed(digits);
  return (sign && v > 0 ? '+' : '') + out + '%';
}

/** "1,234" — 천 단위 콤마 */
export function fmtNum(value, { digits = 0, sign = false } = {}) {
  if (value == null || isNaN(value)) return '—';
  const v = Number(value);
  const out = v.toLocaleString('en-US', {
    minimumFractionDigits: digits, maximumFractionDigits: digits
  });
  return (sign && v > 0 ? '+' : '') + out;
}

/** "+0.8%p" / "-2.1%p" — 변화량(증감)용 */
export function fmtDelta(value, { unit = '', digits = 1 } = {}) {
  if (value == null || isNaN(value)) return '—';
  const v = Number(value);
  const sign = v > 0 ? '+' : (v < 0 ? '−' : '');
  return `${sign}${Math.abs(v).toFixed(digits)}${unit}`;
}

/** ISO YYYY-Qx → "2026 Q2" */
export function fmtQuarter(q) {
  if (!q) return '—';
  const m = /^(\d{4})-?(Q[1-4])$/i.exec(String(q));
  if (!m) return String(q);
  return `${m[1]} ${m[2].toUpperCase()}`;
}

/** "오늘" 자정 (KST) Date */
export function todayKstStart(now = new Date()) {
  const ymd = now.toLocaleDateString('en-CA', { timeZone: KST_TZ });
  // ymd 는 KST 기준 — UTC Date 로 변환할 때 +09:00 추가
  return new Date(`${ymd}T00:00:00+09:00`);
}
