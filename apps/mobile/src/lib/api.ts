import createClient from "openapi-fetch";
import type { paths } from "shat-api-types";

/**
 * Base URL for the SHAT API. Defaults to the local backend origin in
 * development; override via environment configuration in production.
 */
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

/**
 * Typed HTTP client for the SHAT API.
 */
export const api = createClient<paths>({ baseUrl: API_BASE_URL });