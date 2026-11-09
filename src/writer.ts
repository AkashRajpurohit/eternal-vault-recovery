import { makeZip } from 'client-zip';
import { utf8Encode } from './bytes';
import { encryptIvFirst } from './crypto';
import {
  BUNDLE_FORMAT,
  BUNDLE_FORMAT_VERSION,
  BUNDLE_PATHS,
  type BundleManifest,
  SCRYPT_PARAMS,
  SHAMIR_THRESHOLD,
  type TrustLevel,
  type VaultPayload,
  type VaultPayloadDocument,
  type VaultPayloadExternalDocument,
  documentPath,
} from './format';

export interface BundleContactInput {
  name: string;
  email: string;
  trustLevel: TrustLevel;
  sharesHeld: number;
  encryptedShares: string;
}

export type BundleDocumentInput = Omit<VaultPayloadDocument, 'file'>;

export interface RecoveryToolInfo {
  html: string;
  version: string;
  sha256: string;
  mirrors: string[];
  continuityUrl: string;
}

export interface BuildBundleInput {
  createdAt?: Date;
  bundleFingerprint: string;
  owner: { firstName: string; lastName: string | null; kdfSalt: string };
  vault: { id: string; name: string; description: string | null };
  contacts: BundleContactInput[];
  documents: BundleDocumentInput[];
  externalDocuments: VaultPayloadExternalDocument[];
  masterKey: Uint8Array;
  fetchDocument: (doc: BundleDocumentInput) => Promise<Response | Blob | Uint8Array>;
  tool: RecoveryToolInfo;
  onDocumentDone?: (done: number, total: number, bytes: number) => void;
}

export function firstNameOf(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first || 'Contact';
}

export function buildManifest(input: BuildBundleInput): BundleManifest {
  return {
    format: BUNDLE_FORMAT,
    formatVersion: BUNDLE_FORMAT_VERSION,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    bundleFingerprint: input.bundleFingerprint,
    owner: { firstName: input.owner.firstName, kdfSalt: input.owner.kdfSalt },
    crypto: {
      kdf: { alg: 'scrypt', ...SCRYPT_PARAMS, salt: 'utf8(owner.kdfSalt)' },
      aead: 'AES-256-GCM',
      shamir: { field: 'GF(256), bytewise', threshold: SHAMIR_THRESHOLD, secretBytes: 32 },
    },
    contacts: input.contacts.map((c) => ({
      label: firstNameOf(c.name),
      trustLevel: c.trustLevel,
      sharesHeld: c.sharesHeld,
      encryptedShares: c.encryptedShares,
    })),
    vault: { file: BUNDLE_PATHS.vault },
  };
}

export function buildVaultPayload(input: BuildBundleInput): VaultPayload {
  return {
    formatVersion: BUNDLE_FORMAT_VERSION,
    vault: input.vault,
    owner: { firstName: input.owner.firstName, lastName: input.owner.lastName },
    documents: input.documents.map((d) => ({ ...d, file: documentPath(d.id) })),
    externalDocuments: input.externalDocuments,
    contacts: input.contacts.map((c) => ({
      name: c.name,
      email: c.email,
      trustLevel: c.trustLevel,
    })),
  };
}

export function buildReadme(input: BuildBundleInput): string {
  const owner = input.owner.firstName;
  const lines = [
    'ETERNAL VAULT: OFFLINE RECOVERY BUNDLE',
    `Vault owner: ${owner}`,
    `Created: ${(input.createdAt ?? new Date()).toISOString().slice(0, 10)}`,
    '',
    `This file lets ${owner}'s trusted contacts open their Eternal Vault without`,
    "Eternal Vault's servers. Everything inside is encrypted. Nothing here can be",
    "read without enough access codes (or the owner's passphrase).",
    '',
    'HOW TO RECOVER',
    '1. Keep this .zip file exactly as it is. Do not unzip or rename files inside it.',
    '2. Open "recover.html" (it is inside this zip; extract just that one file, or',
    '   download the same tool from one of the links below). It works offline in',
    '   any modern browser (Chrome, Edge, Firefox, Safari).',
    '3. In the tool, choose this .zip file.',
    '4. Each contact enters the 6-word access code they received by email.',
    '   The vault opens once enough codes have been entered.',
    '',
    'RECOVERY TOOL',
    `Version: ${input.tool.version}`,
    `SHA-256 of recover.html: ${input.tool.sha256}`,
    'If you download the tool from elsewhere, check that its SHA-256 matches one',
    `published at ${input.tool.continuityUrl}`,
    '',
    'Mirrors:',
    ...input.tool.mirrors.map((m) => `  - ${m}`),
    '',
    'Never type your access code into a website that asks for it unexpectedly.',
    'The real recovery tool never needs an internet connection.',
    '',
  ];
  return lines.join('\r\n');
}

export async function buildBundleStream(
  input: BuildBundleInput,
): Promise<ReadableStream<Uint8Array>> {
  const manifest = buildManifest(input);
  const payload = buildVaultPayload(input);
  const vaultEnc = encryptIvFirst(input.masterKey, utf8Encode(JSON.stringify(payload)));
  const lastModified = input.createdAt ?? new Date();
  const total = input.documents.length;

  async function* files() {
    yield { name: BUNDLE_PATHS.readme, input: buildReadme(input), lastModified };
    yield { name: BUNDLE_PATHS.tool, input: input.tool.html, lastModified };
    yield {
      name: BUNDLE_PATHS.manifest,
      input: JSON.stringify(manifest, null, 2),
      lastModified,
    };
    yield { name: BUNDLE_PATHS.vault, input: vaultEnc, lastModified };
    let done = 0;
    let bytes = 0;
    for (const doc of input.documents) {
      const content = await input.fetchDocument(doc);
      const data =
        content instanceof Uint8Array
          ? content
          : new Uint8Array(await (content as Blob | Response).arrayBuffer());
      done += 1;
      bytes += data.length;
      input.onDocumentDone?.(done, total, bytes);
      yield { name: documentPath(doc.id), input: data, lastModified };
    }
  }

  return makeZip(files()) as ReadableStream<Uint8Array>;
}

export function bundleFileName(vaultName: string, date = new Date()): string {
  const slug =
    vaultName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'vault';
  return `eternal-vault-${slug}-${date.toISOString().slice(0, 10)}.zip`;
}
