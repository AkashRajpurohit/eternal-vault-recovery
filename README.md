<p align="center">
  <img src="docs/assets/logo.png" alt="Eternal Vault" width="72" height="72" />
</p>

<h1 align="center">Eternal Vault Recovery</h1>

<p align="center">
  Open an Eternal Vault from its Offline Recovery Bundle. No servers, no account, no internet.
</p>

<p align="center">
  <a href="https://github.com/AkashRajpurohit/eternal-vault-recovery/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/AkashRajpurohit/eternal-vault-recovery/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-127172" /></a>
  <a href="FORMAT.md"><img alt="Bundle format v1" src="https://img.shields.io/badge/bundle%20format-v1-127172" /></a>
</p>

---

[Eternal Vault](https://eternalvault.app) keeps a person's important documents encrypted and opens them for their trusted contacts when the time comes. This repository makes sure that still works **even if Eternal Vault itself no longer exists**.

It contains:

- **`recover.html`**, a single self-contained web page that opens a recovery bundle entirely on your computer.
- **The bundle format specification** ([`FORMAT.md`](FORMAT.md)), byte-exact, so anyone can build a compatible reader.
- **A reference implementation** in TypeScript, used by both the recovery tool and the Eternal Vault dashboard that creates bundles.
- **Test vectors** that every version of the tool must keep opening, forever.

## If you're here to open someone's vault

You need three things:

1. **The recovery bundle**, a `.zip` file named like `eternal-vault-<name>-<date>.zip`. The owner will have told you where it's kept, usually in a printed letter.
2. **The recovery tool**, `recover.html`. It's inside the bundle's zip file, and it's also attached to every [release](https://github.com/AkashRajpurohit/eternal-vault-recovery/releases) of this repository.
3. **Access codes.** Each trusted contact received a 6-word code by email when they were added. The letter tells you how many people need to enter theirs.

Then:

1. Open `recover.html` in any modern browser (Chrome, Edge, Firefox or Safari). Double-clicking the file is enough.
2. Choose the bundle `.zip` file. Don't unzip it first.
3. Each contact enters their access code on the same computer. Once enough codes match, the vault opens.
4. View or download the documents. Nothing is ever sent anywhere.

<p align="center">
  <img src="docs/assets/choose-bundle.jpg" alt="Choosing the recovery bundle" width="32%" />
  <img src="docs/assets/enter-codes.jpg" alt="Entering access codes" width="32%" />
  <img src="docs/assets/unlocked.jpg" alt="The unlocked vault" width="32%" />
</p>

> [!IMPORTANT]
> Never type an access code into a website that asks for it unexpectedly. The real recovery tool runs offline and never needs an internet connection.

## Verify the tool before you trust it

Every release publishes `recover.html` together with a `SHA256SUMS` file and a GitHub build provenance attestation.

```sh
# macOS / Linux
shasum -a 256 recover.html

# Windows (PowerShell)
Get-FileHash recover.html -Algorithm SHA256
```

Compare the result with `SHA256SUMS` from the [release](https://github.com/AkashRajpurohit/eternal-vault-recovery/releases) and with the hash listed at [eternalvault.app/continuity](https://eternalvault.app/continuity). With the GitHub CLI you can also verify where a file was built:

```sh
gh attestation verify recover.html --repo AkashRajpurohit/eternal-vault-recovery
```

## How it works

```
access code ──scrypt──▶ share key ──AES-256-GCM──▶ key shares ─┐
access code ──scrypt──▶ share key ──AES-256-GCM──▶ key shares ─┼─ Shamir (3 of n) ─▶ master key
access code ──scrypt──▶ share key ──AES-256-GCM──▶ key shares ─┘                        │
                                                                                         ▼
                              documents ◀──AES-256-GCM── document keys ◀── vault.enc (names, keys)
```

- The vault's **master key** is split with Shamir's Secret Sharing over GF(256). Three shares reconstruct it; each contact holds one to three, depending on their trust level.
- Each contact's shares are encrypted with a key derived from their **access code** using scrypt (N = 2¹⁸, r = 8, p = 1).
- **Everything identifying is encrypted**: document titles, file names, tags, the vault name and the contacts' full details. The only plaintext is the format header and each contact's first name, so the right people know whose code is needed.
- The owner can also open their own bundle with their passphrase, which is how they check that it works.

The complete, byte-exact description is in [`FORMAT.md`](FORMAT.md).

## Security model

| | |
| --- | --- |
| **Protects against** | Eternal Vault shutting down, its servers being unreachable, its domain disappearing. Someone finding the bundle without enough access codes. |
| **Does not protect against** | Enough trusted contacts deciding to open the bundle early. Offline, nothing can enforce a waiting period; this is the deliberate tradeoff, and it's why the bundle is opt-in. |
| **Offline guessing** | Anyone holding a bundle can try to guess access codes or the owner's passphrase. Each guess costs a full scrypt evaluation, and generated codes carry about 68 bits of entropy. |
| **Network** | The tool's Content Security Policy blocks all network requests (`default-src 'none'`). It has no analytics, no fonts or scripts from elsewhere, and no telemetry. |
| **Dependencies** | Pure-JavaScript cryptography from [`@noble/hashes`](https://github.com/paulmillr/noble-hashes) and [`@noble/ciphers`](https://github.com/paulmillr/noble-ciphers) (independently audited), so the tool doesn't depend on WebCrypto being available for local files. |

Found a vulnerability? Please follow [SECURITY.md](SECURITY.md).

## Build from source

Requires Node.js 20 or newer and pnpm.

```sh
pnpm install --frozen-lockfile
pnpm test           # round-trip tests and the v1 test vectors
pnpm build:tool     # writes dist-tool/recover.html and its SHA-256
pnpm build          # the library, for developers integrating the format
```

`dist-tool/recover.html` is the same single file that ships in every bundle and release. Builds use a pinned lockfile so you can reproduce a release and compare hashes.

## Test vectors

[`test-vectors/v1-basic.zip`](test-vectors) is a real bundle with published secrets in [`v1-basic.json`](test-vectors/v1-basic.json). It must open:

- with the `raj` and `priya` access codes together,
- with the `mom` access code alone,
- with the owner `passphrase`.

The test suite enforces this on every change, so a future version can never lose the ability to open an existing bundle.

## Project layout

```
src/
  format.ts      Bundle format v1: types, constants, validation
  crypto.ts      scrypt, AES-256-GCM, Shamir reconstruction
  zip/reader.ts  Lazy STORE/Zip64 reader (multi-GB bundles never load into memory)
  writer.ts      Bundle writer used by the Eternal Vault dashboard
  session.ts     Recovery session: access codes, owner unlock, document decryption
  trust.ts       Who-can-open calculations for trust levels
  app/           The recover.html user interface
test/            Round-trip and compatibility tests
test-vectors/    Bundles every version must keep opening
FORMAT.md        The specification
```

## Continuity

Eternal Vault has made public commitments about what happens if the service ever stops, including at least 90 days' notice and keeping this tool available. Read them at [eternalvault.app/continuity](https://eternalvault.app/continuity).

## License

[MIT](LICENSE) © Akash Rajpurohit. Anyone may host, mirror, modify or rebuild this tool. That's the point.
