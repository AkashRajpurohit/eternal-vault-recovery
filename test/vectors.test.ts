import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RecoverySession, buildBundleStream, bytesToHex } from '../src';
import {
  dashboardDeriveKey,
  dashboardEncryptDocument,
  dashboardEncryptShares,
  enc,
  evaluate,
} from './dashboard-compat';

const dir = new URL('../test-vectors/', import.meta.url).pathname;
const zipPath = `${dir}v1-basic.zip`;
const secretsPath = `${dir}v1-basic.json`;

async function writeVector() {
  const userId = '00000000-0000-7000-8000-000000000001';
  const passphrase = 'test vector passphrase only never use this for a real vault ok';
  const masterKey = dashboardDeriveKey(passphrase, userId);
  const a1 = crypto.getRandomValues(new Uint8Array(32));
  const a2 = crypto.getRandomValues(new Uint8Array(32));
  const codes = {
    mom: 'abbey ablaze about absorb abyss academy',
    raj: 'abduct aboard above absurd abort abstract',
    priya: 'abducts ability abnormal abrasive absent abbey',
  };
  const note = enc.encode('This is a test document inside the v1 test vector.');
  const encNote = await dashboardEncryptDocument(note, masterKey);
  const stream = await buildBundleStream({
    createdAt: new Date('2026-11-09T00:00:00Z'),
    bundleFingerprint: '0'.repeat(64),
    owner: { firstName: 'Test', lastName: 'Owner', kdfSalt: userId },
    vault: { id: 'vault-test', name: 'Test Vault', description: 'v1 test vector' },
    contacts: [
      {
        name: 'Mom Example',
        email: 'mom@example.com',
        trustLevel: 'ULTIMATE_TRUST',
        sharesHeld: 3,
        encryptedShares: await dashboardEncryptShares(
          [1, 2, 3].map((x) => evaluate(masterKey, a1, a2, x)),
          codes.mom,
          userId,
        ),
      },
      {
        name: 'Raj Example',
        email: 'raj@example.com',
        trustLevel: 'HIGH_TRUST',
        sharesHeld: 2,
        encryptedShares: await dashboardEncryptShares(
          [4, 5].map((x) => evaluate(masterKey, a1, a2, x)),
          codes.raj,
          userId,
        ),
      },
      {
        name: 'Priya Example',
        email: 'priya@example.com',
        trustLevel: 'SHARED_TRUST',
        sharesHeld: 1,
        encryptedShares: await dashboardEncryptShares(
          [evaluate(masterKey, a1, a2, 6)],
          codes.priya,
          userId,
        ),
      },
    ],
    documents: [
      {
        id: 'doc-note',
        title: 'Read me first',
        description: 'Plain text note',
        category: 'other',
        tags: ['test'],
        contentType: 'text/plain',
        size: note.length,
        fileName: 'read-me-first.txt',
        encryptedKey: encNote.encryptedKey,
      },
    ],
    externalDocuments: [
      {
        id: 'ext-1',
        title: 'Linked spreadsheet',
        description: null,
        provider: 'GOOGLE_DRIVE',
        link: 'https://drive.google.com/example',
      },
    ],
    masterKey,
    fetchDocument: async () => encNote.blob,
    tool: {
      html: '<!doctype html><title>placeholder</title>',
      version: 'test-vector',
      sha256: '0'.repeat(64),
      mirrors: [],
      continuityUrl: 'https://eternalvault.app/continuity',
    },
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(zipPath, new Uint8Array(await new Response(stream).arrayBuffer()));
  writeFileSync(
    secretsPath,
    `${JSON.stringify({ passphrase, codes, masterKeyHex: bytesToHex(masterKey), documentText: new TextDecoder().decode(note) }, null, 2)}\n`,
  );
}

describe('v1 test vector', () => {
  it('still opens with the published codes and passphrase', async () => {
    if (process.env.WRITE_VECTORS === '1' || !existsSync(zipPath)) await writeVector();
    const secrets = JSON.parse(readFileSync(secretsPath, 'utf8'));
    const zip = new Blob([readFileSync(zipPath)]);

    const session = await RecoverySession.open(zip);
    await session.addAccessCode(secrets.codes.raj);
    expect(session.canReconstruct).toBe(false);
    await session.addAccessCode(secrets.codes.priya);
    const unlocked = await session.unlockWithShares();
    expect(bytesToHex(unlocked.masterKey)).toBe(secrets.masterKeyHex);
    const doc = await session.decryptDocument(unlocked, unlocked.payload.documents[0]);
    expect(new TextDecoder().decode(doc)).toBe(secrets.documentText);

    const mom = await RecoverySession.open(zip);
    await mom.addAccessCode(secrets.codes.mom);
    expect(mom.canReconstruct).toBe(true);

    const owner = await RecoverySession.open(zip);
    const ownerVault = await owner.unlockWithPassphrase(secrets.passphrase);
    expect(ownerVault.payload.vault.name).toBe('Test Vault');
  }, 120_000);
});
