import createClient from "openapi-fetch";
import type { paths } from "shat-api-types";

/**
 * Base URL for the SHAT API. Defaults to the local backend origin in
 * development; override with VITE_API_BASE_URL for other environments.
 */
const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

/**
 * Typed HTTP client for the SHAT API. All network access goes through this
 * instance so request and response shapes stay aligned with the generated
 * OpenAPI types.
 */
export const api = createClient<paths>({ baseUrl: API_BASE_URL });
