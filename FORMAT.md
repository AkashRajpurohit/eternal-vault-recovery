# Eternal Vault Offline Recovery Bundle — Format v1

A recovery bundle lets the trusted contacts of an Eternal Vault user open that user's vault with no dependency on Eternal Vault's servers. This document is the complete, byte-exact specification. Anyone can write a compatible reader from it.

All multi-byte integers in ZIP structures are little-endian. All text is UTF-8.

## 1. Container

A bundle is a ZIP archive whose entries are all stored uncompressed (method 0, STORE). Zip64 records are used when the archive exceeds 4 GiB. File names are UTF-8.

| Path | Contents |
| --- | --- |
| `README.txt` | Human instructions. Informational only. |
| `recover.html` | A copy of the recovery tool. Informational only. |
| `bundle/manifest.json` | Plaintext header (section 2). |
| `bundle/vault.enc` | Encrypted vault payload (section 4). |
| `bundle/documents/<id>.bin` | One encrypted document per file (section 5). |

Readers must locate entries through the central directory and must not rely on entry order.

## 2. `bundle/manifest.json`

```json
{
  "format": "eternal-vault-recovery",
  "formatVersion": 1,
  "createdAt": "2026-11-09T12:00:00.000Z",
  "bundleFingerprint": "<64 hex chars>",
  "owner": { "firstName": "Akash", "kdfSalt": "<owner user id>" },
  "crypto": {
    "kdf": { "alg": "scrypt", "N": 262144, "r": 8, "p": 1, "dkLen": 32, "salt": "utf8(owner.kdfSalt)" },
    "aead": "AES-256-GCM",
    "shamir": { "field": "GF(256), bytewise", "threshold": 3, "secretBytes": 32 }
  },
  "contacts": [
    { "label": "Mom", "trustLevel": "ULTIMATE_TRUST", "sharesHeld": 3, "encryptedShares": "<base64>" }
  ],
  "vault": { "file": "bundle/vault.enc" }
}
```

A reader must refuse any `format` other than `eternal-vault-recovery` and any `formatVersion` it does not implement.

`label` is the contact's first name only. `trustLevel` and `sharesHeld` are informational.

## 3. Key derivation

```
KDF(secret) = scrypt(P = utf8(secret), S = utf8(owner.kdfSalt), N, r, p, dkLen = 32)
```

The same KDF and salt are used for the owner's passphrase and for every contact's access code.

- **Owner:** `masterKey = KDF(passphrase)`.
- **Contact:** `shareKey = KDF(accessCode)`. Access codes are six lowercase words separated by single spaces. Readers should also try the input after trimming, collapsing whitespace and lowercasing.

## 4. Encrypted blobs

AES-256-GCM, 12-byte IV, 16-byte tag, no associated data. Two layouts exist.

**Layout A** (IV first), used by `vault.enc`, document keys and document files:

```
iv (12) || ciphertext || tag (16)
```

**Layout B** (IV after ciphertext), used only by `encryptedShares`, which is base64 of:

```
ciphertext || iv (12) || tag (16)
```

### Contact shares

`AES-GCM-Decrypt(shareKey, Layout B)` yields UTF-8 JSON: an array of shares `[{ "x": <int 0..255>, "y": "<64 hex chars>" }]`. Successful authentication proves the access code is correct. Because every contact shares the same salt, one KDF evaluation per entered code can be tried against every contact.

### Shamir reconstruction

Each share is a point on a degree-2 polynomial evaluated independently for each of the 32 secret bytes over GF(2^8) with the AES reduction polynomial `x^8 + x^4 + x^3 + x + 1` (0x11B). Addition is XOR.

Given at least `threshold` shares with distinct `x`, the secret byte `i` is

```
secret[i] = Σ_j  y_j[i] · Π_{m≠j}  x_m / (x_j + x_m)
```

Shares with a repeated `x` carry no extra information and are discarded. The result is the 32-byte master key.

### `vault.enc`

`AES-GCM-Decrypt(masterKey, Layout A)` yields UTF-8 JSON:

```json
{
  "formatVersion": 1,
  "vault": { "id": "…", "name": "…", "description": null },
  "owner": { "firstName": "…", "lastName": null },
  "documents": [
    {
      "id": "…", "title": "…", "description": null, "category": null, "tags": [],
      "contentType": "application/pdf", "size": 12345, "fileName": "will.pdf",
      "encryptedKey": "<hex, Layout A>", "file": "bundle/documents/<id>.bin"
    }
  ],
  "externalDocuments": [{ "id": "…", "title": "…", "description": null, "provider": "GOOGLE_DRIVE", "link": "…" }],
  "contacts": [{ "name": "…", "email": "…", "trustLevel": "HIGH_TRUST" }]
}
```

Successful decryption proves the master key is correct.

## 5. Documents

For each entry in `documents`:

1. `documentKey = AES-GCM-Decrypt(masterKey, hexDecode(encryptedKey))` (Layout A, 32 bytes).
2. `plaintext = AES-GCM-Decrypt(documentKey, bytes of file)` (Layout A).
3. The plaintext has media type `contentType` and original name `fileName`.

`externalDocuments` are references to files stored with a third party and are not contained in the bundle.

## 6. Security notes

- A bundle plus enough access codes opens the vault immediately. There is no waiting period offline.
- Anyone holding a bundle can attempt to guess the owner's passphrase or contacts' access codes offline. scrypt with N = 2^18 makes each guess expensive.
- The bundle never contains the master key or any key wrapped by the owner's passphrase.

## 7. Test vectors

`test-vectors/v1-basic.zip` with its secrets in `test-vectors/v1-basic.json`. Every reader must open it with:

- the `raj` and `priya` codes together,
- the `mom` code alone,
- the owner `passphrase`.
