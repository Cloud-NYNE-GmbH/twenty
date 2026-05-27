import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';

import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { GuardRedirectService } from 'src/engine/core-modules/guard-redirect/services/guard-redirect.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

@Injectable()
export class OidcProviderEnabledGuard implements CanActivate {
  constructor(
    private readonly twentyConfigService: TwentyConfigService,
    private readonly guardRedirectService: GuardRedirectService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    try {
      if (!this.twentyConfigService.get('AUTH_OIDC_ENABLED')) {
        throw new AuthException(
          'OIDC auth is not enabled',
          AuthExceptionCode.OIDC_AUTH_DISABLED,
        );
      }

      return true;
    } catch (err) {
      this.guardRedirectService.dispatchErrorFromGuard(
        context,
        err,
        this.guardRedirectService.getSubdomainAndCustomDomainFromContext(
          context,
        ),
      );

      return false;
    }
  }
}
