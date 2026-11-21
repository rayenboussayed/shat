/// <reference types="vite/client" />

/** Ambient Vite environment variables for the dashboard app. */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

/** Vite's import.meta shape extended with the app's environment variables. */
interface ImportMeta {
  readonly env: ImportMetaEnv;
}