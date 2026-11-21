# shat-web

React + TypeScript shell for SHAT.

## Setup

```sh
npm install
npm run dev -w apps/web
```

The dev server proxies to the backend at `http://localhost:3000` by default; set
`VITE_API_BASE_URL` to override.

## Browser limitations (spec §11.3)

The browser build has no native-like background calls and browser local mode is
limited: message content stays in volatile memory only (Ghost Mode) and is
discarded on reload. Background delivery, push and local notifications are not
available in the browser build.
