/**
 * Crypto facade for SHAT mobile.
 *
 * This module exposes only reviewed operations as an interface. No algorithm is
 * chosen or certified and no custom protocol is implemented (spec §5.1, §5.8).
 * Do not invent crypto.
 */

/** Opaque byte buffer alias. */
export type CryptoBytes = Uint8Array;

/** Hash algorithm is selected by the implementation, not this facade. */
/**
 * Facade exposing only reviewed cryptographic operations. No algorithm is
 * chosen or certified; implementations provide the concrete primitives.
 */
export interface CryptoFacade {
  /** Hash input bytes. */
  hash(input: CryptoBytes): Promise<CryptoBytes>;
  /** AEAD encrypt plaintext. */
  aeadEncrypt(
    key: CryptoBytes,
    nonce: CryptoBytes,
    plaintext: CryptoBytes,
    associatedData?: CryptoBytes,
  ): Promise<CryptoBytes>;
  /** AEAD decrypt ciphertext. */
  aeadDecrypt(
    key: CryptoBytes,
    nonce: CryptoBytes,
    ciphertext: CryptoBytes,
    associatedData?: CryptoBytes,
  ): Promise<CryptoBytes>;
  /** Derive key material. */
  kdf(
    inputKeyingMaterial: CryptoBytes,
    salt: CryptoBytes,
    info: CryptoBytes,
    length: number,
  ): Promise<CryptoBytes>;
  /** Generate random bytes. */
  random(length: number): CryptoBytes;
}
