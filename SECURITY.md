# Security policy

This tool exists so people can open a loved one's vault, sometimes years after it was created. Its correctness and its trustworthiness matter more than features.

## Reporting a vulnerability

Please email **akash@eternalvault.app** with a description, steps to reproduce and the affected version or commit. Do not open a public issue for security problems.

You'll get an acknowledgement within 72 hours. We'll agree a disclosure timeline with you, and credit you in the release notes unless you'd rather stay anonymous.

## Scope

In scope:

- Anything that lets someone open a bundle without enough access codes or the owner's passphrase.
- Anything that makes the tool send data off the device.
- Deviations between the implementation and [FORMAT.md](FORMAT.md).
- Build or release issues that could let a modified `recover.html` be distributed as genuine.

Out of scope:

- Contacts opening a bundle early with enough valid codes. That is the documented tradeoff of offline recovery.
- Attacks that require a compromised device or browser.

## Security model

- A bundle plus enough access codes (or the owner's passphrase) opens the vault immediately. Offline there is no waiting period; that is the deliberate tradeoff of offline recovery.
- Without enough codes the bundle is unreadable. Document names, file names and contact details are encrypted too.
- Each guess at a code or passphrase costs a full scrypt evaluation (N = 2^18), which makes offline guessing slow.
- `recover.html` makes no network requests. Its Content Security Policy blocks them.

## Supported versions

Every release must keep opening every bundle format version it has ever supported. Security fixes are released as new versions; the latest release is the supported one.
