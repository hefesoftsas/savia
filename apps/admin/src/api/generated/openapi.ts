export interface paths {
  "/api/auth/request-password-reset": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Request a password-reset email
     * @description Requests a short-lived password-reset link. The response is intentionally the same whether or not the email belongs to a Savia user.
     */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            /** Format: email */
            email: string;
            /** Format: uri */
            redirectTo?: string;
          };
        };
      };
      responses: {
        /** @description Password-reset request accepted */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid request */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Authentication service is unavailable */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/auth/reset-password": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Set a password from a reset token
     * @description Consumes the one-time token from a password-reset link and revokes the user's existing sessions.
     */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            token: string;
            newPassword: string;
          };
        };
      };
      responses: {
        /** @description Password reset */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid or expired token, or invalid password */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Authentication service is unavailable */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/auth/sign-in/email": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Start a Better Auth session
     * @description Signs in with email and password. The first-party savia.session_token cookie returned by this operation authorizes the rest of the Scalar session.
     */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            /** Format: email */
            email: string;
            password: string;
          };
        };
      };
      responses: {
        /** @description Authenticated session */
        200: {
          headers: {
            /** @description First-party Better Auth session cookie */
            "set-cookie"?: string;
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid email or password */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Authentication service is unavailable */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/auth/two-factor/enable": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Enroll TOTP multi-factor authentication
     * @description Starts TOTP enrollment for the active session. Scan the returned URI with an authenticator app, keep the recovery codes offline, then complete enrollment with the verification operation.
     */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            password: string;
            /** @enum {string} */
            method: "totp";
          };
        };
      };
      responses: {
        /** @description TOTP URI and one-time recovery codes */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** @enum {string} */
              method: "totp";
              /** Format: uri */
              totpURI: string;
              backupCodes: string[];
            };
          };
        };
        /** @description An active session and current password are required */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Authentication service is unavailable */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/auth/two-factor/verify-totp": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Complete a TOTP challenge
     * @description Completes either enrollment or an interrupted sign-in. The browser must retain the short-lived Better Auth challenge cookie set by the previous operation.
     */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            code: string;
          };
        };
      };
      responses: {
        /** @description MFA challenge accepted and session created */
        200: {
          headers: {
            /** @description Authenticated Better Auth session cookie */
            "set-cookie"?: string;
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description The challenge or TOTP code is invalid */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Authentication service is unavailable */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/auth/two-factor/verify-backup-code": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Complete a recovery-code challenge
     * @description Completes an interrupted sign-in with one unused recovery code. The browser must retain the short-lived Better Auth challenge cookie set by the previous operation.
     */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            code: string;
          };
        };
      };
      responses: {
        /** @description Recovery code accepted and session created */
        200: {
          headers: {
            /** @description Authenticated Better Auth session cookie */
            "set-cookie"?: string;
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description The challenge or recovery code is invalid */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Authentication service is unavailable */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/health": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Worker and D1 are available */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** @enum {string} */
              status: "ok";
              /** @enum {string} */
              database: "ok";
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/identity/me": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get current identity
     * @description Returns the Better Auth identity and Savia authorization memberships.
     */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Authenticated principal */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                /** @enum {string} */
                kind: "identity-principal";
                attributes: {
                  /** Format: email */
                  email: string;
                  displayName: string;
                  isActive: boolean;
                  globalRoles: "platform_admin"[];
                };
                relationships: {
                  memberships: {
                    id: string;
                    /** @enum {string} */
                    role:
                      "tenant_admin" | "agency_admin" | "operator" | "viewer";
                    attributes: {
                      isActive: boolean;
                    };
                    relationships: {
                      tenant: {
                        id: string;
                      };
                      agency: {
                        id: string;
                      };
                    };
                  }[];
                };
              };
            };
          };
        };
        /** @description Bearer token is missing or invalid */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/identity/users": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List Savia users
     * @description Lists locally provisioned Better Auth users and their memberships.
     */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Provisioned users */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                /** @enum {string} */
                kind: "identity-principal";
                attributes: {
                  /** Format: email */
                  email: string;
                  displayName: string;
                  isActive: boolean;
                  globalRoles: "platform_admin"[];
                  account: {
                    /** @enum {string} */
                    role: "admin" | "user";
                    isBanned: boolean;
                    twoFactorEnabled: boolean;
                  };
                };
                relationships: {
                  memberships: {
                    id: string;
                    /** @enum {string} */
                    role:
                      "tenant_admin" | "agency_admin" | "operator" | "viewer";
                    attributes: {
                      isActive: boolean;
                    };
                    relationships: {
                      tenant: {
                        id: string;
                      };
                      agency: {
                        id: string;
                      };
                    };
                  }[];
                };
              }[];
            };
          };
        };
        /** @description Platform administrator role is required */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    put?: never;
    /**
     * Provision a Better Auth user
     * @description Creates a Better Auth user and a Savia principal in a commercial tenant, or in the internal platform tenant for a platform administrator.
     */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            /** Format: email */
            email: string;
            firstName: string;
            lastName: string;
            /** @default false */
            platformAdmin?: boolean;
            temporaryPassword?: string;
            membership?: {
              tenantId?: number;
              agencyId?: number;
              /** @enum {string} */
              role: "tenant_admin" | "agency_admin" | "operator" | "viewer";
            };
          };
        };
      };
      responses: {
        /** @description Provisioned user without password data */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                /** @enum {string} */
                kind: "identity-principal";
                attributes: {
                  /** Format: email */
                  email: string;
                  displayName: string;
                  isActive: boolean;
                  globalRoles: "platform_admin"[];
                  account: {
                    /** @enum {string} */
                    role: "admin" | "user";
                    isBanned: boolean;
                    twoFactorEnabled: boolean;
                  };
                };
                relationships: {
                  memberships: {
                    id: string;
                    /** @enum {string} */
                    role:
                      "tenant_admin" | "agency_admin" | "operator" | "viewer";
                    attributes: {
                      isActive: boolean;
                    };
                    relationships: {
                      tenant: {
                        id: string;
                      };
                      agency: {
                        id: string;
                      };
                    };
                  }[];
                };
              };
            };
          };
        };
        /** @description Platform administrator role is required */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Tenant was not found */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Tenant membership invariant prevented provisioning */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Better Auth provisioning is unavailable */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/identity/users/{principalId}/memberships": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Assign tenant access
     * @description Assigns the user to one tenant or updates the existing tenant role.
     */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          principalId: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            tenantId?: number;
            agencyId?: number;
            /** @enum {string} */
            role: "tenant_admin" | "agency_admin" | "operator" | "viewer";
          };
        };
      };
      responses: {
        /** @description User with updated tenant assignment */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                /** @enum {string} */
                kind: "identity-principal";
                attributes: {
                  /** Format: email */
                  email: string;
                  displayName: string;
                  isActive: boolean;
                  globalRoles: "platform_admin"[];
                  account: {
                    /** @enum {string} */
                    role: "admin" | "user";
                    isBanned: boolean;
                    twoFactorEnabled: boolean;
                  };
                };
                relationships: {
                  memberships: {
                    id: string;
                    /** @enum {string} */
                    role:
                      "tenant_admin" | "agency_admin" | "operator" | "viewer";
                    attributes: {
                      isActive: boolean;
                    };
                    relationships: {
                      tenant: {
                        id: string;
                      };
                      agency: {
                        id: string;
                      };
                    };
                  }[];
                };
              };
            };
          };
        };
        /** @description Platform administrator role is required */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Identity principal or tenant was not found */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description User already belongs to another tenant */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/identity/users/{principalId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get a Savia user */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          principalId: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description User with account and access state */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                /** @enum {string} */
                kind: "identity-principal";
                attributes: {
                  /** Format: email */
                  email: string;
                  displayName: string;
                  isActive: boolean;
                  globalRoles: "platform_admin"[];
                  account: {
                    /** @enum {string} */
                    role: "admin" | "user";
                    isBanned: boolean;
                    twoFactorEnabled: boolean;
                  };
                };
                relationships: {
                  memberships: {
                    id: string;
                    /** @enum {string} */
                    role:
                      "tenant_admin" | "agency_admin" | "operator" | "viewer";
                    attributes: {
                      isActive: boolean;
                    };
                    relationships: {
                      tenant: {
                        id: string;
                      };
                      agency: {
                        id: string;
                      };
                    };
                  }[];
                };
              };
            };
          };
        };
        /** @description Platform administrator role is required */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Identity principal was not found */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    put?: never;
    post?: never;
    /**
     * Delete a Savia user
     * @description Removes the Better Auth account and its Savia principal memberships.
     */
    delete: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          principalId: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description User removed from Better Auth and Savia */
        204: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Platform administrator role is required */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Identity principal was not found */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    options?: never;
    head?: never;
    /** Update a Savia user and platform role */
    patch: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          principalId: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            firstName?: string;
            lastName?: string;
            platformAdmin?: boolean;
            membership?: {
              tenantId?: number;
              agencyId?: number;
              /** @enum {string} */
              role: "tenant_admin" | "agency_admin" | "operator" | "viewer";
            };
          };
        };
      };
      responses: {
        /** @description Updated user */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                /** @enum {string} */
                kind: "identity-principal";
                attributes: {
                  /** Format: email */
                  email: string;
                  displayName: string;
                  isActive: boolean;
                  globalRoles: "platform_admin"[];
                  account: {
                    /** @enum {string} */
                    role: "admin" | "user";
                    isBanned: boolean;
                    twoFactorEnabled: boolean;
                  };
                };
                relationships: {
                  memberships: {
                    id: string;
                    /** @enum {string} */
                    role:
                      "tenant_admin" | "agency_admin" | "operator" | "viewer";
                    attributes: {
                      isActive: boolean;
                    };
                    relationships: {
                      tenant: {
                        id: string;
                      };
                      agency: {
                        id: string;
                      };
                    };
                  }[];
                };
              };
            };
          };
        };
        /** @description The update is invalid or would remove the final administrator */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Platform administrator role is required */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Identity principal was not found */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    trace?: never;
  };
  "/v1/identity/users/{principalId}/memberships/{agencyId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** Remove tenant access */
    delete: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          principalId: string;
          agencyId: number;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Tenant assignment removed */
        204: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/identity/users/{principalId}/suspension": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Suspend a Savia user */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          principalId: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Account blocked and sessions revoked */
        204: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    /** Reactivate a Savia user */
    delete: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          principalId: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Account reactivated */
        204: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/identity/users/{principalId}/sessions/revoke": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Revoke user sessions */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          principalId: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description All user sessions revoked */
        204: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/identity/users/{principalId}/password-reset": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Send a password reset link */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          principalId: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Password reset link accepted for delivery */
        204: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/identity/oauth-clients": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List OAuth clients */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description OAuth clients without secrets */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {string} */
                applicationType: "native" | "web";
                /** @enum {string} */
                clientAuthentication:
                  "none" | "client_secret_basic" | "client_secret_post";
                clientId: string;
                clientName: string;
                redirectUris: string[];
                scopes: string[];
                trusted: boolean;
              }[];
            };
          };
        };
        /** @description Platform administrator role is required */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    put?: never;
    /** Create an OAuth client */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            /** @enum {string} */
            clientAuthentication:
              "none" | "client_secret_basic" | "client_secret_post";
            clientName: string;
            redirectUris: string[];
            scopes: string[];
            /** @default false */
            trusted?: boolean;
          };
        };
      };
      responses: {
        /** @description Client; a confidential client secret is returned only once */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {string} */
                applicationType: "native" | "web";
                /** @enum {string} */
                clientAuthentication:
                  "none" | "client_secret_basic" | "client_secret_post";
                clientId: string;
                clientName: string;
                redirectUris: string[];
                scopes: string[];
                trusted: boolean;
                clientSecret?: string;
              };
            };
          };
        };
        /** @description Platform administrator role is required */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/identity/oauth-clients/{clientId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** Disable an OAuth client */
    delete: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          clientId: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Client disabled */
        204: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    options?: never;
    head?: never;
    /** Update an OAuth client */
    patch: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          clientId: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            clientName?: string;
            redirectUris?: string[];
            scopes?: string[];
            /** @default false */
            trusted?: boolean;
          };
        };
      };
      responses: {
        /** @description Client without a secret */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {string} */
                applicationType: "native" | "web";
                /** @enum {string} */
                clientAuthentication:
                  "none" | "client_secret_basic" | "client_secret_post";
                clientId: string;
                clientName: string;
                redirectUris: string[];
                scopes: string[];
                trusted: boolean;
              };
            };
          };
        };
      };
    };
    trace?: never;
  };
  "/v1/identity/oauth-clients/{clientId}/rotate-secret": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Rotate a confidential OAuth client secret */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          clientId: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description New secret, returned only once */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                clientId: string;
                clientSecret: string;
              };
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/realtime/ticket": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Issue a realtime subscription ticket
     * @description Returns a single-use ticket for the realtime WebSocket. The socket carries only change hints; data is refetched through the API.
     */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            topics: ("users" | "tenants" | "records")[];
            tenantId?: number;
          };
        };
      };
      responses: {
        /** @description Ticket bound to the authorized room and topics */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                room: string;
                ticket: string;
                topics: ("users" | "tenants" | "records")[];
                /** Format: date-time */
                expiresAt: string;
              };
            };
          };
        };
        /** @description Topic or tenant is not authorized for this actor */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Tenant was not found */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Realtime request or connection limit exceeded */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Realtime is not configured */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/public-forms": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query: {
          domainId: string;
          objectName: string;
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Public form response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              [key: string]: unknown;
            };
          };
        };
      };
    };
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            domainId: string;
            objectName: string;
            /** @enum {string} */
            kind: "record" | "quote";
            /** Format: date-time */
            expiresAt?: string;
            /** @default 25 */
            dailyLimit?: number;
            /** @default false */
            returnResult?: boolean;
          };
        };
      };
      responses: {
        /** @description Public form response */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              [key: string]: unknown;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/public-forms/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          id: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Public form response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              [key: string]: unknown;
            };
          };
        };
      };
    };
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/forms/{token}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          token: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Public form response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              [key: string]: unknown;
            };
          };
        };
      };
    };
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          token: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            /** Format: uuid */
            submissionId: string;
            token: string;
            values: {
              [key: string]: string | number | boolean | null;
            };
          };
        };
      };
      responses: {
        /** @description Public form response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              [key: string]: unknown;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/request-pages/runs": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Recuperar las ejecuciones propias de una página sin llamar al proveedor */
    get: {
      parameters: {
        query: {
          domainId: string;
          pageName: string;
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Historial */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                domainId: string;
                pageName: string;
                actionId: string;
                label: string;
                /** @enum {string} */
                mode: "mock" | "live";
                /** @enum {string} */
                status: "running" | "complete" | "failed";
                values: {
                  [key: string]: string | number | boolean | null;
                };
                result: components["schemas"]["RequestResult"];
                error: string | null;
                createdAt: string;
              }[];
            };
          };
        };
      };
    };
    put?: never;
    /** Ejecutar una acción configurada en una página generada */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            /** Format: uuid */
            id: string;
            domainId: string;
            pageName: string;
            actionId: string;
            /** @enum {string} */
            mode: "mock" | "live";
            values: {
              [key: string]: string | number | boolean | null;
            };
          };
        };
      };
      responses: {
        /** @description Ejecución guardada */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              id: string;
              domainId: string;
              pageName: string;
              actionId: string;
              label: string;
              /** @enum {string} */
              mode: "mock" | "live";
              /** @enum {string} */
              status: "running" | "complete" | "failed";
              values: {
                [key: string]: string | number | boolean | null;
              };
              result: components["schemas"]["RequestResult"];
              error: string | null;
              createdAt: string;
            };
          };
        };
        /** @description Solicitud rechazada */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Solicitud rechazada */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Solicitud rechazada */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Solicitud rechazada */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/request-results/flows/{flowId}/runs": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Ejecutar un flow y devolver su resultado estándar
     * @description Ejecuta una sola vez. mode=live contacta al proveedor y puede producir efectos externos; no hay reintentos automáticos. Sin versionId usa el borrador, con versionId ejecuta esa versión publicada. Conserva la respuesta original en Savia request. Solo administradores de plataforma.
     */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          flowId: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            /** @enum {string} */
            mode: "mock" | "live";
            input: {
              [key: string]: string;
            };
            /** Format: uuid */
            versionId?: string;
          };
        };
      };
      responses: {
        /** @description Resultado estándar; revisar status, errors y warnings. */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["RequestResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["RequestResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["RequestResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["RequestResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["RequestResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["RequestResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        415: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["RequestResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["RequestResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["RequestResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["RequestResult"];
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/request-results/flows/{flowId}/runs/{runId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Normalizar una ejecución guardada sin contactar al proveedor
     * @description Permite consumir o reprocesar resultados históricos por ID, incluso fuera de las últimas 20 ejecuciones. Solo administradores de plataforma.
     */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          flowId: string;
          runId: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Resultado estándar; revisar status, errors y warnings. */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["RequestResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["RequestResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["RequestResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["RequestResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["RequestResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["RequestResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        415: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["RequestResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["RequestResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["RequestResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["RequestResult"];
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/crm/providers": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List CRM providers available to the authenticated user
     * @description Lists Savia's provider registry. Provider credentials and Nango integration configuration are never returned.
     */
    get: {
      parameters: {
        query?: {
          agencyId?: number;
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Provider availability */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {string} */
                id: "hubspot" | "salesforce" | "zoho" | "pipedrive";
                /** @enum {string} */
                kind: "crm-provider";
                attributes: {
                  displayName: string;
                  /** @enum {string} */
                  availability: "enabled" | "unavailable" | "coming_soon";
                  capabilities: string[];
                };
              }[];
            };
          };
        };
        /** @description Invalid agency identifier */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description The actor cannot access CRM integrations */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/crm/connections": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List the current user’s active CRM connections */
    get: {
      parameters: {
        query?: {
          agencyId?: number;
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Active CRM connection state without Nango credentials */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                /** @enum {string} */
                kind: "crm-connection";
                attributes: {
                  agencyId: number;
                  /** @enum {string} */
                  provider: "hubspot" | "salesforce" | "zoho" | "pipedrive";
                  /** @enum {string} */
                  status:
                    | "pending"
                    | "connected"
                    | "reconnect_required"
                    | "disconnected"
                    | "failed";
                  externalAccountLabel: string | null;
                  scopes: string[];
                  lastValidatedAt: string | null;
                  createdAt: string;
                  updatedAt: string;
                };
              }[];
            };
          };
        };
        /** @description Invalid agency identifier */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description The actor cannot access CRM integrations */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/crm/connections/{provider}/connect-session": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Create a short-lived Nango Connect session
     * @description Creates a session scoped to the authenticated user and one enabled provider. The result is not a CRM credential.
     */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          provider: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            agencyId?: number;
          };
        };
      };
      responses: {
        /** @description Short-lived Connect session */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                token: string;
                expiresAt: string;
                /** Format: uri */
                connectUrl: string;
                /** Format: uri */
                apiUrl: string;
              };
            };
          };
        };
        /** @description Invalid request or Nango connection identity */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description An active tenant membership is required */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider is unknown */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider is not available yet */
        424: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider is not configured */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/crm/connections/{provider}/reconnect-session": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Create a reconnect session for an existing CRM connection */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          provider: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            agencyId?: number;
          };
        };
      };
      responses: {
        /** @description Short-lived reconnect session */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                token: string;
                expiresAt: string;
                /** Format: uri */
                connectUrl: string;
                /** Format: uri */
                apiUrl: string;
              };
            };
          };
        };
        /** @description An active tenant membership is required */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider or connection is not found */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider is not available yet */
        424: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider is not configured */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/crm/connections/{provider}/complete": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Verify and persist a completed CRM connection */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          provider: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            agencyId?: number;
            connectionId: string;
          };
        };
      };
      responses: {
        /** @description Validated user-owned CRM connection */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                /** @enum {string} */
                kind: "crm-connection";
                attributes: {
                  agencyId: number;
                  /** @enum {string} */
                  provider: "hubspot" | "salesforce" | "zoho" | "pipedrive";
                  /** @enum {string} */
                  status:
                    | "pending"
                    | "connected"
                    | "reconnect_required"
                    | "disconnected"
                    | "failed";
                  externalAccountLabel: string | null;
                  scopes: string[];
                  lastValidatedAt: string | null;
                  createdAt: string;
                  updatedAt: string;
                };
              };
            };
          };
        };
        /** @description Nango connection does not match the requested provider */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description An active tenant membership is required */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider is unknown */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider is not available yet */
        424: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider is not configured */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/crm/connections/{provider}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** Disconnect a user CRM provider */
    delete: {
      parameters: {
        query?: {
          agencyId?: number;
        };
        header?: never;
        path: {
          provider: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Connection disconnected */
        204: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description An active tenant membership is required */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider or connection is not found */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider is not available yet */
        424: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider is not configured */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/crm/contacts": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List normalized CRM contacts
     * @description Reads contacts through the selected agency connection. Savia does not accept an arbitrary CRM path or request headers.
     */
    get: {
      parameters: {
        query: {
          agencyId: number;
          provider: string;
          limit?: number;
          search?: string;
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Normalized contacts */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                email: string | null;
                firstName: string | null;
                lastName: string | null;
                companyId: string | null;
                updatedAt: string | null;
              }[];
            };
          };
        };
        /** @description Invalid list query */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description No active membership for the agency */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description The CRM connection requires reconnection */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider is not available yet */
        424: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    put?: never;
    /** Create a normalized CRM contact */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            agencyId: number;
            provider: string;
            /** Format: email */
            email?: string;
            firstName?: string;
            lastName?: string;
            companyId?: string;
          };
        };
      };
      responses: {
        /** @description Created normalized contact */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                email: string | null;
                firstName: string | null;
                lastName: string | null;
                companyId: string | null;
                updatedAt: string | null;
              };
            };
          };
        };
        /** @description Invalid contact input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description No active membership for the agency */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description The CRM connection requires reconnection */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider is not available yet */
        424: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/crm/contacts/{contactId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /** Update a normalized CRM contact */
    patch: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          contactId: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            agencyId: number;
            provider: string;
            /** Format: email */
            email?: string;
            firstName?: string;
            lastName?: string;
            companyId?: string;
          };
        };
      };
      responses: {
        /** @description Updated normalized contact */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                email: string | null;
                firstName: string | null;
                lastName: string | null;
                companyId: string | null;
                updatedAt: string | null;
              };
            };
          };
        };
        /** @description Invalid contact input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description No active membership for the agency */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description The CRM connection requires reconnection */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider is not available yet */
        424: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    trace?: never;
  };
  "/v1/crm/companies": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List normalized CRM companies */
    get: {
      parameters: {
        query: {
          agencyId: number;
          provider: string;
          limit?: number;
          search?: string;
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Normalized companies */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                name: string | null;
                domain: string | null;
                updatedAt: string | null;
              }[];
            };
          };
        };
        /** @description Invalid list query */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description No active membership for the agency */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description The CRM connection requires reconnection */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider is not available yet */
        424: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/crm/deals": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List normalized CRM deals */
    get: {
      parameters: {
        query: {
          agencyId: number;
          provider: string;
          limit?: number;
          search?: string;
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Normalized deals */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                name: string | null;
                amount: string | null;
                stage: string | null;
                updatedAt: string | null;
              }[];
            };
          };
        };
        /** @description Invalid list query */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description No active membership for the agency */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description The CRM connection requires reconnection */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider is not available yet */
        424: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/crm/sync-rules": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List my customer synchronization rules and authorized tenants */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Resultado */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                rules: {
                  id: string;
                  tenantId: number;
                  tenantName: string;
                  provider: string;
                  accountLabel: string;
                  enabled: boolean;
                  connectionId: string;
                  createdAt: string;
                }[];
                tenants: {
                  id: number;
                  name: string;
                }[];
              };
            };
          };
        };
      };
    };
    put?: never;
    /** Enable automatic HubSpot customer synchronization */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            tenantId: number;
            /** @enum {string} */
            provider: "hubspot";
          };
        };
      };
      responses: {
        /** @description Resultado */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                tenantId: number;
                tenantName: string;
                provider: string;
                accountLabel: string;
                enabled: boolean;
                connectionId: string;
                createdAt: string;
              };
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/crm/sync-rules/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** Delete an automatic synchronization rule */
    delete: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          id: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Synchronization rule deleted */
        204: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    options?: never;
    head?: never;
    /** Enable or pause an automatic synchronization rule */
    patch: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          id: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            enabled: boolean;
          };
        };
      };
      responses: {
        /** @description Resultado */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                tenantId: number;
                tenantName: string;
                provider: string;
                accountLabel: string;
                enabled: boolean;
                connectionId: string;
                createdAt: string;
              };
            };
          };
        };
      };
    };
    trace?: never;
  };
  "/v1/crm/sync-jobs": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read recent automatic synchronization outcomes */
    get: {
      parameters: {
        query?: {
          customerId?: number;
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Resultado */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                ruleId: string;
                customerId: number;
                provider: string;
                status: string;
                attempts: number;
                lastError: string | null;
                updatedAt: string;
                externalUrl: string | null;
              }[];
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/crm/sync-jobs/{id}/retry": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Retry a known failed automatic synchronization */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          id: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Resultado */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {boolean} */
                queued: true;
              };
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/data-domains": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List authorized data domains */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Domains */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                label: string;
                /** @enum {string} */
                kind: "platform" | "custom" | "agency" | "tenant";
                agencyId?: number;
                tenantId?: number;
                apiBasePath: string;
              }[];
            };
          };
        };
        /** @description Solicitud rechazada */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Solicitud rechazada */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Solicitud rechazada */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Solicitud rechazada */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
      };
    };
    put?: never;
    /** Create an independent data domain */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            name: string;
            label: string;
          };
        };
      };
      responses: {
        /** @description Created */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                label: string;
                /** @enum {string} */
                kind: "platform" | "custom" | "agency" | "tenant";
                agencyId?: number;
                tenantId?: number;
                apiBasePath: string;
              };
            };
          };
        };
        /** @description Solicitud rechazada */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Solicitud rechazada */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Solicitud rechazada */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Solicitud rechazada */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/personal-integrations/providers": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List personal Google and Microsoft integrations
     * @description Lists the personal provider registry without returning Nango credentials or integration identifiers.
     */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Personal provider availability */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {string} */
                id:
                  | "google_drive"
                  | "gmail"
                  | "google_calendar"
                  | "outlook"
                  | "onedrive_personal"
                  | "onedrive_business";
                /** @enum {string} */
                kind: "personal-integration-provider";
                attributes: {
                  displayName: string;
                  /** @enum {string} */
                  availability: "enabled" | "unavailable";
                  capabilities: string[];
                };
              }[];
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/personal-integrations/connections": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List the caller's personal integrations */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Safe personal integration connection state */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                /** @enum {string} */
                kind: "personal-integration-connection";
                attributes: {
                  /** @enum {string} */
                  provider:
                    | "google_drive"
                    | "gmail"
                    | "google_calendar"
                    | "outlook"
                    | "onedrive_personal"
                    | "onedrive_business";
                  /** @enum {string} */
                  status:
                    | "pending"
                    | "connected"
                    | "reconnect_required"
                    | "disconnected"
                    | "failed";
                  externalAccountLabel: string | null;
                  scopes: string[];
                  lastValidatedAt: string | null;
                  createdAt: string;
                  updatedAt: string;
                };
              }[];
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/personal-integrations/connections/{provider}/connect-session": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Create a personal Nango Connect session */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          provider: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Short-lived Nango Connect session */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                token: string;
                expiresAt: string;
                /** Format: uri */
                connectUrl: string;
                /** Format: uri */
                apiUrl: string;
              };
            };
          };
        };
        /** @description Provider not found */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider unavailable */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/personal-integrations/connections/{provider}/complete": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Validate and persist a caller-owned Nango connection */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          provider: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            connectionId: string;
          };
        };
      };
      responses: {
        /** @description Validated personal connection */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                /** @enum {string} */
                kind: "personal-integration-connection";
                attributes: {
                  /** @enum {string} */
                  provider:
                    | "google_drive"
                    | "gmail"
                    | "google_calendar"
                    | "outlook"
                    | "onedrive_personal"
                    | "onedrive_business";
                  /** @enum {string} */
                  status:
                    | "pending"
                    | "connected"
                    | "reconnect_required"
                    | "disconnected"
                    | "failed";
                  externalAccountLabel: string | null;
                  scopes: string[];
                  lastValidatedAt: string | null;
                  createdAt: string;
                  updatedAt: string;
                };
              };
            };
          };
        };
        /** @description Connection belongs to a different user */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider not found */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider unavailable */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/personal-integrations/connections/{provider}/reconnect-session": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Create a reconnect session for the caller's personal connection */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          provider: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Short-lived Nango reconnect session */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                token: string;
                expiresAt: string;
                /** Format: uri */
                connectUrl: string;
                /** Format: uri */
                apiUrl: string;
              };
            };
          };
        };
        /** @description Provider or connection not found */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider unavailable */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/personal-integrations/connections/{provider}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** Disconnect the caller's personal integration */
    delete: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          provider: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Connection disconnected */
        204: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider or connection not found */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider unavailable */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/personal-integrations/files": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Search files in a caller-owned personal drive */
    get: {
      parameters: {
        query: {
          provider: "google_drive" | "onedrive_personal" | "onedrive_business";
          query: string;
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description On-demand file metadata */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                name: string;
                mimeType: string | null;
                modifiedAt: string | null;
              }[];
            };
          };
        };
        /** @description Connection belongs to a different user */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Connection is not ready */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider request failed */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider or connection unavailable */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/personal-integrations/actions/{actionId}/execute": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Execute an already-confirmed personal integration action
     * @description Loads the pending action server-side. It accepts no email or event payload and only runs once the owner has explicitly confirmed it through Savia Assistant.
     */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          actionId: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Confirmed action submitted to the connected provider */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {string} */
                provider:
                  | "google_drive"
                  | "gmail"
                  | "outlook"
                  | "google_calendar"
                  | "onedrive_personal"
                  | "onedrive_business";
                /** @enum {string} */
                action: "send-email" | "create-event" | "upload-file";
              };
            };
          };
        };
        /** @description Invalid stored action */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Action is not awaiting one permitted execution */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider request failed */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider or connection unavailable */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/personal-integrations/messages": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Search message metadata in a caller-owned mailbox */
    get: {
      parameters: {
        query: {
          provider: "gmail" | "outlook";
          query: string;
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description On-demand message metadata */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                subject: string | null;
                sender: string | null;
                receivedAt: string | null;
              }[];
            };
          };
        };
        /** @description Connection belongs to a different user */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider request failed */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider or connection unavailable */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/personal-integrations/events": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List events in a caller-owned calendar */
    get: {
      parameters: {
        query: {
          provider: "google_calendar" | "outlook";
          from?: string;
          to?: string;
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description On-demand calendar events */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                title: string | null;
                startsAt: string | null;
                endsAt: string | null;
                /** Format: uri */
                webLink: string | null;
              }[];
            };
          };
        };
        /** @description Connection belongs to a different user */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider request failed */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider or connection unavailable */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    put?: never;
    /**
     * Create a caller-confirmed calendar event
     * @description Creates a Google Calendar or Outlook event only after the caller has explicitly confirmed the event details in Savia.
     */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            /** @enum {string} */
            provider: "google_calendar" | "outlook";
            title: string;
            startsAt: string;
            endsAt: string;
          };
        };
      };
      responses: {
        /** @description Calendar event created for the caller */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                title: string | null;
                startsAt: string | null;
                endsAt: string | null;
                /** Format: uri */
                webLink: string | null;
              };
            };
          };
        };
        /** @description Invalid event details */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider request failed */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Provider or connection unavailable */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/user-preferences/sidebar-navigation": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read the caller's sidebar navigation layout */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Sidebar navigation layout */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {number} */
                version: 2;
                blocks: (
                  | {
                      /** @enum {string} */
                      kind: "builtin";
                      /** @enum {string} */
                      id:
                        | "operation"
                        | "productivity"
                        | "administration"
                        | "management";
                      items: (
                        | (
                            | "dashboard"
                            | "dynamic-crm"
                            | "my-day"
                            | "integrations"
                            | "provider-credentials"
                            | "assistant-configuration"
                            | "service-credentials"
                            | "users"
                            | "tenants"
                            | "page-administrator"
                          )
                        | string
                      )[];
                      collapsed: boolean;
                    }
                  | {
                      /** @enum {string} */
                      kind: "custom";
                      id: string;
                      label: string;
                      items: (
                        | (
                            | "dashboard"
                            | "dynamic-crm"
                            | "my-day"
                            | "integrations"
                            | "provider-credentials"
                            | "assistant-configuration"
                            | "service-credentials"
                            | "users"
                            | "tenants"
                            | "page-administrator"
                          )
                        | string
                      )[];
                      collapsed: boolean;
                    }
                )[];
                hiddenItems?: (
                  | (
                      | "dashboard"
                      | "dynamic-crm"
                      | "my-day"
                      | "integrations"
                      | "provider-credentials"
                      | "assistant-configuration"
                      | "service-credentials"
                      | "users"
                      | "tenants"
                      | "page-administrator"
                    )
                  | string
                )[];
              };
            };
          };
        };
      };
    };
    /** Save the caller's sidebar navigation layout */
    put: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": unknown;
        };
      };
      responses: {
        /** @description Saved sidebar navigation layout */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {number} */
                version: 2;
                blocks: (
                  | {
                      /** @enum {string} */
                      kind: "builtin";
                      /** @enum {string} */
                      id:
                        | "operation"
                        | "productivity"
                        | "administration"
                        | "management";
                      items: (
                        | (
                            | "dashboard"
                            | "dynamic-crm"
                            | "my-day"
                            | "integrations"
                            | "provider-credentials"
                            | "assistant-configuration"
                            | "service-credentials"
                            | "users"
                            | "tenants"
                            | "page-administrator"
                          )
                        | string
                      )[];
                      collapsed: boolean;
                    }
                  | {
                      /** @enum {string} */
                      kind: "custom";
                      id: string;
                      label: string;
                      items: (
                        | (
                            | "dashboard"
                            | "dynamic-crm"
                            | "my-day"
                            | "integrations"
                            | "provider-credentials"
                            | "assistant-configuration"
                            | "service-credentials"
                            | "users"
                            | "tenants"
                            | "page-administrator"
                          )
                        | string
                      )[];
                      collapsed: boolean;
                    }
                )[];
                hiddenItems?: (
                  | (
                      | "dashboard"
                      | "dynamic-crm"
                      | "my-day"
                      | "integrations"
                      | "provider-credentials"
                      | "assistant-configuration"
                      | "service-credentials"
                      | "users"
                      | "tenants"
                      | "page-administrator"
                    )
                  | string
                )[];
              };
            };
          };
        };
        /** @description Invalid sidebar navigation layout */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                /** @enum {string} */
                code: "INVALID_SIDEBAR_NAVIGATION";
                message: string;
              };
            };
          };
        };
      };
    };
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/user-preferences/appearance": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read the caller's appearance preferences */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Appearance preferences */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {number} */
                version: 1;
                /** @enum {string} */
                theme: "light" | "dark" | "system";
                /** @enum {string} */
                colorTheme:
                  | "emerald"
                  | "blue"
                  | "indigo"
                  | "violet"
                  | "rose"
                  | "teal"
                  | "sky"
                  | "orange"
                  | "amber"
                  | "neutral"
                  | "stone"
                  | "zinc"
                  | "mauve"
                  | "olive"
                  | "mist"
                  | "taupe";
              };
            };
          };
        };
      };
    };
    /** Save the caller's appearance preferences */
    put: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": unknown;
        };
      };
      responses: {
        /** @description Saved appearance preferences */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {number} */
                version: 1;
                /** @enum {string} */
                theme: "light" | "dark" | "system";
                /** @enum {string} */
                colorTheme:
                  | "emerald"
                  | "blue"
                  | "indigo"
                  | "violet"
                  | "rose"
                  | "teal"
                  | "sky"
                  | "orange"
                  | "amber"
                  | "neutral"
                  | "stone"
                  | "zinc"
                  | "mauve"
                  | "olive"
                  | "mist"
                  | "taupe";
              };
            };
          };
        };
        /** @description Invalid appearance preferences */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                /** @enum {string} */
                code: "INVALID_APPEARANCE_PREFERENCES";
                message: string;
              };
            };
          };
        };
      };
    };
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/tenants": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List accessible tenants */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Tenants */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: number;
                idSlug: string;
                name: string;
                /** @enum {string} */
                kind: "commercial" | "platform";
                isActive: boolean;
                createdAt: string;
                updatedAt: string;
                agencyId: number | null;
              }[];
              meta: {
                total: number;
              };
            };
          };
        };
        /** @description Rejected */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Rejected */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Rejected */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Rejected */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
      };
    };
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            name: string;
            idSlug?: string;
            isActive?: boolean;
            initialUser: {
              /** Format: email */
              email: string;
              firstName: string;
              lastName: string;
              /** @enum {string} */
              role: "tenant_admin" | "agency_admin" | "operator" | "viewer";
              temporaryPassword?: string;
            };
          };
        };
      };
      responses: {
        /** @description Tenant */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: number;
                idSlug: string;
                name: string;
                /** @enum {string} */
                kind: "commercial" | "platform";
                isActive: boolean;
                createdAt: string;
                updatedAt: string;
                agencyId: number | null;
              };
            };
          };
        };
        /** @description Rejected */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Rejected */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Rejected */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Rejected */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Rejected */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/tenants/current": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get current tenant context from host */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Current workspace tenant info */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                isDedicated: boolean;
                slug: string | null;
                name: string;
                /** @enum {string} */
                kind: "commercial" | "platform";
                id: number | null;
              };
            };
          };
        };
        /** @description Rejected */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Rejected */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Rejected */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Rejected */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/tenants/{tenantId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number | null;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Tenant */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: number;
                idSlug: string;
                name: string;
                /** @enum {string} */
                kind: "commercial" | "platform";
                isActive: boolean;
                createdAt: string;
                updatedAt: string;
                agencyId: number | null;
              };
            };
          };
        };
        /** @description Rejected */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Rejected */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Rejected */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Rejected */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number | null;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Deleted */
        204: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Rejected */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Rejected */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Rejected */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Rejected */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
      };
    };
    options?: never;
    head?: never;
    patch: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number | null;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            name?: string;
            idSlug?: string;
            isActive?: boolean;
            initialUser?: {
              /** Format: email */
              email: string;
              firstName: string;
              lastName: string;
              /** @enum {string} */
              role: "tenant_admin" | "agency_admin" | "operator" | "viewer";
              temporaryPassword?: string;
            };
          };
        };
      };
      responses: {
        /** @description Tenant */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: number;
                idSlug: string;
                name: string;
                /** @enum {string} */
                kind: "commercial" | "platform";
                isActive: boolean;
                createdAt: string;
                updatedAt: string;
                agencyId: number | null;
              };
            };
          };
        };
        /** @description Rejected */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Rejected */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Rejected */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Rejected */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
      };
    };
    trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    RequestResult: {
      /** @enum {string} */
      schemaVersion: "1.0";
      type: string;
      /** @enum {string} */
      status: "success" | "partial" | "no_result" | "error" | "pending";
      data?: unknown;
      errors: {
        code: string;
        message: string;
        field: string | null;
      }[];
      warnings: {
        code: string;
        message: string;
        field: string | null;
      }[];
      metadata: {
        provider: string | null;
        flowId: string | null;
        runId: string | null;
        versionId: string | null;
        createdAt: string | null;
        simulated: boolean | null;
        adapter: string | null;
        providerFields: {
          [key: string]: unknown;
        };
      };
    } | null;
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
