import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthService } from "../identity/auth.service.ts";
import type { SessionHeaders } from "../identity/schemas.ts";
import {
  TURN_CREDENTIAL_TTL_SECONDS,
  buildTurnUsername,
  parseTurnUsername,
  signTurnUsername,
} from "./credentials.ts";
import { TURN_CONFIG } from "./turn.config.ts";
import type { TurnConfig } from "./turn.config.ts";

/** Short-lived TURN credential returned to an authenticated device. */
export interface TurnCredentialResponse {
  readonly username: string;
  readonly password: string;
  readonly ttlSeconds: number;
  readonly expiresAt: string;
  readonly uris: string[];
}

/** Issues and verifies TURN credentials bound to the caller's device. */
@Injectable()
export class TurnService {
  constructor(
    private readonly auth: AuthService,
    @Inject(TURN_CONFIG) private readonly config: TurnConfig,
  ) {}

  /**
   * Mints a credential for the session's device. Requires a valid session and a
   * configured secret; otherwise the request fails without issuing anything.
   */
  async issue(headers: SessionHeaders): Promise<TurnCredentialResponse> {
    const actor = await this.auth.getAuthenticatedActor(headers);
    if (!actor) {
      throw new UnauthorizedException("Authentication is required");
    }
    const secret = this.config.secret;
    if (secret === undefined) {
      throw new ServiceUnavailableException("TURN credentials are not configured");
    }

    const expiresAtSeconds = Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL_SECONDS;
    const username = buildTurnUsername(actor.id, expiresAtSeconds);
    return {
      username,
      password: signTurnUsername(secret, username),
      ttlSeconds: TURN_CREDENTIAL_TTL_SECONDS,
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      uris: [...this.config.uris],
    };
  }

  /**
   * Checks a username and password the way a coturn REST-secret verifier does: the
   * username must parse, expire within the policy window, and carry a MAC that matches
   * in constant time.
   */
  verify(username: string, password: string, nowSeconds: number): boolean {
    const secret = this.config.secret;
    const parsed = parseTurnUsername(username);
    if (secret === undefined || parsed === undefined) {
      return false;
    }
    const remaining = parsed.expiresAtSeconds - nowSeconds;
    if (remaining <= 0 || remaining > TURN_CREDENTIAL_TTL_SECONDS) {
      return false;
    }
    return this.auth.matchesUtf8(password, signTurnUsername(secret, username));
  }
}
