/** Better Auth OAuth Provider 1.7.5 persistence. Protocol records are library-owned. */
import { boolean, index, integer, jsonb, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { app, pk, ts } from "./common.js";
import { authSession, authUser } from "./identity.js";

export const oauthClient = app.table(
  "oauth_client",
  {
    id: pk(),
    clientId: text("client_id").notNull(),
    clientSecret: text("client_secret"),
    clientDiscoveryId: text("client_discovery_id"),
    disabled: boolean("disabled").default(false),
    skipConsent: boolean("skip_consent"),
    enableEndSession: boolean("enable_end_session"),
    subjectType: text("subject_type"),
    scopes: text("scopes").array(),
    clientCredentialsScopes: text("client_credentials_scopes").array().default([]),
    userId: uuid("user_id").references(() => authUser.id, { onDelete: "cascade" }),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts").array(),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").array().notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
    backchannelLogoutUri: text("backchannel_logout_uri"),
    backchannelLogoutSessionRequired: boolean("backchannel_logout_session_required"),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    applicationType: text("application_type"),
    jwks: text("jwks"),
    jwksUri: text("jwks_uri"),
    grantTypes: text("grant_types").array(),
    responseTypes: text("response_types").array(),
    requirePKCE: boolean("require_pkce"),
    dpopBoundAccessTokens: boolean("dpop_bound_access_tokens").default(false),
    referenceId: text("reference_id"),
    metadata: jsonb("metadata"),
  },
  (t) => [
    uniqueIndex("oauth_client_client_id_uq").on(t.clientId),
    index("oauth_client_user_id_idx").on(t.userId),
  ],
);

export const oauthResource = app.table(
  "oauth_resource",
  {
    id: pk(),
    identifier: text("identifier").notNull(),
    name: text("name").notNull(),
    accessTokenTtl: integer("access_token_ttl"),
    refreshTokenTtl: integer("refresh_token_ttl"),
    signingAlgorithm: text("signing_algorithm"),
    signingKeyId: text("signing_key_id"),
    allowedScopes: text("allowed_scopes").array(),
    customClaims: jsonb("custom_claims"),
    dpopBoundAccessTokensRequired: boolean("dpop_bound_access_tokens_required").default(false),
    disabled: boolean("disabled").default(false),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
    policyVersion: integer("policy_version").default(1),
    metadata: jsonb("metadata"),
  },
  (t) => [uniqueIndex("oauth_resource_identifier_uq").on(t.identifier)],
);

export const oauthClientResource = app.table(
  "oauth_client_resource",
  {
    id: pk(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: "cascade" }),
    metadata: jsonb("metadata"),
    createdAt: ts("created_at"),
  },
  (t) => [
    index("oauth_client_resource_client_id_idx").on(t.clientId),
    index("oauth_client_resource_resource_id_idx").on(t.resourceId),
    uniqueIndex("oauth_client_resource_pair_uq").on(t.clientId, t.resourceId),
  ],
);

export const oauthRefreshToken = app.table(
  "oauth_refresh_token",
  {
    id: pk(),
    token: text("token").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => authSession.id, { onDelete: "set null" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull(),
    revoked: ts("revoked"),
    rotatedAt: ts("rotated_at"),
    rotationReplayResponse: text("rotation_replay_response"),
    rotationReplayExpiresAt: ts("rotation_replay_expires_at"),
    authTime: ts("auth_time"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (t) => [
    uniqueIndex("oauth_refresh_token_token_uq").on(t.token),
    index("oauth_refresh_token_client_id_idx").on(t.clientId),
    index("oauth_refresh_token_session_id_idx").on(t.sessionId),
    index("oauth_refresh_token_user_id_idx").on(t.userId),
    index("oauth_refresh_token_authorization_code_id_idx").on(t.authorizationCodeId),
  ],
);

export const oauthAccessToken = app.table(
  "oauth_access_token",
  {
    id: pk(),
    token: text("token").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => authSession.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => authUser.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    refreshId: uuid("refresh_id").references(() => oauthRefreshToken.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull(),
    revoked: ts("revoked"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (t) => [
    uniqueIndex("oauth_access_token_token_uq").on(t.token),
    index("oauth_access_token_client_id_idx").on(t.clientId),
    index("oauth_access_token_session_id_idx").on(t.sessionId),
    index("oauth_access_token_user_id_idx").on(t.userId),
    index("oauth_access_token_authorization_code_id_idx").on(t.authorizationCodeId),
    index("oauth_access_token_refresh_id_idx").on(t.refreshId),
  ],
);

export const oauthConsent = app.table(
  "oauth_consent",
  {
    id: pk(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => authUser.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    scopes: text("scopes").array().notNull(),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    index("oauth_consent_client_id_idx").on(t.clientId),
    index("oauth_consent_user_id_idx").on(t.userId),
  ],
);

export const oauthClientAssertion = app.table("oauth_client_assertion", {
  id: text("id").primaryKey(),
  expiresAt: ts("expires_at").notNull(),
});
