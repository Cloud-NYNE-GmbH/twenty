export enum AuthProviderEnum {
  Google = 'google',
  Microsoft = 'microsoft',
  // Generic OIDC login (e.g. self-hosted Authentik). Distinct from `SSO`,
  // which is Twenty's enterprise-licensed SAML/OIDC feature.
  Oidc = 'oidc',
  Password = 'password',
  SSO = 'sso',
  Impersonation = 'impersonation',
}
