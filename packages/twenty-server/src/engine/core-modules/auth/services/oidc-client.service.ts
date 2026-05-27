import { Injectable } from '@nestjs/common';

import { type Client, Issuer } from 'openid-client';

import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

// Generic OIDC client for self-hosted identity providers (e.g. Authentik).
// The discovered client is memoized so we only hit the issuer's well-known
// endpoint once. Discovery is lazy (on first request) rather than at module
// bootstrap so a briefly-unreachable issuer during a deploy does not crash the
// whole server on startup.
@Injectable()
export class OidcClientService {
  private clientPromise: Promise<Client> | null = null;

  constructor(private readonly twentyConfigService: TwentyConfigService) {}

  getClient(): Promise<Client> {
    if (!this.clientPromise) {
      this.clientPromise = this.buildClient().catch((error) => {
        // Reset so a transient discovery failure can be retried next request.
        this.clientPromise = null;
        throw error;
      });
    }

    return this.clientPromise;
  }

  private async buildClient(): Promise<Client> {
    const issuer = await Issuer.discover(
      this.twentyConfigService.get('AUTH_OIDC_ISSUER_URL'),
    );

    return new issuer.Client({
      client_id: this.twentyConfigService.get('AUTH_OIDC_CLIENT_ID'),
      client_secret: this.twentyConfigService.get('AUTH_OIDC_CLIENT_SECRET'),
      redirect_uris: [this.twentyConfigService.get('AUTH_OIDC_CALLBACK_URL')],
      response_types: ['code'],
    });
  }
}
