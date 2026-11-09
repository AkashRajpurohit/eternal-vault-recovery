export const BUNDLE_FORMAT = 'eternal-vault-recovery';
export const BUNDLE_FORMAT_VERSION = 1;

export const BUNDLE_PATHS = {
  readme: 'README.txt',
  tool: 'recover.html',
  manifest: 'bundle/manifest.json',
  vault: 'bundle/vault.enc',
  documentsDir: 'bundle/documents/',
} as const;

export const SCRYPT_PARAMS = { N: 262144, r: 8, p: 1, dkLen: 32 } as const;
export const SHAMIR_THRESHOLD = 3;
export const AES_GCM_IV_LENGTH = 12;
export const AES_GCM_TAG_LENGTH = 16;

export type TrustLevel = 'ULTIMATE_TRUST' | 'HIGH_TRUST' | 'SHARED_TRUST';

export interface ManifestContact {
  label: string;
  trustLevel: TrustLevel;
  sharesHeld: number;
  encryptedShares: string;
}

export interface BundleManifest {
  format: typeof BUNDLE_FORMAT;
  formatVersion: number;
  createdAt: string;
  bundleFingerprint: string;
  owner: {
    firstName: string;
    kdfSalt: string;
  };
  crypto: {
    kdf: {
      alg: 'scrypt';
      N: number;
      r: number;
      p: number;
      dkLen: number;
      salt: 'utf8(owner.kdfSalt)';
    };
    aead: 'AES-256-GCM';
    shamir: { field: 'GF(256), bytewise'; threshold: number; secretBytes: 32 };
  };
  contacts: ManifestContact[];
  vault: { file: typeof BUNDLE_PATHS.vault };
}

export interface VaultPayloadDocument {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  tags: string[];
  contentType: string;
  size: number;
  fileName: string;
  encryptedKey: string;
  file: string;
}

export interface VaultPayloadExternalDocument {
  id: string;
  title: string;
  description: string | null;
  provider: string;
  link: string | null;
}

export interface VaultPayloadContact {
  name: string;
  email: string;
  trustLevel: TrustLevel;
}

export interface VaultPayload {
  formatVersion: number;
  vault: { id: string; name: string; description: string | null };
  owner: { firstName: string; lastName: string | null };
  documents: VaultPayloadDocument[];
  externalDocuments: VaultPayloadExternalDocument[];
  contacts: VaultPayloadContact[];
}

export class BundleFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundleFormatError';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseManifest(json: string): BundleManifest {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new BundleFormatError('manifest.json is not valid JSON.');
  }
  if (!isObject(data) || data.format !== BUNDLE_FORMAT) {
    throw new BundleFormatError('This file is not an Eternal Vault recovery bundle.');
  }
  if (data.formatVersion !== BUNDLE_FORMAT_VERSION) {
    throw new BundleFormatError(
      `This bundle uses format version ${String(data.formatVersion)}, but this recovery tool only understands version ${BUNDLE_FORMAT_VERSION}. Download the latest recovery tool from the links in README.txt.`,
    );
  }
  const owner = data.owner;
  const cryptoParams = data.crypto;
  if (!isObject(owner) || typeof owner.kdfSalt !== 'string' || owner.kdfSalt.length === 0) {
    throw new BundleFormatError('manifest.json is missing owner.kdfSalt.');
  }
  if (!isObject(cryptoParams) || !isObject(cryptoParams.kdf) || !isObject(cryptoParams.shamir)) {
    throw new BundleFormatError('manifest.json is missing crypto parameters.');
  }
  const kdf = cryptoParams.kdf;
  if (
    kdf.alg !== 'scrypt' ||
    typeof kdf.N !== 'number' ||
    typeof kdf.r !== 'number' ||
    typeof kdf.p !== 'number' ||
    kdf.dkLen !== 32
  ) {
    throw new BundleFormatError('manifest.json has unsupported key derivation parameters.');
  }
  if (!Array.isArray(data.contacts)) {
    throw new BundleFormatError('manifest.json is missing contacts.');
  }
  for (const c of data.contacts) {
    if (!isObject(c) || typeof c.encryptedShares !== 'string' || typeof c.label !== 'string') {
      throw new BundleFormatError('manifest.json has an invalid contact entry.');
    }
  }
  return data as unknown as BundleManifest;
}

export function parseVaultPayload(json: string): VaultPayload {
  const data: unknown = JSON.parse(json);
  if (!isObject(data) || !isObject(data.vault) || !Array.isArray(data.documents)) {
    throw new BundleFormatError('vault.enc decrypted but its contents are not valid.');
  }
  return data as unknown as VaultPayload;
}

export function documentPath(documentId: string): string {
  return `${BUNDLE_PATHS.documentsDir}${documentId}.bin`;
}
