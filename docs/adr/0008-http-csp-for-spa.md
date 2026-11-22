# ADR 0008: HTTP Content-Security-Policy for the SPAs

- Status: Accepted
- Date: 2026-11-22
- Owner: SHAT infrastructure

## Context
Both Vite SPAs ship a strict CSP as an HTML `<meta>` tag. Browsers ignore the
`frame-ancestors`, `base-uri` and `object-src` directives when they appear in a
meta element, so the deployed pages had no effective clickjacking defence. The
nginx config served the bundles without any HTTP security headers.

## Options considered
- Add the directives to the meta tag only: invalid per spec and still ignored.
  Rejected.
- Generate a per-build CSP with hashes/nonces: more work, and the Vite/StyleX
  output is not hash-stable across rebuilds. Rejected for this scope.
- Send a static HTTP CSP header from nginx and leave the build-time meta CSP
  for the origin-specific `connect-src`. Chosen.

## Decision
- `infrastructure/docker/nginx.conf` sends
  `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`
  with `always` so it is present on error responses too.
- `style-src 'self'` covers the extracted StyleX stylesheet
  (`/assets/stylex.css`); no stylesheet hash is pinned.
- No localhost origins are hardcoded in the production header. The per-build
  meta CSP keeps the dev/verification API origins in its `connect-src`; when
  both policies are present the browser enforces the intersection.
- Runtime `envsubst` templating is unnecessary because the header is origin
  agnostic, so no entrypoint wrapper was added.

## Consequences
- A future deployment that needs third-party scripts, fonts or API origins must
  change this header and/or the meta CSP deliberately.
- The header's `default-src 'self'` is the baseline; any new asset origin must
  be allowlisted explicitly.
- Verified with `curl -I` against the running web container.

## Evidence and sources
- ADR 0005 (packaging), `infrastructure/docker/nginx.conf`,
  `apps/web/vite.config.ts`, built `index.html`, CSP Level 3 meta-tag
  restrictions (frame-ancestors/report-uri/report-to are ignored in meta).

## Revisit trigger
- The SPA loads resources from another origin.
- A nonce/hash-based strict-dynamic CSP is adopted.
