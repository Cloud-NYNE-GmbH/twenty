import {
  Controller,
  Get,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';

import { type Request, type Response } from 'express';
import { generators } from 'openid-client';
import { isDefined } from 'twenty-shared/utils';

import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { AuthRestApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-rest-api-exception.filter';
import { OidcProviderEnabledGuard } from 'src/engine/core-modules/auth/guards/oidc-provider-enabled.guard';
import { AuthService } from 'src/engine/core-modules/auth/services/auth.service';
import { OidcClientService } from 'src/engine/core-modules/auth/services/oidc-client.service';
import { type SocialSSOState } from 'src/engine/core-modules/auth/types/social-sso-state.type';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';

// OAuth transaction details kept server-side between the authorization redirect
// and the callback. Twenty has express-session wired (see main.ts), so we use
// it to hold the CSRF state, PKCE verifier and nonce rather than trusting the
// round-trip.
declare module 'express-session' {
  interface SessionData {
    oidc?: {
      state: string;
      nonce: string;
      codeVerifier: string;
      socialSSOState: SocialSSOState;
    };
  }
}

const OIDC_SCOPE = 'openid email profile';

// Unlike the Google/Microsoft passport strategies, generic OIDC is implemented
// as an explicit code flow (PKCE + state + nonce). openid-client's passport
// integration is session-coupled in ways that fight Twenty's stateless social
// strategies, so the manual flow is simpler and easier to reason about.
@Controller('auth/oidc')
@UseFilters(AuthRestApiExceptionFilter)
export class OidcAuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly oidcClientService: OidcClientService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  @Get()
  @UseGuards(OidcProviderEnabledGuard, PublicEndpointGuard, NoPermissionGuard)
  async oidcAuth(@Req() req: Request, @Res() res: Response) {
    const client = await this.oidcClientService.getClient();

    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    const state = generators.state();
    const nonce = generators.nonce();

    const socialSSOState: SocialSSOState = {
      workspaceInviteHash: req.query.workspaceInviteHash as string | undefined,
      workspaceId: req.query.workspaceId as string | undefined,
      billingCheckoutSessionState: req.query.billingCheckoutSessionState as
        | string
        | undefined,
      action:
        (req.query.action as SocialSSOState['action']) ??
        'list-available-workspaces',
      returnToPath: req.query.returnToPath as string | undefined,
    };

    req.session.oidc = { state, nonce, codeVerifier, socialSSOState };

    const authorizationUrl = client.authorizationUrl({
      scope: OIDC_SCOPE,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return res.redirect(authorizationUrl);
  }

  @Get('redirect')
  @UseGuards(OidcProviderEnabledGuard, PublicEndpointGuard, NoPermissionGuard)
  async oidcAuthRedirect(@Req() req: Request, @Res() res: Response) {
    const transaction = req.session.oidc;

    if (!isDefined(transaction)) {
      throw new AuthException(
        'Missing OIDC authorization request in session',
        AuthExceptionCode.SSO_AUTH_FAILED,
      );
    }

    const client = await this.oidcClientService.getClient();
    const params = client.callbackParams(req);

    const tokenSet = await client.callback(
      this.twentyConfigService.get('AUTH_OIDC_CALLBACK_URL'),
      params,
      {
        state: transaction.state,
        nonce: transaction.nonce,
        code_verifier: transaction.codeVerifier,
      },
    );

    const claims = tokenSet.claims();

    // Intranet IdP — we trust the email Authentik returns (it is the source of
    // truth for our directory) rather than requiring claims.email_verified.
    if (!isDefined(claims.email)) {
      throw new AuthException(
        'OIDC provider did not return an email claim',
        AuthExceptionCode.SSO_AUTH_FAILED,
      );
    }

    const { socialSSOState } = transaction;

    // Single-use transaction — clear before redeeming the login.
    req.session.oidc = undefined;

    const redirectUrl = await this.authService.signInUpWithSocialSSO(
      {
        email: claims.email,
        firstName: claims.given_name ?? null,
        lastName: claims.family_name ?? null,
        picture: claims.picture ?? null,
        workspaceInviteHash: socialSSOState.workspaceInviteHash,
        workspaceId: socialSSOState.workspaceId,
        billingCheckoutSessionState: socialSSOState.billingCheckoutSessionState,
        locale: socialSSOState.locale,
        action: socialSSOState.action ?? 'list-available-workspaces',
        returnToPath: socialSSOState.returnToPath,
      },
      AuthProviderEnum.Oidc,
    );

    return res.redirect(redirectUrl);
  }
}
