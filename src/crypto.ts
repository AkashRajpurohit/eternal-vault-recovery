import { gcm } from '@noble/ciphers/aes.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import * as GF256 from '@stablelib/gf256';
import {
  base64ToBytes,
  bytesToBase64,
  concatBytes,
  hexToBytes,
  utf8Decode,
  utf8Encode,
} from './bytes';
import { AES_GCM_IV_LENGTH, AES_GCM_TAG_LENGTH, SCRYPT_PARAMS, SHAMIR_THRESHOLD } from './format';

export interface ShamirShare {
  x: number;
  y: string;
}

export interface KdfParams {
  N: number;
  r: number;
  p: number;
  dkLen: number;
}

export type ProgressCallback = (fraction: number) => void;

export async function deriveKey(
  secret: string,
  salt: string,
  params: KdfParams = SCRYPT_PARAMS,
  onProgress?: ProgressCallback,
): Promise<Uint8Array> {
  return scryptAsync(utf8Encode(secret), utf8Encode(salt), {
    N: params.N,
    r: params.r,
    p: params.p,
    dkLen: params.dkLen,
    asyncTick: 20,
    onProgress,
  });
}

function gcmDecrypt(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array, tag: Uint8Array) {
  return gcm(key, iv).decrypt(concatBytes(ciphertext, tag));
}

export function decryptIvFirst(key: Uint8Array, packed: Uint8Array): Uint8Array {
  if (packed.length < AES_GCM_IV_LENGTH + AES_GCM_TAG_LENGTH) {
    throw new Error('Ciphertext is too short');
  }
  const iv = packed.subarray(0, AES_GCM_IV_LENGTH);
  const tag = packed.subarray(packed.length - AES_GCM_TAG_LENGTH);
  const ciphertext = packed.subarray(AES_GCM_IV_LENGTH, packed.length - AES_GCM_TAG_LENGTH);
  return gcmDecrypt(key, iv, ciphertext, tag);
}

export function encryptIvFirst(key: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const iv = new Uint8Array(AES_GCM_IV_LENGTH);
  crypto.getRandomValues(iv);
  return concatBytes(iv, gcm(key, iv).encrypt(plaintext));
}

export function decryptContactShares(
  shareKey: Uint8Array,
  encryptedSharesB64: string,
): ShamirShare[] {
  const packed = base64ToBytes(encryptedSharesB64);
  if (packed.length < AES_GCM_IV_LENGTH + AES_GCM_TAG_LENGTH) {
    throw new Error('Encrypted shares are too short');
  }
  const ctLength = packed.length - AES_GCM_IV_LENGTH - AES_GCM_TAG_LENGTH;
  const ciphertext = packed.subarray(0, ctLength);
  const iv = packed.subarray(ctLength, ctLength + AES_GCM_IV_LENGTH);
  const tag = packed.subarray(packed.length - AES_GCM_TAG_LENGTH);
  const parsed: unknown = JSON.parse(utf8Decode(gcmDecrypt(shareKey, iv, ciphertext, tag)));
  if (!Array.isArray(parsed)) {
    throw new Error('Decrypted shares are not an array');
  }
  return parsed.filter(
    (s): s is ShamirShare =>
      typeof s === 'object' &&
      s !== null &&
      typeof s.x === 'number' &&
      typeof s.y === 'string' &&
      s.y.length === 64,
  );
}

export function encryptContactShares(shareKey: Uint8Array, shares: ShamirShare[]): string {
  const iv = new Uint8Array(AES_GCM_IV_LENGTH);
  crypto.getRandomValues(iv);
  const sealed = gcm(shareKey, iv).encrypt(utf8Encode(JSON.stringify(shares)));
  const ciphertext = sealed.subarray(0, sealed.length - AES_GCM_TAG_LENGTH);
  const tag = sealed.subarray(sealed.length - AES_GCM_TAG_LENGTH);
  return bytesToBase64(concatBytes(ciphertext, iv, tag));
}

export function uniqueSharesByX(shares: ShamirShare[]): ShamirShare[] {
  const seen = new Map<number, ShamirShare>();
  for (const s of shares) {
    if (!seen.has(s.x)) seen.set(s.x, s);
  }
  return [...seen.values()];
}

function lagrangeBasisAtZero(xs: number[], i: number): number {
  let result = 1;
  const xi = xs[i];
  for (let j = 0; j < xs.length; j++) {
    if (j === i) continue;
    const xj = xs[j];
    result = GF256.mul(result, GF256.div(xj, GF256.add(xi, xj)));
  }
  return result;
}

export function reconstructSecret(shares: ShamirShare[]): Uint8Array {
  const unique = uniqueSharesByX(shares);
  if (unique.length < SHAMIR_THRESHOLD) {
    throw new Error(`Need at least ${SHAMIR_THRESHOLD} unique shares, have ${unique.length}`);
  }
  const xs = unique.map((s) => s.x & 0xff);
  const ys = unique.map((s) => hexToBytes(s.y));
  const bases = xs.map((_, i) => lagrangeBasisAtZero(xs, i));
  const secret = new Uint8Array(32);
  for (let b = 0; b < 32; b++) {
    let acc = 0;
    for (let i = 0; i < unique.length; i++) {
      acc = GF256.add(acc, GF256.mul(ys[i][b], bases[i]));
    }
    secret[b] = acc;
  }
  return secret;
}

export function decryptDocumentKey(masterKey: Uint8Array, encryptedKeyHex: string): Uint8Array {
  return decryptIvFirst(masterKey, hexToBytes(encryptedKeyHex));
}
