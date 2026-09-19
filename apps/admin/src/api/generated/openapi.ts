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
    /** Enable customer create/update synchronization to my connected HubSpot account */
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
    /** Delete my synchronization rule */
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
    /** Enable or pause my synchronization rule */
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
    /** Read my recent customer synchronization outcomes */
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
    /** Retry a known failed synchronization */
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
                            | "service-credentials" | "access-control"
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
                            | "service-credentials" | "access-control"
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
                      | "service-credentials" | "access-control"
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
                            | "service-credentials" | "access-control"
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
                            | "service-credentials" | "access-control"
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
                      | "service-credentials" | "access-control"
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
  "/v1/insurance-results/flows/{flowId}/runs": {
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
     * @description Ejecuta una sola vez. mode=live contacta al proveedor y puede crear una cotización; no hay reintentos automáticos. Sin versionId usa el borrador, con versionId ejecuta esa versión publicada. Conserva la respuesta original en Savia request. Solo administradores de plataforma.
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
            "application/json": components["schemas"]["InsuranceResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["InsuranceResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["InsuranceResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["InsuranceResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["InsuranceResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["InsuranceResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        415: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["InsuranceResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["InsuranceResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["InsuranceResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["InsuranceResult"];
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
  "/v1/insurance-results/flows/{flowId}/runs/{runId}": {
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
            "application/json": components["schemas"]["InsuranceResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["InsuranceResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["InsuranceResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["InsuranceResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["InsuranceResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["InsuranceResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        415: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["InsuranceResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["InsuranceResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["InsuranceResult"];
          };
        };
        /** @description Resultado estándar; revisar status, errors y warnings. */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": components["schemas"]["InsuranceResult"];
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
  "/v1/domains": {
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
        /** @description Available domain collections */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                collections: {
                  domain: string;
                  collection: string;
                  title: string;
                  description: string;
                }[];
                commands: {
                  domain: string;
                  command: string;
                  title: string;
                  description: string;
                  input: {
                    name: string;
                    /** @enum {string} */
                    type: "string" | "integer" | "number" | "boolean" | "array";
                    required: boolean;
                    description: string;
                  }[];
                }[];
              }[];
            };
          };
        };
        /** @description Active membership is required */
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
  "/v1/document-storage/attachments": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List private attachments
     * @description Private file metadata linked to a domain aggregate.
     */
    get: operations["listDocumentStorageAttachments"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/document-storage/attachments/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get private attachments
     * @description Private file metadata linked to a domain aggregate.
     */
    get: operations["getDocumentStorageAttachments"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/geographic-catalog/countries": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List geographic countries
     * @description Reference countries available for agency and customer locations.
     */
    get: operations["listGeographicCatalogCountries"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/geographic-catalog/countries/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get geographic countries
     * @description Reference countries available for agency and customer locations.
     */
    get: operations["getGeographicCatalogCountries"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/geographic-catalog/departments": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List geographic departments
     * @description Reference departments linked to their country.
     */
    get: operations["listGeographicCatalogDepartments"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/geographic-catalog/departments/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get geographic departments
     * @description Reference departments linked to their country.
     */
    get: operations["getGeographicCatalogDepartments"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/geographic-catalog/cities": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List geographic cities
     * @description Reference cities linked to their department and country.
     */
    get: operations["listGeographicCatalogCities"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/geographic-catalog/cities/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get geographic cities
     * @description Reference cities linked to their department and country.
     */
    get: operations["getGeographicCatalogCities"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/reference-values/currencies": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List currencies
     * @description Read-only currency values defined by the source insurance domain.
     */
    get: operations["listReferenceValuesCurrencies"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/reference-values/currencies/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get currencies
     * @description Read-only currency values defined by the source insurance domain.
     */
    get: operations["getReferenceValuesCurrencies"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/reference-values/identification-types": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List identification types
     * @description Read-only identification values for natural, legal, and incomplete clients.
     */
    get: operations["listReferenceValuesIdentificationTypes"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/reference-values/identification-types/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get identification types
     * @description Read-only identification values for natural, legal, and incomplete clients.
     */
    get: operations["getReferenceValuesIdentificationTypes"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/reference-values/person-attributes": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List person attributes
     * @description Read-only gender and marital-status values for natural-person profiles.
     */
    get: operations["listReferenceValuesPersonAttributes"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/reference-values/person-attributes/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get person attributes
     * @description Read-only gender and marital-status values for natural-person profiles.
     */
    get: operations["getReferenceValuesPersonAttributes"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/finance-reference/banks": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List banks
     * @description Banks selectable in seller and payment details.
     */
    get: operations["listFinanceReferenceBanks"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/finance-reference/banks/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get banks
     * @description Banks selectable in seller and payment details.
     */
    get: operations["getFinanceReferenceBanks"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/finance-reference/economic-activities": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List economic activities
     * @description Economic activity codes selectable for legal customers.
     */
    get: operations["listFinanceReferenceEconomicActivities"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/finance-reference/economic-activities/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get economic activities
     * @description Economic activity codes selectable for legal customers.
     */
    get: operations["getFinanceReferenceEconomicActivities"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/operations-catalog/task-types": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List task types
     * @description Workflow task types selectable by operations.
     */
    get: operations["listOperationsCatalogTaskTypes"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/operations-catalog/task-types/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get task types
     * @description Workflow task types selectable by operations.
     */
    get: operations["getOperationsCatalogTaskTypes"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/operations-catalog/task-tags": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List task tags
     * @description Global or agency-scoped labels selectable on tasks.
     */
    get: operations["listOperationsCatalogTaskTags"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/operations-catalog/task-tags/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get task tags
     * @description Global or agency-scoped labels selectable on tasks.
     */
    get: operations["getOperationsCatalogTaskTags"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/agency-network/agency-profiles": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List agency profiles
     * @description Agency aggregates with people, offices, and locations.
     */
    get: operations["listAgencyNetworkAgencyProfiles"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/agency-network/agency-profiles/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get agency profiles
     * @description Agency aggregates with people, offices, and locations.
     */
    get: operations["getAgencyNetworkAgencyProfiles"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/insurance-catalog/insurance-partners": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List insurance partners
     * @description Insurance organizations and their operational channels.
     */
    get: operations["listInsuranceCatalogInsurancePartners"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/insurance-catalog/insurance-partners/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get insurance partners
     * @description Insurance organizations and their operational channels.
     */
    get: operations["getInsuranceCatalogInsurancePartners"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/insurance-catalog/product-lines": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List insurance product lines
     * @description Product-line aggregates with their business classification.
     */
    get: operations["listInsuranceCatalogProductLines"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/insurance-catalog/product-lines/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get insurance product lines
     * @description Product-line aggregates with their business classification.
     */
    get: operations["getInsuranceCatalogProductLines"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/customer-portfolio/customer-profiles": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List customer profiles
     * @description Customers enrolled with an agency and their personal profile.
     */
    get: operations["listCustomerPortfolioCustomerProfiles"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/customer-portfolio/customer-profiles/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get customer profiles
     * @description Customers enrolled with an agency and their personal profile.
     */
    get: operations["getCustomerPortfolioCustomerProfiles"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/sales-pipeline/quotes": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List insurance quotes
     * @description Commercial insurance quotations with their customer and offer.
     */
    get: operations["listSalesPipelineQuotes"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/sales-pipeline/quotes/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get insurance quotes
     * @description Commercial insurance quotations with their customer and offer.
     */
    get: operations["getSalesPipelineQuotes"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/policy-lifecycle/policies": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List insurance policies
     * @description Issued policies with product line, customer, and terms.
     */
    get: operations["listPolicyLifecyclePolicies"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/policy-lifecycle/policies/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get insurance policies
     * @description Issued policies with product line, customer, and terms.
     */
    get: operations["getPolicyLifecyclePolicies"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/collections/payments": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List policy payments
     * @description Collection installments connected to policy terms.
     */
    get: operations["listCollectionsPayments"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/collections/payments/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get policy payments
     * @description Collection installments connected to policy terms.
     */
    get: operations["getCollectionsPayments"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/claims/claims": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List insurance claims
     * @description Claims attached to an insurance policy and its status flow.
     */
    get: operations["listClaimsClaims"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/claims/claims/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get insurance claims
     * @description Claims attached to an insurance policy and its status flow.
     */
    get: operations["getClaimsClaims"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/insurance-catalog/product-categories": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List insurance product categories
     * @description Top-level insurance product classifications.
     */
    get: operations["listInsuranceCatalogProductCategories"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/insurance-catalog/product-categories/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get insurance product categories
     * @description Top-level insurance product classifications.
     */
    get: operations["getInsuranceCatalogProductCategories"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/insurance-catalog/product-specializations": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List insurance product specializations
     * @description Product classifications nested under a category.
     */
    get: operations["listInsuranceCatalogProductSpecializations"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/insurance-catalog/product-specializations/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get insurance product specializations
     * @description Product classifications nested under a category.
     */
    get: operations["getInsuranceCatalogProductSpecializations"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/claims/workflow-statuses": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List claim workflow statuses
     * @description Claim status flow with its selectable substatuses.
     */
    get: operations["listClaimsWorkflowStatuses"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/claims/workflow-statuses/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get claim workflow statuses
     * @description Claim status flow with its selectable substatuses.
     */
    get: operations["getClaimsWorkflowStatuses"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/claims/workflow-types": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List claim workflow types
     * @description Claim type catalog used when registering a loss.
     */
    get: operations["listClaimsWorkflowTypes"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/claims/workflow-types/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get claim workflow types
     * @description Claim type catalog used when registering a loss.
     */
    get: operations["getClaimsWorkflowTypes"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/sales-pipeline/sales-offers": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List sales offers
     * @description Products and plans configured for insurance quotations.
     */
    get: operations["listSalesPipelineSalesOffers"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/sales-pipeline/sales-offers/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get sales offers
     * @description Products and plans configured for insurance quotations.
     */
    get: operations["getSalesPipelineSalesOffers"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/reference-values/policy-options": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List policy options
     * @description Read-only policy type, payment type, and renewal type values.
     */
    get: operations["listReferenceValuesPolicyOptions"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/reference-values/policy-options/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get policy options
     * @description Read-only policy type, payment type, and renewal type values.
     */
    get: operations["getReferenceValuesPolicyOptions"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/renewal-catalog/non-renewal-reasons": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List non-renewal reasons
     * @description Selectable reasons used when ending a renewal.
     */
    get: operations["listRenewalCatalogNonRenewalReasons"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/renewal-catalog/non-renewal-reasons/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get non-renewal reasons
     * @description Selectable reasons used when ending a renewal.
     */
    get: operations["getRenewalCatalogNonRenewalReasons"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/policy-lifecycle/reinvestment-activities": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List reinvestment activities
     * @description Activities selectable for policy reinvestments.
     */
    get: operations["listPolicyLifecycleReinvestmentActivities"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/policy-lifecycle/reinvestment-activities/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get reinvestment activities
     * @description Activities selectable for policy reinvestments.
     */
    get: operations["getPolicyLifecycleReinvestmentActivities"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/agency-network/document-tags": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List document tags
     * @description Global or agency-scoped labels selectable on documents.
     */
    get: operations["listAgencyNetworkDocumentTags"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/agency-network/document-tags/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get document tags
     * @description Global or agency-scoped labels selectable on documents.
     */
    get: operations["getAgencyNetworkDocumentTags"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/sales-pipeline/providers": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List sales providers
     * @description Providers selectable in sales contracts.
     */
    get: operations["listSalesPipelineProviders"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/sales-pipeline/providers/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get sales providers
     * @description Providers selectable in sales contracts.
     */
    get: operations["getSalesPipelineProviders"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/agency-network/commercial-units": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List commercial units
     * @description Agency-scoped commercial units selectable for customers and policies.
     */
    get: operations["listAgencyNetworkCommercialUnits"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/agency-network/commercial-units/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get commercial units
     * @description Agency-scoped commercial units selectable for customers and policies.
     */
    get: operations["getAgencyNetworkCommercialUnits"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/customer-portfolio/customer-groups": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List customer groups
     * @description Global or agency-scoped customer grouping options.
     */
    get: operations["listCustomerPortfolioCustomerGroups"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/customer-portfolio/customer-groups/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get customer groups
     * @description Global or agency-scoped customer grouping options.
     */
    get: operations["getCustomerPortfolioCustomerGroups"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/document-storage/commands/prepare-attachment-upload": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Prepare private attachment upload
     * @description Issues a private R2 upload for one customer, quote, policy, or claim attachment.
     */
    post: operations["executeDocumentStoragePrepareAttachmentUpload"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/document-storage/commands/complete-attachment-upload": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Complete private attachment upload
     * @description Verifies the R2 object and publishes it as an attachment document.
     */
    post: operations["executeDocumentStorageCompleteAttachmentUpload"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/document-storage/commands/create-attachment-download": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Create private attachment download
     * @description Creates a temporary private download URL for a ready attachment.
     */
    post: operations["executeDocumentStorageCreateAttachmentDownload"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/geographic-catalog/commands/register-country": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Register geographic country
     * @description Adds one country to the geographic reference catalog.
     */
    post: operations["executeGeographicCatalogRegisterCountry"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/geographic-catalog/commands/register-department": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Register geographic department
     * @description Adds one department under an existing country.
     */
    post: operations["executeGeographicCatalogRegisterDepartment"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/geographic-catalog/commands/register-city": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Register geographic city
     * @description Adds one city under an existing department.
     */
    post: operations["executeGeographicCatalogRegisterCity"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/finance-reference/commands/register-bank": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Register bank
     * @description Adds one bank selectable in financial details.
     */
    post: operations["executeFinanceReferenceRegisterBank"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/finance-reference/commands/register-economic-activity": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Register economic activity
     * @description Adds one activity code selectable for legal customers.
     */
    post: operations["executeFinanceReferenceRegisterEconomicActivity"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/operations-catalog/commands/define-task-type": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Define task type
     * @description Adds one type selectable in operations workflows.
     */
    post: operations["executeOperationsCatalogDefineTaskType"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/operations-catalog/commands/define-task-tag": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Define task tag
     * @description Adds one global or agency-scoped label for tasks.
     */
    post: operations["executeOperationsCatalogDefineTaskTag"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/agency-network/commands/create-agency-profile": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Create agency profile
     * @description Creates one agency profile with a server-assigned identifier.
     */
    post: operations["executeAgencyNetworkCreateAgencyProfile"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/agency-network/commands/update-agency-profile": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Update agency profile
     * @description Updates one existing agency profile.
     */
    post: operations["executeAgencyNetworkUpdateAgencyProfile"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/agency-network/commands/delete-agency-profile": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Delete agency profile
     * @description Deletes one agency profile that has no dependent records.
     */
    post: operations["executeAgencyNetworkDeleteAgencyProfile"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/agency-network/commands/define-document-tag": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Define document tag
     * @description Adds one global or agency-scoped label for documents.
     */
    post: operations["executeAgencyNetworkDefineDocumentTag"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/agency-network/commands/define-commercial-unit": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Define commercial unit
     * @description Adds one commercial unit scoped to an existing agency.
     */
    post: operations["executeAgencyNetworkDefineCommercialUnit"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/insurance-catalog/commands/define-product-category": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Define insurance product category
     * @description Adds one top-level insurance classification.
     */
    post: operations["executeInsuranceCatalogDefineProductCategory"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/insurance-catalog/commands/define-product-specialization": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Define insurance product specialization
     * @description Adds one insurance specialization below an existing category.
     */
    post: operations["executeInsuranceCatalogDefineProductSpecialization"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/insurance-catalog/commands/define-product-line": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Define insurance product line
     * @description Adds one insurance product line below an existing specialization.
     */
    post: operations["executeInsuranceCatalogDefineProductLine"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/insurance-catalog/commands/register-insurance-partner": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Register insurance partner
     * @description Adds one insurer to the business partner catalog.
     */
    post: operations["executeInsuranceCatalogRegisterInsurancePartner"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/customer-portfolio/commands/create-customer-profile": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Create customer profile
     * @description Creates one agency-scoped customer profile with server-assigned identifiers.
     */
    post: operations["executeCustomerPortfolioCreateCustomerProfile"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/customer-portfolio/commands/update-customer-profile": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Update customer profile
     * @description Updates one existing agency-scoped customer profile.
     */
    post: operations["executeCustomerPortfolioUpdateCustomerProfile"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/customer-portfolio/commands/delete-customer-profile": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Delete customer profile
     * @description Deletes one customer profile that has no dependent records.
     */
    post: operations["executeCustomerPortfolioDeleteCustomerProfile"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/customer-portfolio/commands/define-customer-group": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Define customer group
     * @description Adds one global or agency-scoped customer group.
     */
    post: operations["executeCustomerPortfolioDefineCustomerGroup"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/sales-pipeline/commands/register-sales-entity": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Register sales entity
     * @description Adds one sales configuration entity.
     */
    post: operations["executeSalesPipelineRegisterSalesEntity"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/sales-pipeline/commands/register-sales-operator": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Register sales operator
     * @description Adds one sales operator configuration.
     */
    post: operations["executeSalesPipelineRegisterSalesOperator"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/sales-pipeline/commands/register-sales-product": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Register sales product
     * @description Adds one quotation product with its configured dependencies.
     */
    post: operations["executeSalesPipelineRegisterSalesProduct"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/sales-pipeline/commands/register-sales-plan": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Register sales plan
     * @description Adds one plan that can optionally belong to a sales product.
     */
    post: operations["executeSalesPipelineRegisterSalesPlan"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/sales-pipeline/commands/register-sales-provider": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Register sales provider
     * @description Adds one provider selectable in sales contracts.
     */
    post: operations["executeSalesPipelineRegisterSalesProvider"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/policy-lifecycle/commands/define-reinvestment-activity": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Define reinvestment activity
     * @description Adds one activity selectable for policy reinvestments.
     */
    post: operations["executePolicyLifecycleDefineReinvestmentActivity"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/claims/commands/define-claim-type": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Define claim type
     * @description Adds one selectable claim type.
     */
    post: operations["executeClaimsDefineClaimType"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/claims/commands/define-claim-status": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Define claim status
     * @description Adds one status in the claims workflow.
     */
    post: operations["executeClaimsDefineClaimStatus"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/claims/commands/define-claim-substatus": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Define claim substatus
     * @description Adds one selectable substatus below an existing claim status.
     */
    post: operations["executeClaimsDefineClaimSubstatus"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/renewal-catalog/commands/define-non-renewal-reason": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Define non-renewal reason
     * @description Adds one reason selectable when a renewal is not continued.
     */
    post: operations["executeRenewalCatalogDefineNonRenewalReason"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/lifecycle/commands/bootstrap-demo": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Bootstrap insurance lifecycle demo
     * @description Creates an idempotent local agency-to-claim demonstration graph in D1.
     */
    post: operations["executeLifecycleBootstrapDemo"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/crm/customer-sync": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Synchronize agency-owned customers to the connected CRM
     * @description The server resolves each customer agency, CRM connection, remote object, and CRM link. Browser callers provide customer IDs only.
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
            customerIds: number[];
          };
        };
      };
      responses: {
        /** @description Itemized safe synchronization outcomes */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                items: {
                  customerId: number;
                  /** @enum {string} */
                  provider: "hubspot";
                  /** @enum {string} */
                  status: "created" | "updated" | "skipped" | "failed";
                  /** @enum {string} */
                  reason?:
                    | "AMBIGUOUS_COMPANY"
                    | "AMBIGUOUS_CONTACT"
                    | "CRM_CONNECTION_NOT_READY"
                    | "CRM_RECONNECT_REQUIRED"
                    | "CRM_UNAVAILABLE"
                    | "CUSTOMER_NOT_FOUND"
                    | "CUSTOMER_NOT_SYNCABLE"
                    | "UPSTREAM_FAILURE";
                  primaryLink?: {
                    /** @enum {string} */
                    provider: "hubspot";
                    /** @enum {string} */
                    objectKind: "contact" | "company";
                    /** Format: uri */
                    url: string;
                  };
                }[];
                summary: {
                  created: number;
                  updated: number;
                  skipped: number;
                  failed: number;
                };
              };
            };
          };
        };
        /** @description One through one hundred customer IDs are required */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description The actor cannot update one of the customers */
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
  "/v1/crm/customer-sync-links": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** List server-derived CRM links for agency-owned customers */
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
            customerIds: number[];
          };
        };
      };
      responses: {
        /** @description Remote links derived from persisted mappings */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                customerId: number;
                /** @enum {string} */
                provider: "hubspot";
                /** @enum {string} */
                objectKind: "contact" | "company";
                /** Format: uri */
                url: string;
              }[];
            };
          };
        };
        /** @description One through one hundred customer IDs are required */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description The actor cannot update one of the customers */
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
  "/v1/access-control/roles": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query: {
          scope: string;
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Success */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              revision: number;
              roles: {
                id: string;
                scope: string;
                name: string;
                label: string;
                description: string;
                enabled: boolean;
                protected: boolean;
                legacy_role: string | null;
                grants: {
                  resource: string;
                  /** @enum {string} */
                  action:
                    | "read"
                    | "create"
                    | "update"
                    | "delete"
                    | "restore"
                    | "import"
                    | "export"
                    | "execute"
                    | "configure"
                    | "manage";
                  predicate: {
                    [key: string]: unknown;
                  };
                  fields: string[];
                  id: string;
                  roleId: string;
                }[];
              }[];
            };
          };
        };
        /** @description Forbidden */
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
        /** @description Not found */
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
        /** @description Policy changed */
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
        /** @description Invalid policy */
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
            scope: string;
            name: string;
            label: string;
            description: string;
            enabled: boolean;
            expectedRevision: number;
            grants: {
              resource: string;
              /** @enum {string} */
              action:
                | "read"
                | "create"
                | "update"
                | "delete"
                | "restore"
                | "import"
                | "export"
                | "execute"
                | "configure"
                | "manage";
              predicate: {
                [key: string]: unknown;
              };
              fields: string[];
            }[];
          };
        };
      };
      responses: {
        /** @description Success */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              id: string;
              revision: number;
            };
          };
        };
        /** @description Forbidden */
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
        /** @description Not found */
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
        /** @description Policy changed */
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
        /** @description Invalid policy */
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
  "/v1/access-control/roles/{id}": {
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
        query: {
          scope: string;
          expectedRevision?: number | null;
        };
        header?: never;
        path: {
          id: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Success */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              revision: number;
            };
          };
        };
        /** @description Forbidden */
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
        /** @description Not found */
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
        /** @description Policy changed */
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
        /** @description Invalid policy */
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
    options?: never;
    head?: never;
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
            scope: string;
            name: string;
            label: string;
            description: string;
            enabled: boolean;
            expectedRevision: number;
            grants: {
              resource: string;
              /** @enum {string} */
              action:
                | "read"
                | "create"
                | "update"
                | "delete"
                | "restore"
                | "import"
                | "export"
                | "execute"
                | "configure"
                | "manage";
              predicate: {
                [key: string]: unknown;
              };
              fields: string[];
            }[];
          };
        };
      };
      responses: {
        /** @description Success */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              id: string;
              revision: number;
            };
          };
        };
        /** @description Forbidden */
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
        /** @description Not found */
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
        /** @description Policy changed */
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
        /** @description Invalid policy */
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
    trace?: never;
  };
  "/v1/access-control/assignments/{principalId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query: {
          scope: string;
        };
        header?: never;
        path: {
          principalId: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Success */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              revision: number;
              roleIds: string[];
            };
          };
        };
        /** @description Forbidden */
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
        /** @description Not found */
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
        /** @description Policy changed */
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
        /** @description Invalid policy */
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
    put: {
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
            scope: string;
            roleIds: string[];
            expectedRevision: number;
          };
        };
      };
      responses: {
        /** @description Success */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              revision: number;
            };
          };
        };
        /** @description Forbidden */
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
        /** @description Not found */
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
        /** @description Policy changed */
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
        /** @description Invalid policy */
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
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/access-control/catalog": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query: {
          scope: string;
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Success */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              resources: {
                resource: string;
                label: string;
                fields: string[];
                actions: (
                  | "read"
                  | "create"
                  | "update"
                  | "delete"
                  | "restore"
                  | "import"
                  | "export"
                  | "execute"
                  | "configure"
                  | "manage"
                )[];
                creatorSupported: boolean;
                fieldTypes: {
                  [key: string]: string;
                };
                restricted: boolean;
              }[];
            };
          };
        };
        /** @description Forbidden */
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
        /** @description Not found */
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
        /** @description Policy changed */
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
        /** @description Invalid policy */
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
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/access-control/effective": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query: {
          scope: string;
          principalId?: string;
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Success */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              principalId: string;
              scope: string;
              revision: number;
              grants: {
                resource: string;
                /** @enum {string} */
                action:
                  | "read"
                  | "create"
                  | "update"
                  | "delete"
                  | "restore"
                  | "import"
                  | "export"
                  | "execute"
                  | "configure"
                  | "manage";
                predicate: {
                  [key: string]: unknown;
                };
                fields: string[];
                id: string;
                roleId: string;
              }[];
            };
          };
        };
        /** @description Forbidden */
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
        /** @description Not found */
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
        /** @description Policy changed */
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
        /** @description Invalid policy */
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
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/access-control/members": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query: {
          scope: string;
          q?: string;
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Success */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              members: {
                id: string;
                displayName: string;
                email: string;
              }[];
            };
          };
        };
        /** @description Forbidden */
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
        /** @description Not found */
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
        /** @description Policy changed */
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
        /** @description Invalid policy */
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
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
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
    InsuranceResult:
      | {
          /** @enum {string} */
          schemaVersion: "1.0";
          /** @enum {string} */
          status: "success" | "partial" | "no_result" | "error" | "pending";
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
          /** @enum {string} */
          type: "vehicle_lookup";
          data: {
            vehicle: {
              plate: string | null;
              year: number | null;
              fasecoldaCode: string | null;
              brand: string | null;
              model: string | null;
              engineNumber: string | null;
              chassisNumber: string | null;
              insuredValue: number | null;
              accessoriesValue: number | null;
              currency: string | null;
            } | null;
          };
        }
      | {
          /** @enum {string} */
          schemaVersion: "1.0";
          /** @enum {string} */
          status: "success" | "partial" | "no_result" | "error" | "pending";
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
          /** @enum {string} */
          type: "quote";
          data: {
            offers: {
              provider: string | null;
              reference: string | null;
              product: {
                id: string | null;
                name: string | null;
              };
              premium: {
                total: number | null;
                net: number | null;
                tax: number | null;
                currency: string | null;
              };
              coverages:
                | {
                    code: string | null;
                    name: string | null;
                    insuredValue: number | null;
                  }[]
                | null;
              deductibles:
                | {
                    code: string | null;
                    description: string | null;
                    amount: number | null;
                  }[]
                | null;
              documents: {
                type: string;
                /** Format: uri */
                url: string;
              }[];
              metadata: {
                providerFields: {
                  [key: string]: unknown;
                };
              };
            }[];
          };
        }
      | {
          /** @enum {string} */
          schemaVersion: "1.0";
          /** @enum {string} */
          status: "success" | "partial" | "no_result" | "error" | "pending";
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
          /** @enum {string} */
          type: "authentication";
          data: {
            authenticated: boolean | null;
          };
        }
      | {
          /** @enum {string} */
          schemaVersion: "1.0";
          /** @enum {string} */
          status: "success" | "partial" | "no_result" | "error" | "pending";
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
          /** @enum {string} */
          type: "request";
          data: {
            result: null;
          };
        }
      | {
          /** @enum {string} */
          schemaVersion: "1.0";
          /** @enum {string} */
          status: "success" | "partial" | "no_result" | "error" | "pending";
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
          /** @enum {string} */
          type: "unknown";
          data: null;
        };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  listDocumentStorageAttachments: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Private attachments */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getDocumentStorageAttachments: {
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
      /** @description Document from Private attachments */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listGeographicCatalogCountries: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Geographic countries */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getGeographicCatalogCountries: {
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
      /** @description Document from Geographic countries */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listGeographicCatalogDepartments: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Geographic departments */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getGeographicCatalogDepartments: {
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
      /** @description Document from Geographic departments */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listGeographicCatalogCities: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Geographic cities */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getGeographicCatalogCities: {
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
      /** @description Document from Geographic cities */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listReferenceValuesCurrencies: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Currencies */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getReferenceValuesCurrencies: {
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
      /** @description Document from Currencies */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listReferenceValuesIdentificationTypes: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Identification types */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getReferenceValuesIdentificationTypes: {
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
      /** @description Document from Identification types */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listReferenceValuesPersonAttributes: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Person attributes */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getReferenceValuesPersonAttributes: {
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
      /** @description Document from Person attributes */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listFinanceReferenceBanks: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Banks */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getFinanceReferenceBanks: {
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
      /** @description Document from Banks */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listFinanceReferenceEconomicActivities: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Economic activities */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getFinanceReferenceEconomicActivities: {
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
      /** @description Document from Economic activities */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listOperationsCatalogTaskTypes: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Task types */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getOperationsCatalogTaskTypes: {
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
      /** @description Document from Task types */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listOperationsCatalogTaskTags: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Task tags */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getOperationsCatalogTaskTags: {
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
      /** @description Document from Task tags */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listAgencyNetworkAgencyProfiles: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Agency profiles */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getAgencyNetworkAgencyProfiles: {
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
      /** @description Document from Agency profiles */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listInsuranceCatalogInsurancePartners: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Insurance partners */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getInsuranceCatalogInsurancePartners: {
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
      /** @description Document from Insurance partners */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listInsuranceCatalogProductLines: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Insurance product lines */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getInsuranceCatalogProductLines: {
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
      /** @description Document from Insurance product lines */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listCustomerPortfolioCustomerProfiles: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
        agencyId?: number;
        q?: string;
        source?: "direct" | "prospect";
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Customer profiles */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getCustomerPortfolioCustomerProfiles: {
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
      /** @description Document from Customer profiles */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listSalesPipelineQuotes: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Insurance quotes */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getSalesPipelineQuotes: {
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
      /** @description Document from Insurance quotes */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listPolicyLifecyclePolicies: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Insurance policies */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getPolicyLifecyclePolicies: {
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
      /** @description Document from Insurance policies */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listCollectionsPayments: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Policy payments */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getCollectionsPayments: {
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
      /** @description Document from Policy payments */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listClaimsClaims: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Insurance claims */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getClaimsClaims: {
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
      /** @description Document from Insurance claims */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listInsuranceCatalogProductCategories: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Insurance product categories */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getInsuranceCatalogProductCategories: {
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
      /** @description Document from Insurance product categories */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listInsuranceCatalogProductSpecializations: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Insurance product specializations */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getInsuranceCatalogProductSpecializations: {
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
      /** @description Document from Insurance product specializations */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listClaimsWorkflowStatuses: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Claim workflow statuses */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getClaimsWorkflowStatuses: {
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
      /** @description Document from Claim workflow statuses */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listClaimsWorkflowTypes: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Claim workflow types */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getClaimsWorkflowTypes: {
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
      /** @description Document from Claim workflow types */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listSalesPipelineSalesOffers: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Sales offers */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getSalesPipelineSalesOffers: {
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
      /** @description Document from Sales offers */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listReferenceValuesPolicyOptions: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Policy options */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getReferenceValuesPolicyOptions: {
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
      /** @description Document from Policy options */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listRenewalCatalogNonRenewalReasons: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Non-renewal reasons */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getRenewalCatalogNonRenewalReasons: {
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
      /** @description Document from Non-renewal reasons */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listPolicyLifecycleReinvestmentActivities: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Reinvestment activities */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getPolicyLifecycleReinvestmentActivities: {
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
      /** @description Document from Reinvestment activities */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listAgencyNetworkDocumentTags: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Document tags */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getAgencyNetworkDocumentTags: {
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
      /** @description Document from Document tags */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listSalesPipelineProviders: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Sales providers */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getSalesPipelineProviders: {
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
      /** @description Document from Sales providers */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listAgencyNetworkCommercialUnits: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Commercial units */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getAgencyNetworkCommercialUnits: {
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
      /** @description Document from Commercial units */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  listCustomerPortfolioCustomerGroups: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Documents from Customer groups */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            data: {
              id: string;
              kind: string;
              attributes?: unknown;
              relationships?: unknown;
            }[];
            page: {
              limit: number;
              offset: number;
              total?: number;
            };
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
    };
  };
  getCustomerPortfolioCustomerGroups: {
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
      /** @description Document from Customer groups */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid request */
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
      /** @description Active membership is required */
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
      /** @description Document not found */
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
    };
  };
  executeDocumentStoragePrepareAttachmentUpload: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeDocumentStorageCompleteAttachmentUpload: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeDocumentStorageCreateAttachmentDownload: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeGeographicCatalogRegisterCountry: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          id: number;
          name: string;
          code: string;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeGeographicCatalogRegisterDepartment: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeGeographicCatalogRegisterCity: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeFinanceReferenceRegisterBank: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeFinanceReferenceRegisterEconomicActivity: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeOperationsCatalogDefineTaskType: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeOperationsCatalogDefineTaskTag: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeAgencyNetworkCreateAgencyProfile: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          idSlug: string;
          name: string;
          address: string;
          idCheckDigit: string;
          idNumber: string;
          phone?: string | null;
          logo?: string | null;
          cityId?: number | null;
          coordinates?: {
            /** @enum {string} */
            type: "Point";
            coordinates: [number, number];
          } | null;
          lrIdNumber: string;
          lrIdType: string;
          lrName: string;
          /** Format: email */
          paymentsEmail: string;
          isActive: boolean;
          /** Format: email */
          email: string;
          isInHouse: boolean;
          emailDomain: string;
          /** Format: email */
          birthdayFromEmail: string;
          /** Format: email */
          paymentFromEmail: string;
          /** Format: email */
          renewalFromEmail: string;
          /** Format: uri */
          homeUrl: string;
          shortName: string;
          sellerRequired: boolean;
          hasCompliance: boolean;
          defaultCcEmails?: string[] | null;
          surnames: string;
          type: string;
          theme: string;
          /** Format: date */
          retirementDate?: string | null;
          tenantId?: number;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeAgencyNetworkUpdateAgencyProfile: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          idSlug?: string;
          name?: string;
          address?: string;
          idCheckDigit?: string;
          idNumber?: string;
          phone?: string | null;
          logo?: string | null;
          cityId?: number | null;
          coordinates?: {
            /** @enum {string} */
            type: "Point";
            coordinates: [number, number];
          } | null;
          lrIdNumber?: string;
          lrIdType?: string;
          lrName?: string;
          /** Format: email */
          paymentsEmail?: string;
          isActive?: boolean;
          /** Format: email */
          email?: string;
          isInHouse?: boolean;
          emailDomain?: string;
          /** Format: email */
          birthdayFromEmail?: string;
          /** Format: email */
          paymentFromEmail?: string;
          /** Format: email */
          renewalFromEmail?: string;
          /** Format: uri */
          homeUrl?: string;
          shortName?: string;
          sellerRequired?: boolean;
          hasCompliance?: boolean;
          defaultCcEmails?: string[] | null;
          surnames?: string;
          type?: string;
          theme?: string;
          /** Format: date */
          retirementDate?: string | null;
          id: number;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeAgencyNetworkDeleteAgencyProfile: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          id: number;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeAgencyNetworkDefineDocumentTag: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeAgencyNetworkDefineCommercialUnit: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeInsuranceCatalogDefineProductCategory: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeInsuranceCatalogDefineProductSpecialization: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeInsuranceCatalogDefineProductLine: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeInsuranceCatalogRegisterInsurancePartner: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeCustomerPortfolioCreateCustomerProfile: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json":
          | {
              agencyId: number;
              idNumber: string;
              externalReference?: string;
              /**
               * @default direct
               * @enum {string}
               */
              source?: "direct" | "prospect";
              commercialUnitId?: number | null;
              /** @default true */
              birthdayNotification?: boolean;
              /** @default true */
              paymentNotification?: boolean;
              /** @default true */
              renewalNotification?: boolean;
              /** @enum {string} */
              personType: "natural";
              givenName: string;
              familyName: string;
              identificationType: string;
              /** Format: email */
              email: string;
              phone: string;
            }
          | {
              agencyId: number;
              idNumber: string;
              externalReference?: string;
              /**
               * @default direct
               * @enum {string}
               */
              source?: "direct" | "prospect";
              commercialUnitId?: number | null;
              /** @default true */
              birthdayNotification?: boolean;
              /** @default true */
              paymentNotification?: boolean;
              /** @default true */
              renewalNotification?: boolean;
              /** @enum {string} */
              personType: "legal";
              businessName: string;
              verificationDigit: string;
              legalRepresentativeName: string;
              legalRepresentativeIdentificationType: string;
              legalRepresentativeIdentificationNumber: string;
            };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeCustomerPortfolioUpdateCustomerProfile: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json":
          | {
              agencyId: number;
              idNumber: string;
              externalReference?: string;
              /**
               * @default direct
               * @enum {string}
               */
              source?: "direct" | "prospect";
              commercialUnitId?: number | null;
              /** @default true */
              birthdayNotification?: boolean;
              /** @default true */
              paymentNotification?: boolean;
              /** @default true */
              renewalNotification?: boolean;
              /** @enum {string} */
              personType: "natural";
              givenName: string;
              familyName: string;
              identificationType: string;
              /** Format: email */
              email: string;
              phone: string;
              id: number;
            }
          | {
              agencyId: number;
              idNumber: string;
              externalReference?: string;
              /**
               * @default direct
               * @enum {string}
               */
              source?: "direct" | "prospect";
              commercialUnitId?: number | null;
              /** @default true */
              birthdayNotification?: boolean;
              /** @default true */
              paymentNotification?: boolean;
              /** @default true */
              renewalNotification?: boolean;
              /** @enum {string} */
              personType: "legal";
              businessName: string;
              verificationDigit: string;
              legalRepresentativeName: string;
              legalRepresentativeIdentificationType: string;
              legalRepresentativeIdentificationNumber: string;
              id: number;
            };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeCustomerPortfolioDeleteCustomerProfile: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          id: number;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeCustomerPortfolioDefineCustomerGroup: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeSalesPipelineRegisterSalesEntity: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeSalesPipelineRegisterSalesOperator: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeSalesPipelineRegisterSalesProduct: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeSalesPipelineRegisterSalesPlan: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeSalesPipelineRegisterSalesProvider: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executePolicyLifecycleDefineReinvestmentActivity: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeClaimsDefineClaimType: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeClaimsDefineClaimStatus: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeClaimsDefineClaimSubstatus: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeRenewalCatalogDefineNonRenewalReason: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
  executeLifecycleBootstrapDemo: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: unknown;
        };
      };
    };
    responses: {
      /** @description Documental command result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            id: string;
            kind: string;
            attributes?: unknown;
            relationships?: unknown;
          };
        };
      };
      /** @description Invalid command input */
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
      /** @description Platform administrator role is required */
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
      /** @description Domain command not found */
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
      /** @description Command conflicts with current state */
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
}
