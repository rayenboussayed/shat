# SHAT mobile

Expo 58 + React Native 0.88 application skeleton.

## Native features are unverified here

This environment has no Xcode, Android SDK, or device. Native behavior,
including SQLCipher, is not verified here; only TypeScript typechecking and
unit tests run in CI/local.

SQLCipher key application is not implemented or verified in this environment:
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