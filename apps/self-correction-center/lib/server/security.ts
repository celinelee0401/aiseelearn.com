const encoder = new TextEncoder();
// Cloudflare Workers used by Sites caps PBKDF2 at 100,000 iterations.
// Keep the maximum supported work factor and retain the hash version so a
// future increase can be introduced without silently breaking PINs.
const CURRENT_PIN_HASH_VERSION = 'v2';
const PBKDF2_ITERATIONS = 100_000;

function toBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromBase64Url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function normalizeActivationCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidPin(value: string): boolean {
  return /^\d{6}$/.test(value);
}

export async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return toBase64Url(new Uint8Array(signature));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return toHex(new Uint8Array(digest));
}

export async function createPinHash(pin: string): Promise<string> {
  const salt = randomToken(16);
  const key = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64Url(salt), iterations: PBKDF2_ITERATIONS }, key, 256);
  return `${CURRENT_PIN_HASH_VERSION}.${salt}.${toBase64Url(new Uint8Array(bits))}`;
}

export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  const [version, salt, expected] = storedHash.split('.');
  if (version !== CURRENT_PIN_HASH_VERSION || !salt || !expected) return false;

  const key = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64Url(salt), iterations: PBKDF2_ITERATIONS }, key, 256);
  return constantTimeEqual(toBase64Url(new Uint8Array(bits)), expected);
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
