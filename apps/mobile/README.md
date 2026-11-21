# SHAT mobile

Expo 58 + React Native 0.88 application skeleton.

## Native features are unverified here

This environment has no Xcode, Android SDK, or device. Native behavior,
including SQLCipher, is not verified here; only TypeScript typechecking and
unit tests run in CI/local.

SQLCipher key application is applied but not verified on device:
`openSecureDatabase` applies a `PRAGMA key` and runs the cipher gate, but no
encryption claim is made and end-to-end encryption has not been validated on
device.

## SQLCipher

SQLCipher is not available in Expo Go. A custom development build is required,
with the `expo-sqlite` plugin configured with `useSQLCipher: true`
(see `app.json`). The runtime gate in `src/storage/db.ts` queries
`PRAGMA cipher_version` and fails closed when it is absent or empty.

The key is obtained through the `SecureKeyProvider` interface; the bundled
`InMemoryKeyProvider` is development-only, holds no key by default, and is
not a production secure store. Never embed a key in source.
## Ghost Mode (default on)

Ghost Mode keeps message content in volatile memory only. It never writes
content to disk or logs. Persistent mode is an explicit opt-in that writes
ciphertext envelopes through the messages repository.

Limitations (spec §7.2): Ghost Mode does not protect against a compromised
device, memory inspection, screenshots, or OS-level backups; it only avoids
persistent storage of message content within the app.

## Unverified capabilities

The following are NOT verified in this environment and must not be claimed:
- SQLCipher/device encryption end-to-end.
- Wi-Fi Direct / Wi-Fi Aware transports.
- CallKit / PushKit / Core-Telecom native call handling.
- Real end-to-end encryption algorithms or protocols.
- Background/local calls.
- Online transport adapter.
- Call platform adapter (CallKit/PushKit/Core-Telecom).
- Crypto facade (no algorithm chosen or certified).
