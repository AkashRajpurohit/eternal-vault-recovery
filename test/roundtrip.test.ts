import { describe, expect, it } from 'vitest';
import {
  BUNDLE_PATHS,
  type BundleDocumentInput,
  RecoverySession,
  ZipReader,
  buildBundleStream,
  bytesToHex,
  hexToBytes,
  minimalUnlockGroups,
  reconstructSecret,
} from '../src';
import {
  dashboardDeriveKey,
  dashboardEncryptDocument,
  dashboardEncryptShares,
  enc,
  evaluate,
} from './dashboard-compat';

describe('offline recovery bundle round trip', () => {
  it('builds a bundle and opens it with contact codes and with the owner passphrase', async () => {
    const userId = '0192f6b2-7a1e-7c3d-9f00-1234567890ab';
    const passphrase = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima';
    const masterKey = dashboardDeriveKey(passphrase, userId);
    const a1 = crypto.getRandomValues(new Uint8Array(32));
    const a2 = crypto.getRandomValues(new Uint8Array(32));

    const codes = {
      raj: 'abbey ablaze about absorb abyss academy',
      priya: 'abduct aboard above absurd abort abstract',
      sam: 'abducts ability abnormal abrasive absent abbey',
    };
    const contacts = [
      {
        name: 'Raj Kumar',
        email: 'raj@example.com',
        trustLevel: 'HIGH_TRUST' as const,
        sharesHeld: 2,
        encryptedShares: await dashboardEncryptShares(
          [evaluate(masterKey, a1, a2, 11), evaluate(masterKey, a1, a2, 22)],
          codes.raj,
          userId,
        ),
      },
      {
        name: 'Priya',
        email: 'priya@example.com',
        trustLevel: 'SHARED_TRUST' as const,
        sharesHeld: 1,
        encryptedShares: await dashboardEncryptShares(
          [evaluate(masterKey, a1, a2, 33)],
          codes.priya,
          userId,
        ),
      },
      {
        name: 'Sam',
        email: 'sam@example.com',
        trustLevel: 'SHARED_TRUST' as const,
        sharesHeld: 1,
        encryptedShares: await dashboardEncryptShares(
          [evaluate(masterKey, a1, a2, 44)],
          codes.sam,
          userId,
        ),
      },
    ];

    const fileA = enc.encode('My will, final version');
    const fileB = crypto.getRandomValues(new Uint8Array(50_000));
    const encA = await dashboardEncryptDocument(fileA, masterKey);
    const encB = await dashboardEncryptDocument(fileB, masterKey);
    const blobs: Record<string, Uint8Array> = { 'doc-a': encA.blob, 'doc-b': encB.blob };
    const documents: BundleDocumentInput[] = [
      {
        id: 'doc-a',
        title: 'Will',
        description: null,
        category: 'legal',
        tags: ['will'],
        contentType: 'text/plain',
        size: fileA.length,
        fileName: 'will.txt',
        encryptedKey: encA.encryptedKey,
      },
      {
        id: 'doc-b',
        title: 'Photos',
        description: 'Random bytes',
        category: null,
        tags: [],
        contentType: 'application/octet-stream',
        size: fileB.length,
        fileName: 'photos.bin',
        encryptedKey: encB.encryptedKey,
      },
    ];

    const stream = await buildBundleStream({
      bundleFingerprint: 'f'.repeat(64),
      owner: { firstName: 'Akash', lastName: 'R', kdfSalt: userId },
      vault: { id: 'vault-1', name: 'Family', description: null },
      contacts,
      documents,
      externalDocuments: [],
      masterKey,
      fetchDocument: async (doc) => blobs[doc.id],
      tool: {
        html: '<!doctype html><title>tool</title>',
        version: 'test',
        sha256: '0'.repeat(64),
        mirrors: ['https://example.com/mirror'],
        continuityUrl: 'https://eternalvault.app/continuity',
      },
    });
    const zipBlob = await new Response(stream).blob();

    const zip = await ZipReader.open(zipBlob);
    expect([...zip.entries.keys()]).toEqual([
      BUNDLE_PATHS.readme,
      BUNDLE_PATHS.tool,
      BUNDLE_PATHS.manifest,
      BUNDLE_PATHS.vault,
      'bundle/documents/doc-a.bin',
      'bundle/documents/doc-b.bin',
    ]);
    const manifestText = await zip.textOf(BUNDLE_PATHS.manifest);
    expect(manifestText).not.toContain('Kumar');
    expect(manifestText).not.toContain('raj@example.com');
    expect(manifestText).not.toContain('Will');

    const session = await RecoverySession.open(zipBlob);
    expect(session.manifest.contacts.map((c) => c.label)).toEqual(['Raj', 'Priya', 'Sam']);
    expect(await session.addAccessCode('wrong wrong wrong wrong wrong wrong')).toEqual({
      status: 'no-match',
    });
    expect(await session.addAccessCode(`  ${codes.raj.toUpperCase()} `)).toEqual({
      status: 'matched',
      contactIndexes: [0],
      newShares: 2,
    });
    expect(session.canReconstruct).toBe(false);
    expect((await session.addAccessCode(codes.raj)).status).toBe('duplicate');
    await session.addAccessCode(codes.priya);
    expect(session.canReconstruct).toBe(true);
    const unlocked = await session.unlockWithShares();
    expect(bytesToHex(unlocked.masterKey)).toBe(bytesToHex(masterKey));
    expect(unlocked.payload.vault.name).toBe('Family');
    expect(unlocked.payload.contacts[0].email).toBe('raj@example.com');
    const docA = await session.decryptDocument(unlocked, unlocked.payload.documents[0]);
    expect(new TextDecoder().decode(docA)).toBe('My will, final version');
    const docB = await session.decryptDocument(unlocked, unlocked.payload.documents[1]);
    expect(bytesToHex(docB)).toBe(bytesToHex(fileB));

    const ownerSession = await RecoverySession.open(zipBlob);
    await expect(ownerSession.unlockWithPassphrase('not the passphrase')).rejects.toThrow();
    const owner = await ownerSession.unlockWithPassphrase(`${passphrase}  `);
    expect(owner.payload.documents).toHaveLength(2);
  }, 120_000);

  it('reconstructs from a share at x = 0 and dedupes repeated x values', () => {
    const mk = crypto.getRandomValues(new Uint8Array(32));
    const a1 = crypto.getRandomValues(new Uint8Array(32));
    const a2 = crypto.getRandomValues(new Uint8Array(32));
    const s = [evaluate(mk, a1, a2, 0), evaluate(mk, a1, a2, 7), evaluate(mk, a1, a2, 200)];
    expect(s[0].y).toBe(bytesToHex(mk));
    expect(bytesToHex(reconstructSecret(s))).toBe(bytesToHex(mk));
    expect(() => reconstructSecret([s[1], s[1], s[2]])).toThrow();
    expect(hexToBytes(s[1].y)).toHaveLength(32);
  });
});

describe('minimalUnlockGroups', () => {
  it('lists who can open the bundle without waiting', () => {
    const mom = { name: 'Mom', sharesHeld: 3 };
    const raj = { name: 'Raj', sharesHeld: 2 };
    const priya = { name: 'Priya', sharesHeld: 1 };
    const sam = { name: 'Sam', sharesHeld: 1 };
    const { groups } = minimalUnlockGroups([mom, raj, priya, sam]);
    expect(groups.map((g) => g.map((h) => h.name).join('+'))).toEqual([
      'Mom',
      'Raj+Priya',
      'Raj+Sam',
    ]);
  });

  it('truncates large contact lists', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ name: `C${i}`, sharesHeld: 1 }));
    const result = minimalUnlockGroups(many, 3, 10);
    expect(result.truncated).toBe(true);
    expect(result.groups).toHaveLength(10);
  });
});
