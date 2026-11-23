// JS port of sportzal/core/rotqr.py: the rotating check-in QR (a new HMAC-signed token every 30 seconds) and the
// short code a desk without a camera types. The browser demo signs with its own demo key, exactly like the server.
import { b64url, hmacSha256, sameText, sha256 } from './sha256.js';

export const PREFIX = 'SZ1';
export const STEP_MS = 30_000;
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TOKEN = /^SZ1\.([1-9][0-9]{0,8})\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{16})$/;
const FOLD = { O: '0', I: '1', L: '1' };

export const secretFrom = (seed) => sha256(`sportzal-qr|${seed}`);
export const stepOf = (ms) => Math.floor(ms / STEP_MS);
export const secondsLeft = (ms) => Math.floor((STEP_MS - (((ms % STEP_MS) + STEP_MS) % STEP_MS) + 999) / 1000);

export const token = (secret, member, step) => `${PREFIX}.${member}.${step}.${b64url(hmacSha256(secret, `qr|${member}|${step}`).slice(0, 12))}`;

export function shortCode(secret, member, step) {
  const mac = hmacSha256(secret, `code|${member}|${step}`);
  let bits = '';
  for (const b of mac.slice(0, 5)) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let k = 0; k < 8; k++) out += CODE_ALPHABET[parseInt(bits.slice(5 * k, 5 * k + 5), 2)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export function normCode(text) {
  if (typeof text !== 'string' || text.length > 32) return null;
  const s = Array.from(text.toUpperCase()).filter((ch) => /^[A-Z0-9]$/.test(ch)).map((ch) => FOLD[ch] ?? ch).join('');
  if (s.length !== 8 || [...s].some((ch) => !CODE_ALPHABET.includes(ch))) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export const fresh = (step, nowMs) => stepOf(nowMs) - 1 <= step && step <= stepOf(nowMs);

export function verify(secret, text, nowMs) {
  if (typeof text !== 'string' || text.length > 64) return null;
  const m = TOKEN.exec(text.trim());
  if (!m) return null;
  const member = Number(m[1]);
  const step = Number(m[2]);
  if (!sameText(token(secret, member, step), text.trim()) || !fresh(step, nowMs)) return null;
  return { member, step };
}

export function findCode(secret, code, members, nowMs) {
  const want = normCode(code);
  if (want === null) return null;
  const now = stepOf(nowMs);
  for (const step of [now, now - 1]) {
    for (const member of members) if (sameText(shortCode(secret, member, step), want)) return { member, step };
  }
  return null;
}
