# ADR 0006: Crypto facade boundary
- Status: Accepted
- Date: 2026-11-22
- Owner: SHAT mobile / security

## Context
Spec §5.1 and §5.8 require a cryptography boundary for SHAT and forbid
inventing protocol suites. The plan (§14.1) marks "crypto protocol/library" as a
required early ADR. Shipped clients must be able to call reviewed primitives
without binding their application code to a specific algorithm or provider, and
the repository must not make an end-to-end-encryption claim that has not been
validated (§19). P12 added `apps/mobile/src/crypto/facade.ts`; this ADR records
the decision that file embodies.

## Options considered
1. Pick a concrete algorithm and library now (for example a specific AEAD and
   Argon2id binding) and expose it directly. Rejected: no algorithm has been
   reviewed or certified here, and the spec forbids inventing or prematurely
   fixing suites (§5.1).
2. Expose an interface of reviewed, well-understood operations only, with
   algorithm selection delegated to a vetted implementation and every bundled
   adapter failing closed until one is supplied. Chosen.
3. Implement a custom protocol. Rejected outright: §0.2 non-goal and §5.1.

## Decision
- `apps/mobile/src/crypto/facade.ts` defines a `CryptoFacade` interface of five
  operations — `hash`, `aeadEncrypt`, `aeadDecrypt`, `kdf`, `random` — over an
  opaque `CryptoBytes = Uint8Array`. It names no algorithm, cipher, KDF or
  curve, and it implements no protocol.
- Algorithm choice is explicitly deferred to an implementation. No concrete,
  certified implementation ships; per `apps/mobile/README.md` the crypto
  facade is an unverified capability and no E2EE claim is made. Adapters that
  are present fail closed.
- Application code depends only on the interface, so a reviewed provider can be
  substituted without changing call sites.

## Consequences
- The boundary is honest and decoupled: adding a vetted provider is a local
  change, and there is no false encryption claim in CI or documentation.
- The facade alone provides no encryption. Until a reviewed implementation is
  supplied and validated, crypto-dependent features are non-functional and
  end-to-end encryption remains unverified.
- Deferring the algorithm keeps the door open to per-platform providers (Hermes
  lacks Node crypto globals, §10.4) at the cost of a later, separately reviewed
  decision.

## Evidence and sources
- Spec §5.1, §5.8 (crypto facade), §19 (no unreviewed crypto), §0.2 (no custom
  protocol); plan §14.1 and reuse map ("E2EE facade (§5.8)").
- File: `apps/mobile/src/crypto/facade.ts` (`CryptoFacade`, `CryptoBytes`).
- `apps/mobile/README.md` lists "Crypto facade (no algorithm chosen or
  certified)" and "Real end-to-end encryption algorithms or protocols" as
  unverified.

## Revisit trigger
- A concrete algorithm and library are selected and externally reviewed.
- A vetted provider implementation is added and validated on at least one
  target platform.
- The security review (§19.2) approves a protocol suite for SHAT.
