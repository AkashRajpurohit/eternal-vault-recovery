import { utf8Decode } from './bytes';
import {
  type ProgressCallback,
  type ShamirShare,
  decryptContactShares,
  decryptDocumentKey,
  decryptIvFirst,
  deriveKey,
  reconstructSecret,
  uniqueSharesByX,
} from './crypto';
import {
  BUNDLE_PATHS,
  type BundleManifest,
  type VaultPayload,
  type VaultPayloadDocument,
  parseManifest,
  parseVaultPayload,
} from './format';
import { ZipReader } from './zip/reader';

export type CodeResult =
  | { status: 'matched'; contactIndexes: number[]; newShares: number }
  | { status: 'duplicate'; contactIndexes: number[] }
  | { status: 'no-match' };

export interface UnlockedVault {
  payload: VaultPayload;
  masterKey: Uint8Array;
}

export function normalizeAccessCode(code: string): string {
  return code.trim().split(/\s+/).filter(Boolean).join(' ').toLowerCase();
}

export class RecoverySession {
  private shares: ShamirShare[] = [];
  private readonly matchedContacts = new Set<number>();

  private constructor(
    readonly zip: ZipReader,
    readonly manifest: BundleManifest,
  ) {}

  static async open(file: Blob): Promise<RecoverySession> {
    const zip = await ZipReader.open(file);
    if (!zip.has(BUNDLE_PATHS.manifest)) {
      throw new Error(
        'This ZIP does not contain bundle/manifest.json. Make sure you chose the original Eternal Vault recovery bundle, not an extracted or re-zipped copy.',
      );
    }
    const manifest = parseManifest(await zip.textOf(BUNDLE_PATHS.manifest));
    return new RecoverySession(zip, manifest);
  }

  get uniqueShareCount(): number {
    return uniqueSharesByX(this.shares).length;
  }

  get threshold(): number {
    return this.manifest.crypto.shamir.threshold;
  }

  get matchedContactIndexes(): number[] {
    return [...this.matchedContacts];
  }

  get canReconstruct(): boolean {
    return this.uniqueShareCount >= this.threshold;
  }

  private kdfParams() {
    const { N, r, p, dkLen } = this.manifest.crypto.kdf;
    return { N, r, p, dkLen };
  }

  async addAccessCode(code: string, onProgress?: ProgressCallback): Promise<CodeResult> {
    const candidates = [...new Set([code, normalizeAccessCode(code)])].filter(Boolean);
    for (const candidate of candidates) {
      const key = await deriveKey(
        candidate,
        this.manifest.owner.kdfSalt,
        this.kdfParams(),
        onProgress,
      );
      const matches: number[] = [];
      const found: ShamirShare[] = [];
      this.manifest.contacts.forEach((contact, index) => {
        try {
          found.push(...decryptContactShares(key, contact.encryptedShares));
          matches.push(index);
        } catch {}
      });
      if (matches.length === 0) continue;

      if (matches.every((i) => this.matchedContacts.has(i))) {
        return { status: 'duplicate', contactIndexes: matches };
      }
      const before = this.uniqueShareCount;
      this.shares.push(...found);
      for (const i of matches) this.matchedContacts.add(i);
      return {
        status: 'matched',
        contactIndexes: matches,
        newShares: this.uniqueShareCount - before,
      };
    }
    return { status: 'no-match' };
  }

  async unlockWithShares(): Promise<UnlockedVault> {
    const masterKey = reconstructSecret(this.shares);
    return this.openVault(masterKey);
  }

  async unlockWithPassphrase(
    passphrase: string,
    onProgress?: ProgressCallback,
  ): Promise<UnlockedVault> {
    const candidates = [...new Set([passphrase, passphrase.trim().replace(/\s+/g, ' ')])].filter(
      Boolean,
    );
    let lastError: unknown;
    for (const candidate of candidates) {
      const masterKey = await deriveKey(
        candidate,
        this.manifest.owner.kdfSalt,
        this.kdfParams(),
        onProgress,
      );
      try {
        return await this.openVault(masterKey);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Passphrase did not open this vault');
  }

  async openVault(masterKey: Uint8Array): Promise<UnlockedVault> {
    const sealed = await this.zip.bytesOf(BUNDLE_PATHS.vault);
    let plain: Uint8Array;
    try {
      plain = decryptIvFirst(masterKey, sealed);
    } catch {
      throw new Error('The key did not open this vault. The codes or passphrase may be wrong.');
    }
    return { payload: parseVaultPayload(utf8Decode(plain)), masterKey };
  }

  async decryptDocument(unlocked: UnlockedVault, doc: VaultPayloadDocument): Promise<Uint8Array> {
    const documentKey = decryptDocumentKey(unlocked.masterKey, doc.encryptedKey);
    const sealed = await this.zip.bytesOf(doc.file);
    return decryptIvFirst(documentKey, sealed);
  }
}
