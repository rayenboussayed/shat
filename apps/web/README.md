# shat-web

React + TypeScript shell for SHAT.

## Setup

```sh
npm install
npm run dev -w apps/web
```

The dev server proxies to the backend at `http://localhost:3000` by default; set
`VITE_API_BASE_URL` to override.

## Ghost Mode scope

Ghost Mode is a LOCAL-storage guarantee only. It keeps message content out of
`localStorage`, `sessionStorage`, IndexedDB and cookies on this device, holding
it in volatile memory that is discarded on reload. It does not encrypt content
or stop it leaving the device: sending POSTs the envelope to `/mailbox`, where
the server persists it. The composer shows this caveat in the UI.

## Browser limitations (spec §11.3)

The browser build has no native-like background calls and browser local mode is
limited: message content stays in volatile memory only (Ghost Mode) and is
discarded on reload. Background delivery, push and local notifications are not
available in the browser build.
