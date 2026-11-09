import { scrypt } from '@noble/hashes/scrypt.js';
import * as GF256 from '@stablelib/gf256';
import { bytesToHex } from '../src';

export const enc = new TextEncoder();
const SCRYPT = { N: 262144, r: 8, p: 1, dkLen: 32 };

export function dashboardDeriveKey(passphrase: string, salt: string): Uint8Array {
  return scrypt(enc.encode(passphrase), enc.encode(salt), SCRYPT);
}

export async function aesGcmEncrypt(key: Uint8Array, plain: Uint8Array) {
  const keyBuf = new Uint8Array(key);
  const plainBuf = new Uint8Array(plain);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await crypto.subtle.importKey('raw', keyBuf, { name: 'AES-GCM' }, false, ['encrypt']);
  const out = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, k, plainBuf),
  );
  return { iv, cipher: out.slice(0, -16), tag: out.slice(-16) };
}

export function pack(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export async function dashboardEncryptShares(
  shares: { x: number; y: string }[],
  otp: string,
  userId: string,
) {
  const key = dashboardDeriveKey(otp, userId);
  const { iv, cipher, tag } = await aesGcmEncrypt(key, enc.encode(JSON.stringify(shares)));
  return btoa(String.fromCharCode(...pack(cipher, iv, tag)));
}

export async function dashboardEncryptDocument(file: Uint8Array, masterKey: Uint8Array) {
  const docKey = crypto.getRandomValues(new Uint8Array(32));
  const content = await aesGcmEncrypt(docKey, file);
  const wrapped = await aesGcmEncrypt(masterKey, docKey);
  return {
    blob: pack(content.iv, content.cipher, content.tag),
    encryptedKey: bytesToHex(pack(wrapped.iv, wrapped.cipher, wrapped.tag)),
  };
}

export function evaluate(mk: Uint8Array, a1: Uint8Array, a2: Uint8Array, x: number) {
  const x2 = GF256.mul(x, x);
  const y = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    y[i] = GF256.add(GF256.add(mk[i], GF256.mul(a1[i], x)), GF256.mul(a2[i], x2));
  }
  return { x, y: bytesToHex(y) };
}
