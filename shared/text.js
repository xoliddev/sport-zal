// JS port of kitobklubi/core/text.py: text cleaning, whole-number checks, short texts, FNV-1a.
const cc = (n) => String.fromCharCode(n);
const CONTROL = new RegExp(`[\x00-\x1f\x7f${cc(0x200b)}-${cc(0x200f)}${cc(0x202a)}-${cc(0x202e)}${cc(0x2066)}-${cc(0x2069)}]`, 'g');
const SPACE = /[ \t\n\r\f\v\u00a0\u2028\u2029\u3000]+/;
const SENTENCE = /[.!?…]+/;
const ALNUM = /[\p{L}\p{N}]/u;
const enc = new TextEncoder();

export class InputError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export const clean = (text, limit) => Array.from(String(text ?? '').replace(CONTROL, ' ').split(SPACE).filter(Boolean).join(' '))
  .slice(0, limit).join('');

export function whole(value, lo, hi, code) {
  let n;
  if (typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 9 && /^[0-9]+$/.test(value.trim())) n = Number(value.trim());
  else if (typeof value === 'number' && Number.isInteger(value)) n = value;
  else throw new InputError(code);
  if (n < lo || n > hi) throw new InputError(code);
  return n;
}

export function words(text, lo, hi, code) {
  if (typeof text !== 'string') throw new InputError(code);
  const s = clean(text, hi + 1);
  const chars = Array.from(s);
  if (chars.length > hi || chars.filter((ch) => ALNUM.test(ch)).length < lo) throw new InputError(code);
  return s;
}

export function sentences(text, lo, hi, most, code) {
  const s = words(text, lo, hi, code);
  if (s.split(SENTENCE).filter((p) => p.trim()).length > most) throw new InputError(`${code}_long`);
  return s;
}

export function h32(text) {
  let h = 0x811c9dc5;
  for (const b of enc.encode(text)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
