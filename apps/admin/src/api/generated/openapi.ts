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
            oauth_query?: string;
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
            oauth_query?: string;
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
            oauth_query?: string;
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
  "/v1/account/api-keys": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List your personal API key metadata */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Metadata without secrets */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              keys: {
                /** Format: uuid */
                id: string;
                name: string;
                prefix: string;
                tenantId: number;
                scopes: (
                  | "recordings:read"
                  | "recordings:upload"
                  | "recordings:process"
                  | "recordings:delete"
                  | "records:read"
                  | "records:create"
                  | "records:update"
                )[];
                createdAt: string;
                expiresAt: string;
                revokedAt: string | null;
                lastUsedAt: string | null;
              }[];
            };
          };
        };
      };
    };
    put?: never;
    /** Create a scoped personal key; reveal its secret once */
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
            tenantId: number;
            scopes: (
              | "recordings:read"
              | "recordings:upload"
              | "recordings:process"
              | "recordings:delete"
              | "records:read"
              | "records:create"
              | "records:update"
            )[];
            /** @default 30 */
            lifetimeDays?: 7 | 30 | 90;
          };
        };
      };
      responses: {
        /** @description One-time credential */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              key: {
                /** Format: uuid */
                id: string;
                name: string;
                prefix: string;
                tenantId: number;
                scopes: (
                  | "recordings:read"
                  | "recordings:upload"
                  | "recordings:process"
                  | "recordings:delete"
                  | "records:read"
                  | "records:create"
                  | "records:update"
                )[];
                createdAt: string;
                expiresAt: string;
                revokedAt: string | null;
                lastUsedAt: string | null;
              };
              secret: string;
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
  "/v1/account/api-keys/tenants": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List eligible tenants for personal keys */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Eligible active memberships */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              tenants: {
                id: number;
                name: string;
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
  "/v1/account/api-keys/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** Revoke your personal key */
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
        /** @description Revoked or already absent */
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
  "/v1/tenants/{tenantId}/api-keys": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List personal API key metadata for a tenant */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Metadata with owners, without secrets */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              keys: {
                /** Format: uuid */
                id: string;
                name: string;
                prefix: string;
                tenantId: number;
                scopes: (
                  | "recordings:read"
                  | "recordings:upload"
                  | "recordings:process"
                  | "recordings:delete"
                  | "records:read"
                  | "records:create"
                  | "records:update"
                )[];
                createdAt: string;
                expiresAt: string;
                revokedAt: string | null;
                lastUsedAt: string | null;
                principalId: string;
                ownerName: string;
                ownerEmail: string;
              }[];
            };
          };
        };
      };
    };
    put?: never;
    /** Create a personal key for an active tenant member; reveal its secret once */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            name: string;
            scopes: (
              | "recordings:read"
              | "recordings:upload"
              | "recordings:process"
              | "recordings:delete"
              | "records:read"
              | "records:create"
              | "records:update"
            )[];
            /** @default 30 */
            lifetimeDays?: 7 | 30 | 90;
            principalId: string;
          };
        };
      };
      responses: {
        /** @description One-time credential */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              key: {
                /** Format: uuid */
                id: string;
                name: string;
                prefix: string;
                tenantId: number;
                scopes: (
                  | "recordings:read"
                  | "recordings:upload"
                  | "recordings:process"
                  | "recordings:delete"
                  | "records:read"
                  | "records:create"
                  | "records:update"
                )[];
                createdAt: string;
                expiresAt: string;
                revokedAt: string | null;
                lastUsedAt: string | null;
              };
              secret: string;
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
  "/v1/tenants/{tenantId}/api-keys/members": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List eligible active tenant members for key creation */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Active tenant members */
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
  "/v1/tenants/{tenantId}/api-keys/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** Revoke a personal key in this tenant */
    delete: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
          id: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Revoked or already absent */
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
  "/v1/companion/sessions": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List owned session metadata; read an individual session for transcripts and notes */
    get: {
      parameters: {
        query?: {
          cursor?: string;
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Session page */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              sessions: {
                /** Format: uuid */
                id: string;
                tenantId?: number;
                name: string;
                /** Format: date-time */
                createdAt: string;
                /** Format: date-time */
                updatedAt: string;
                sources: ("microphone" | "system")[];
                /** @enum {string} */
                state: "uploading" | "ready";
                durationSeconds: number | null;
                chunks: {
                  /**
                   * @default ogg
                   * @enum {string}
                   */
                  format: "ogg" | "m4a";
                  /** @enum {string} */
                  source: "microphone" | "system";
                  sequence: number;
                  startSeconds: number;
                  durationSeconds: number;
                  bytes: number;
                  sha256: string;
                }[];
                job: {
                  /**
                   * Format: uuid
                   * @default null
                   */
                  runId: string | null;
                  /** @enum {string} */
                  status:
                    | "idle"
                    | "queued"
                    | "transcribing"
                    | "summarizing"
                    | "complete"
                    | "needs_attention"
                    | "cancelled"
                    | "failed";
                  completedChunks: number;
                  totalChunks: number;
                  error?: string;
                  /** @default {} */
                  transcripts: {
                    [key: string]: {
                      text: string;
                      /** @enum {string} */
                      source: "microphone" | "system" | "upload";
                      model: string;
                      durationSeconds: number | null;
                    };
                  };
                  /** @default null */
                  summary: {
                    summary: string;
                    decisions: string[];
                    actions: {
                      description: string;
                      owner: string | null;
                      dueDate: string | null;
                    }[];
                    openQuestions: string[];
                  } | null;
                };
              }[];
              cursor: string | null;
            };
          };
        };
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Request rejected */
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
    put?: never;
    /** Create an idempotent consented recording session */
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
            name: string;
            sources: ("microphone" | "system")[];
            /** @enum {boolean} */
            consent: true;
          };
        };
      };
      responses: {
        /** @description Uploaded session metadata */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** Format: uuid */
              id: string;
              tenantId?: number;
              name: string;
              /** Format: date-time */
              createdAt: string;
              /** Format: date-time */
              updatedAt: string;
              sources: ("microphone" | "system")[];
              /** @enum {string} */
              state: "uploading" | "ready";
              durationSeconds: number | null;
              chunks: {
                /**
                 * @default ogg
                 * @enum {string}
                 */
                format: "ogg" | "m4a";
                /** @enum {string} */
                source: "microphone" | "system";
                sequence: number;
                startSeconds: number;
                durationSeconds: number;
                bytes: number;
                sha256: string;
              }[];
            };
          };
        };
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Request rejected */
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
  "/v1/companion/sessions/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read recording progress, transcripts and notes */
    get: {
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
        /** @description Recording session */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** Format: uuid */
              id: string;
              tenantId?: number;
              name: string;
              /** Format: date-time */
              createdAt: string;
              /** Format: date-time */
              updatedAt: string;
              sources: ("microphone" | "system")[];
              /** @enum {string} */
              state: "uploading" | "ready";
              durationSeconds: number | null;
              chunks: {
                /**
                 * @default ogg
                 * @enum {string}
                 */
                format: "ogg" | "m4a";
                /** @enum {string} */
                source: "microphone" | "system";
                sequence: number;
                startSeconds: number;
                durationSeconds: number;
                bytes: number;
                sha256: string;
              }[];
              job: {
                /**
                 * Format: uuid
                 * @default null
                 */
                runId: string | null;
                /** @enum {string} */
                status:
                  | "idle"
                  | "queued"
                  | "transcribing"
                  | "summarizing"
                  | "complete"
                  | "needs_attention"
                  | "cancelled"
                  | "failed";
                completedChunks: number;
                totalChunks: number;
                error?: string;
                /** @default {} */
                transcripts: {
                  [key: string]: {
                    text: string;
                    /** @enum {string} */
                    source: "microphone" | "system" | "upload";
                    model: string;
                    durationSeconds: number | null;
                  };
                };
                /** @default null */
                summary: {
                  summary: string;
                  decisions: string[];
                  actions: {
                    description: string;
                    owner: string | null;
                    dueDate: string | null;
                  }[];
                  openQuestions: string[];
                } | null;
              };
            };
          };
        };
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Request rejected */
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
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/companion/sessions/{id}/chunks": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Upload an immutable independently decodable audio segment */
    post: {
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
            /** @enum {string} */
            source: "microphone" | "system";
            sequence: number;
            startSeconds: number;
            audio: {
              data: string;
              /** @enum {string} */
              format: "ogg" | "m4a";
            };
          };
        };
      };
      responses: {
        /** @description Uploaded session metadata */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** Format: uuid */
              id: string;
              tenantId?: number;
              name: string;
              /** Format: date-time */
              createdAt: string;
              /** Format: date-time */
              updatedAt: string;
              sources: ("microphone" | "system")[];
              /** @enum {string} */
              state: "uploading" | "ready";
              durationSeconds: number | null;
              chunks: {
                /**
                 * @default ogg
                 * @enum {string}
                 */
                format: "ogg" | "m4a";
                /** @enum {string} */
                source: "microphone" | "system";
                sequence: number;
                startSeconds: number;
                durationSeconds: number;
                bytes: number;
                sha256: string;
              }[];
            };
          };
        };
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Request rejected */
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
  "/v1/companion/sessions/{id}/finalize": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Finalize a complete recording timeline of up to one hour */
    post: {
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
            expectedChunks: number;
            durationSeconds: number;
          };
        };
      };
      responses: {
        /** @description Uploaded session metadata */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** Format: uuid */
              id: string;
              tenantId?: number;
              name: string;
              /** Format: date-time */
              createdAt: string;
              /** Format: date-time */
              updatedAt: string;
              sources: ("microphone" | "system")[];
              /** @enum {string} */
              state: "uploading" | "ready";
              durationSeconds: number | null;
              chunks: {
                /**
                 * @default ogg
                 * @enum {string}
                 */
                format: "ogg" | "m4a";
                /** @enum {string} */
                source: "microphone" | "system";
                sequence: number;
                startSeconds: number;
                durationSeconds: number;
                bytes: number;
                sha256: string;
              }[];
            };
          };
        };
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Request rejected */
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
  "/v1/companion/sessions/{id}/chunks/{source}/{sequence}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Play an owned audio segment */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          id: string;
          source: "microphone" | "system";
          sequence: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Ogg Opus or M4A audio */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "audio/ogg": string;
            "audio/mp4": string;
          };
        };
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Request rejected */
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
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/companion/sessions/{id}/notes": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Queue durable transcription and summary processing with provider consent */
    post: {
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
            /** @enum {boolean} */
            consent: true;
            retryAmbiguous?: boolean;
          };
        };
      };
      responses: {
        /** @description Recording session */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** Format: uuid */
              id: string;
              tenantId?: number;
              name: string;
              /** Format: date-time */
              createdAt: string;
              /** Format: date-time */
              updatedAt: string;
              sources: ("microphone" | "system")[];
              /** @enum {string} */
              state: "uploading" | "ready";
              durationSeconds: number | null;
              chunks: {
                /**
                 * @default ogg
                 * @enum {string}
                 */
                format: "ogg" | "m4a";
                /** @enum {string} */
                source: "microphone" | "system";
                sequence: number;
                startSeconds: number;
                durationSeconds: number;
                bytes: number;
                sha256: string;
              }[];
              job: {
                /**
                 * Format: uuid
                 * @default null
                 */
                runId: string | null;
                /** @enum {string} */
                status:
                  | "idle"
                  | "queued"
                  | "transcribing"
                  | "summarizing"
                  | "complete"
                  | "needs_attention"
                  | "cancelled"
                  | "failed";
                completedChunks: number;
                totalChunks: number;
                error?: string;
                /** @default {} */
                transcripts: {
                  [key: string]: {
                    text: string;
                    /** @enum {string} */
                    source: "microphone" | "system" | "upload";
                    model: string;
                    durationSeconds: number | null;
                  };
                };
                /** @default null */
                summary: {
                  summary: string;
                  decisions: string[];
                  actions: {
                    description: string;
                    owner: string | null;
                    dueDate: string | null;
                  }[];
                  openQuestions: string[];
                } | null;
              };
            };
          };
        };
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Request rejected */
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
  "/v1/companion/sessions/{id}/cancel": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Cancel pending provider work while preserving saved results */
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
        /** @description Recording session */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** Format: uuid */
              id: string;
              tenantId?: number;
              name: string;
              /** Format: date-time */
              createdAt: string;
              /** Format: date-time */
              updatedAt: string;
              sources: ("microphone" | "system")[];
              /** @enum {string} */
              state: "uploading" | "ready";
              durationSeconds: number | null;
              chunks: {
                /**
                 * @default ogg
                 * @enum {string}
                 */
                format: "ogg" | "m4a";
                /** @enum {string} */
                source: "microphone" | "system";
                sequence: number;
                startSeconds: number;
                durationSeconds: number;
                bytes: number;
                sha256: string;
              }[];
              job: {
                /**
                 * Format: uuid
                 * @default null
                 */
                runId: string | null;
                /** @enum {string} */
                status:
                  | "idle"
                  | "queued"
                  | "transcribing"
                  | "summarizing"
                  | "complete"
                  | "needs_attention"
                  | "cancelled"
                  | "failed";
                completedChunks: number;
                totalChunks: number;
                error?: string;
                /** @default {} */
                transcripts: {
                  [key: string]: {
                    text: string;
                    /** @enum {string} */
                    source: "microphone" | "system" | "upload";
                    model: string;
                    durationSeconds: number | null;
                  };
                };
                /** @default null */
                summary: {
                  summary: string;
                  decisions: string[];
                  actions: {
                    description: string;
                    owner: string | null;
                    dueDate: string | null;
                  }[];
                  openQuestions: string[];
                } | null;
              };
            };
          };
        };
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Request rejected */
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
  "/v1/companion/sessions/{id}/questions": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Answer using bounded transcript evidence and return its timeline references */
    post: {
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
            question: string;
            /** @enum {boolean} */
            consent: true;
          };
        };
      };
      responses: {
        /** @description Grounded answer */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              answer: string;
              insufficientEvidence: boolean;
              partial: boolean;
              evidence: {
                source: string;
                sequence: number;
                startSeconds: number;
                durationSeconds: number;
              }[];
            };
          };
        };
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
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
        /** @description Request rejected */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Request rejected */
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
  "/v1/companion/capabilities": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read the enabled Companion validation limits */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Validation capabilities */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              sttModel: string;
              summaryModel: string;
              maxDurationSeconds: number;
              /** @enum {number} */
              maxSessionDurationSeconds: 3600;
              /** @enum {number} */
              maxSessionChunksPerSource: 120;
              sessionAudioFormats: ("ogg" | "m4a")[];
              maxAudioBytes: number;
              maxCompressedAudioBytes: number;
              audioFormats: ("wav" | "ogg")[];
              storageAvailable: boolean;
              grantedRecordingScopes?: (
                | "recordings:read"
                | "recordings:upload"
                | "recordings:process"
                | "recordings:delete"
              )[];
              /** @enum {string} */
              privacyRouting: "unverified";
            };
          };
        };
        /** @description Request unavailable or rejected */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        504: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
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
  "/v1/companion/transcribe": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Transcribe one consented short audio source */
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
            source: "microphone" | "system" | "upload";
            audio: {
              data: string;
              /** @enum {string} */
              format: "wav" | "ogg";
            };
            /** @default es */
            language?: string;
            /** @enum {boolean} */
            consent: true;
          };
        };
      };
      responses: {
        /** @description Transcript (not persisted) */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              text: string;
              /** @enum {string} */
              source: "microphone" | "system" | "upload";
              model: string;
              durationSeconds: number | null;
            };
          };
        };
        /** @description Request unavailable or rejected */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        504: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
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
  "/v1/companion/recordings/upload": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Upload a private audio recording up to 50 MB */
    post: {
      parameters: {
        query: {
          id: string;
          name: string;
          format: "wav" | "ogg" | "mp3" | "m4a";
          consent: "true";
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/octet-stream": string;
        };
      };
      responses: {
        /** @description Saved private recording */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** Format: uuid */
              id: string;
              tenantId?: number;
              /** @enum {string} */
              source: "microphone" | "system" | "upload";
              /** @enum {string} */
              format: "wav" | "ogg" | "mp3" | "m4a";
              bytes: number;
              durationSeconds: number | null;
              /** Format: date-time */
              createdAt: string;
              sha256: string;
              name?: string;
              /** @enum {string} */
              origin?:
                | "local"
                | "google_drive"
                | "onedrive_personal"
                | "onedrive_business";
            };
          };
        };
        /** @description Request unavailable or rejected */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        504: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
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
  "/v1/companion/recordings/import": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Import a selected recording from the current user's connected drive */
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
            /** @enum {string} */
            provider:
              "google_drive" | "onedrive_personal" | "onedrive_business";
            fileId: string;
            /** @enum {boolean} */
            consent: true;
          };
        };
      };
      responses: {
        /** @description Saved private recording */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** Format: uuid */
              id: string;
              tenantId?: number;
              /** @enum {string} */
              source: "microphone" | "system" | "upload";
              /** @enum {string} */
              format: "wav" | "ogg" | "mp3" | "m4a";
              bytes: number;
              durationSeconds: number | null;
              /** Format: date-time */
              createdAt: string;
              sha256: string;
              name?: string;
              /** @enum {string} */
              origin?:
                | "local"
                | "google_drive"
                | "onedrive_personal"
                | "onedrive_business";
            };
          };
        };
        /** @description Request unavailable or rejected */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Personal connection access denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        504: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
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
  "/v1/companion/recordings": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List the current user's private samples */
    get: {
      parameters: {
        query?: {
          cursor?: string;
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Private samples */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              recordings: {
                /** Format: uuid */
                id: string;
                tenantId?: number;
                /** @enum {string} */
                source: "microphone" | "system" | "upload";
                /** @enum {string} */
                format: "wav" | "ogg" | "mp3" | "m4a";
                bytes: number;
                durationSeconds: number | null;
                /** Format: date-time */
                createdAt: string;
                sha256: string;
                name?: string;
                /** @enum {string} */
                origin?:
                  | "local"
                  | "google_drive"
                  | "onedrive_personal"
                  | "onedrive_business";
              }[];
              cursor: string | null;
            };
          };
        };
        /** @description Request unavailable or rejected */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        504: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
      };
    };
    put?: never;
    /** Save one private consented Opus sample */
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
            /** @enum {string} */
            source: "microphone" | "system" | "upload";
            audio: {
              data: string;
              /** @enum {string} */
              format: "ogg";
            };
            /** @enum {boolean} */
            consent: true;
          };
        };
      };
      responses: {
        /** @description Saved sample */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** Format: uuid */
              id: string;
              tenantId?: number;
              /** @enum {string} */
              source: "microphone" | "system" | "upload";
              /** @enum {string} */
              format: "wav" | "ogg" | "mp3" | "m4a";
              bytes: number;
              durationSeconds: number | null;
              /** Format: date-time */
              createdAt: string;
              sha256: string;
              name?: string;
              /** @enum {string} */
              origin?:
                | "local"
                | "google_drive"
                | "onedrive_personal"
                | "onedrive_business";
            };
          };
        };
        /** @description Request unavailable or rejected */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        504: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
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
  "/v1/companion/recordings/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Download the current user's private sample */
    get: {
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
        /** @description Original recording audio */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "audio/ogg": string;
            "audio/mpeg": string;
            "audio/wav": string;
            "audio/mp4": string;
          };
        };
        /** @description Request unavailable or rejected */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        504: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    /** Delete the current user's private sample */
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
        /** @description Sample deleted */
        204: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request unavailable or rejected */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        504: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
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
  "/v1/companion/recordings/{id}/notes": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read saved transcript and draft notes */
    get: {
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
        /** @description Persisted transcript and meeting notes */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              transcript: {
                text: string;
                /** @enum {string} */
                source: "microphone" | "system" | "upload";
                model: string;
                durationSeconds: number | null;
              } | null;
              summary: {
                summary: string;
                decisions: string[];
                actions: {
                  description: string;
                  owner: string | null;
                  dueDate: string | null;
                }[];
                openQuestions: string[];
              } | null;
            };
          };
        };
        /** @description Request unavailable or rejected */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        504: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
      };
    };
    put?: never;
    /** Transcribe and summarize one saved sample with explicit consent */
    post: {
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
            /** @enum {boolean} */
            consent: true;
          };
        };
      };
      responses: {
        /** @description Persisted transcript and draft notes */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              transcript: {
                text: string;
                /** @enum {string} */
                source: "microphone" | "system" | "upload";
                model: string;
                durationSeconds: number | null;
              } | null;
              summary: {
                summary: string;
                decisions: string[];
                actions: {
                  description: string;
                  owner: string | null;
                  dueDate: string | null;
                }[];
                openQuestions: string[];
              } | null;
            };
          };
        };
        /** @description Request unavailable or rejected */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        504: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
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
  "/v1/companion/recordings/{id}/questions": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Answer a question using only the saved recording transcript */
    post: {
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
            question: string;
            /** @enum {boolean} */
            consent: true;
          };
        };
      };
      responses: {
        /** @description Draft answer, not persisted */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              answer: string;
              insufficientEvidence: boolean;
            };
          };
        };
        /** @description Request unavailable or rejected */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        504: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
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
  "/v1/companion/summarize": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Generate reviewable meeting notes without business writes */
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
            transcripts: {
              /** @enum {string} */
              source: "microphone" | "system" | "upload";
              text: string;
            }[];
            /** @enum {boolean} */
            consent: true;
          };
        };
      };
      responses: {
        /** @description Draft notes (not persisted) */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              summary: string;
              decisions: string[];
              actions: {
                description: string;
                owner: string | null;
                dueDate: string | null;
              }[];
              openQuestions: string[];
            };
          };
        };
        /** @description Request unavailable or rejected */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
              };
            };
          };
        };
        /** @description Request unavailable or rejected */
        504: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
                /** @enum {string} */
                providerOperation?: "transcription" | "summary" | "question";
                upstreamStatus?: number;
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
  "/v1/tenants/{tenantId}/email-settings": {
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
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Redacted tenant SMTP settings */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              configured: boolean;
              host?: string;
              port?: number;
              username?: string;
              from?: string;
              /** @enum {string} */
              security?: "tls" | "starttls";
              passwordConfigured?: boolean;
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
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            host: string;
            port: number;
            /** @default  */
            username?: string;
            password?: string | null;
            /** Format: email */
            from: string;
            /** @enum {string} */
            security: "tls" | "starttls";
          };
        };
      };
      responses: {
        /** @description Saved tenant SMTP settings */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              configured: boolean;
              host?: string;
              port?: number;
              username?: string;
              from?: string;
              /** @enum {string} */
              security?: "tls" | "starttls";
              passwordConfigured?: boolean;
            };
          };
        };
      };
    };
    post?: never;
    delete: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Removed tenant SMTP settings */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** @enum {boolean} */
              configured: false;
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
  "/v1/tenants/{tenantId}/email-settings/test": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Test email sent to the authenticated actor */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** @enum {boolean} */
              sent: true;
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
  "/v1/personal-integrations/bookings": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query: {
          from: string;
          to: string;
          timeZone: string;
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** Format: uuid */
                id: string;
                tenantId: number;
                tenantSlug: string;
                tenantName: string;
                serviceName: string;
                professionalName: string;
                customerName: string;
                /** Format: email */
                customerEmail: string;
                /** Format: date-time */
                startsAt: string;
                /** Format: date-time */
                endsAt: string;
                timeZone: string;
                /** @enum {string} */
                status: "confirmed";
                version: number;
                externalEvent: {
                  /** @enum {string} */
                  provider: "google_calendar" | "outlook";
                  id: string;
                } | null;
                conference?: {
                  /** @enum {string|null} */
                  provider: "google_meet" | "teams" | "jitsi" | null;
                  /** Format: uri */
                  joinUrl: string | null;
                  /** @enum {string} */
                  status: "ready" | "pending" | "unsupported" | "failed";
                } | null;
              }[];
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/tenants/{tenantId}/booking/agenda": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
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
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                agenda: {
                  enabled: boolean;
                  sourceCount: number;
                };
                settings: {
                  version: number;
                  enabled: boolean;
                  published: boolean;
                  title: string;
                  description: string;
                  /**
                   * @default automatic
                   * @enum {string}
                   */
                  conferenceProvider: "automatic" | "jitsi";
                  timeZone: string;
                  leadMinutes: number;
                  horizonDays: number;
                  cancellationMinutes: number;
                  reminderMinutes: number;
                  services: {
                    /** Format: uuid */
                    id: string;
                    name: string;
                    description: string;
                    durationMinutes: number;
                    bufferMinutes: number;
                    enabled: boolean;
                    professionalIds: string[];
                  }[];
                  professionals: {
                    /** Format: uuid */
                    id: string;
                    principalId: string;
                    enabled: boolean;
                    weekly: {
                      day: number;
                      start: string;
                      end: string;
                    }[];
                    exceptions: {
                      date: string;
                      periods: {
                        start: string;
                        end: string;
                      }[];
                    }[];
                  }[];
                };
                candidates: {
                  principalId: string;
                  displayName: string;
                }[];
                canManage: boolean;
                principalId: string;
                publicUrl: string | null;
                calendar: {
                  /** @enum {string|null} */
                  provider: "google_calendar" | "outlook" | null;
                  status: string;
                };
              };
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/tenants/{tenantId}/booking": {
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
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                agenda: {
                  enabled: boolean;
                  sourceCount: number;
                };
                settings: {
                  version: number;
                  enabled: boolean;
                  published: boolean;
                  title: string;
                  description: string;
                  /**
                   * @default automatic
                   * @enum {string}
                   */
                  conferenceProvider: "automatic" | "jitsi";
                  timeZone: string;
                  leadMinutes: number;
                  horizonDays: number;
                  cancellationMinutes: number;
                  reminderMinutes: number;
                  services: {
                    /** Format: uuid */
                    id: string;
                    name: string;
                    description: string;
                    durationMinutes: number;
                    bufferMinutes: number;
                    enabled: boolean;
                    professionalIds: string[];
                  }[];
                  professionals: {
                    /** Format: uuid */
                    id: string;
                    principalId: string;
                    enabled: boolean;
                    weekly: {
                      day: number;
                      start: string;
                      end: string;
                    }[];
                    exceptions: {
                      date: string;
                      periods: {
                        start: string;
                        end: string;
                      }[];
                    }[];
                  }[];
                };
                candidates: {
                  principalId: string;
                  displayName: string;
                }[];
                canManage: boolean;
                principalId: string;
                publicUrl: string | null;
                calendar: {
                  /** @enum {string|null} */
                  provider: "google_calendar" | "outlook" | null;
                  status: string;
                };
              };
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
    put: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            version: number;
            enabled: boolean;
            published: boolean;
            title: string;
            description: string;
            /**
             * @default automatic
             * @enum {string}
             */
            conferenceProvider?: "automatic" | "jitsi";
            timeZone: string;
            leadMinutes: number;
            horizonDays: number;
            cancellationMinutes: number;
            reminderMinutes: number;
            services: {
              /** Format: uuid */
              id: string;
              name: string;
              description: string;
              durationMinutes: number;
              bufferMinutes: number;
              enabled: boolean;
              professionalIds: string[];
            }[];
            professionals: {
              /** Format: uuid */
              id: string;
              principalId: string;
              enabled: boolean;
              weekly: {
                day: number;
                start: string;
                end: string;
              }[];
              exceptions: {
                date: string;
                periods: {
                  start: string;
                  end: string;
                }[];
              }[];
            }[];
          };
        };
      };
      responses: {
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                agenda: {
                  enabled: boolean;
                  sourceCount: number;
                };
                settings: {
                  version: number;
                  enabled: boolean;
                  published: boolean;
                  title: string;
                  description: string;
                  /**
                   * @default automatic
                   * @enum {string}
                   */
                  conferenceProvider: "automatic" | "jitsi";
                  timeZone: string;
                  leadMinutes: number;
                  horizonDays: number;
                  cancellationMinutes: number;
                  reminderMinutes: number;
                  services: {
                    /** Format: uuid */
                    id: string;
                    name: string;
                    description: string;
                    durationMinutes: number;
                    bufferMinutes: number;
                    enabled: boolean;
                    professionalIds: string[];
                  }[];
                  professionals: {
                    /** Format: uuid */
                    id: string;
                    principalId: string;
                    enabled: boolean;
                    weekly: {
                      day: number;
                      start: string;
                      end: string;
                    }[];
                    exceptions: {
                      date: string;
                      periods: {
                        start: string;
                        end: string;
                      }[];
                    }[];
                  }[];
                };
                candidates: {
                  principalId: string;
                  displayName: string;
                }[];
                canManage: boolean;
                principalId: string;
                publicUrl: string | null;
                calendar: {
                  /** @enum {string|null} */
                  provider: "google_calendar" | "outlook" | null;
                  status: string;
                };
              };
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/tenants/{tenantId}/booking/availability": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            version: number;
            weekly: {
              day: number;
              start: string;
              end: string;
            }[];
            exceptions: {
              date: string;
              periods: {
                start: string;
                end: string;
              }[];
            }[];
          };
        };
      };
      responses: {
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                agenda: {
                  enabled: boolean;
                  sourceCount: number;
                };
                settings: {
                  version: number;
                  enabled: boolean;
                  published: boolean;
                  title: string;
                  description: string;
                  /**
                   * @default automatic
                   * @enum {string}
                   */
                  conferenceProvider: "automatic" | "jitsi";
                  timeZone: string;
                  leadMinutes: number;
                  horizonDays: number;
                  cancellationMinutes: number;
                  reminderMinutes: number;
                  services: {
                    /** Format: uuid */
                    id: string;
                    name: string;
                    description: string;
                    durationMinutes: number;
                    bufferMinutes: number;
                    enabled: boolean;
                    professionalIds: string[];
                  }[];
                  professionals: {
                    /** Format: uuid */
                    id: string;
                    principalId: string;
                    enabled: boolean;
                    weekly: {
                      day: number;
                      start: string;
                      end: string;
                    }[];
                    exceptions: {
                      date: string;
                      periods: {
                        start: string;
                        end: string;
                      }[];
                    }[];
                  }[];
                };
                candidates: {
                  principalId: string;
                  displayName: string;
                }[];
                canManage: boolean;
                principalId: string;
                publicUrl: string | null;
                calendar: {
                  /** @enum {string|null} */
                  provider: "google_calendar" | "outlook" | null;
                  status: string;
                };
              };
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/tenants/{tenantId}/booking/calendar": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            /** @enum {string|null} */
            provider: "google_calendar" | "outlook" | null;
          };
        };
      };
      responses: {
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                agenda: {
                  enabled: boolean;
                  sourceCount: number;
                };
                settings: {
                  version: number;
                  enabled: boolean;
                  published: boolean;
                  title: string;
                  description: string;
                  /**
                   * @default automatic
                   * @enum {string}
                   */
                  conferenceProvider: "automatic" | "jitsi";
                  timeZone: string;
                  leadMinutes: number;
                  horizonDays: number;
                  cancellationMinutes: number;
                  reminderMinutes: number;
                  services: {
                    /** Format: uuid */
                    id: string;
                    name: string;
                    description: string;
                    durationMinutes: number;
                    bufferMinutes: number;
                    enabled: boolean;
                    professionalIds: string[];
                  }[];
                  professionals: {
                    /** Format: uuid */
                    id: string;
                    principalId: string;
                    enabled: boolean;
                    weekly: {
                      day: number;
                      start: string;
                      end: string;
                    }[];
                    exceptions: {
                      date: string;
                      periods: {
                        start: string;
                        end: string;
                      }[];
                    }[];
                  }[];
                };
                candidates: {
                  principalId: string;
                  displayName: string;
                }[];
                canManage: boolean;
                principalId: string;
                publicUrl: string | null;
                calendar: {
                  /** @enum {string|null} */
                  provider: "google_calendar" | "outlook" | null;
                  status: string;
                };
              };
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/tenants/{tenantId}/booking/reservations": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query: {
          from: string;
          to: string;
        };
        header?: never;
        path: {
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                serviceId: string;
                /** Format: uuid */
                professionalId: string;
                serviceName: string;
                professionalName: string;
                startsAt: string;
                endsAt: string;
                customerName: string;
                customerEmail: string;
                /** @enum {string} */
                status: "confirmed" | "cancelled";
                version: number;
                deliveryStatus: string;
                calendarStatus: string;
                canGenerateConference?: boolean;
                conference?: {
                  /** @enum {string|null} */
                  provider: "google_meet" | "teams" | "jitsi" | null;
                  /** Format: uri */
                  joinUrl: string | null;
                  /** @enum {string} */
                  status: "ready" | "pending" | "unsupported" | "failed";
                } | null;
              }[];
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/tenants/{tenantId}/booking/reservations/{id}/conference": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
          id: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            version: number;
          };
        };
      };
      responses: {
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                serviceId: string;
                /** Format: uuid */
                professionalId: string;
                serviceName: string;
                professionalName: string;
                startsAt: string;
                endsAt: string;
                customerName: string;
                customerEmail: string;
                /** @enum {string} */
                status: "confirmed" | "cancelled";
                version: number;
                deliveryStatus: string;
                calendarStatus: string;
                canGenerateConference?: boolean;
                conference?: {
                  /** @enum {string|null} */
                  provider: "google_meet" | "teams" | "jitsi" | null;
                  /** Format: uri */
                  joinUrl: string | null;
                  /** @enum {string} */
                  status: "ready" | "pending" | "unsupported" | "failed";
                } | null;
              };
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
  "/v1/tenants/{tenantId}/booking/reservations/{id}/cancel": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
          id: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            version: number;
          };
        };
      };
      responses: {
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                serviceId: string;
                /** Format: uuid */
                professionalId: string;
                serviceName: string;
                professionalName: string;
                startsAt: string;
                endsAt: string;
                customerName: string;
                customerEmail: string;
                /** @enum {string} */
                status: "confirmed" | "cancelled";
                version: number;
                deliveryStatus: string;
                calendarStatus: string;
                canGenerateConference?: boolean;
                conference?: {
                  /** @enum {string|null} */
                  provider: "google_meet" | "teams" | "jitsi" | null;
                  /** Format: uri */
                  joinUrl: string | null;
                  /** @enum {string} */
                  status: "ready" | "pending" | "unsupported" | "failed";
                } | null;
              };
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
  "/v1/tenants/{tenantId}/booking/public-links": {
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
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                [key: string]: unknown;
              };
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            scope:
              | {
                  /** @enum {string} */
                  kind: "team";
                }
              | {
                  /** @enum {string} */
                  kind: "professional";
                  /** Format: uuid */
                  professionalId: string;
                };
            /**
             * Format: uuid
             * @default null
             */
            serviceId?: string | null;
            /** Format: date-time */
            expiresAt?: string | null;
            /** @default 25 */
            dailyLimit?: number;
          };
        };
      };
      responses: {
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                [key: string]: unknown;
              };
            };
          };
        };
        /** @description Confirmed reservation */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                [key: string]: unknown;
              };
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
  "/v1/tenants/{tenantId}/booking/public-links/{id}/revoke": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
          id: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            version: number;
          };
        };
      };
      responses: {
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                [key: string]: unknown;
              };
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
  "/v1/tenants/{tenantId}/booking/public-links/{id}/short-url": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
          id: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                [key: string]: unknown;
              };
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
  "/v1/tenants/{tenantId}/booking/public-links/{id}": {
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
          tenantId: number;
          id: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            version: number;
          };
        };
      };
      responses: {
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                [key: string]: unknown;
              };
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
  "/s/b/{code}": {
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
          code: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Redirect to the public booking page */
        302: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable link */
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
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/bookings/{token}": {
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
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                [key: string]: unknown;
              };
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/bookings/{token}/challenge": {
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
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                [key: string]: unknown;
              };
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/bookings/{token}/slots": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query: {
          serviceId: string;
          professionalId?: string;
          date: string;
        };
        header?: never;
        path: {
          token: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                [key: string]: unknown;
              };
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/bookings/{token}/availability": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query: {
          serviceId: string;
          professionalId?: string;
          from: string;
          to: string;
          displayTimeZone?: string;
        };
        header?: never;
        path: {
          token: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                displayTimeZone: string;
                businessTimeZone: string;
                days: {
                  date: string;
                  slots: {
                    startsAt: string;
                    endsAt: string;
                  }[];
                }[];
              };
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/bookings/{token}/reservations": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
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
            serviceId: string;
            /** Format: uuid */
            professionalId?: string;
            /**
             * @default en
             * @enum {string}
             */
            customerLocale?: "en" | "es" | "pt";
            /** Format: date-time */
            startsAt: string;
            customerName: string;
            /** Format: email */
            customerEmail: string;
            /** @default  */
            captchaToken?: string;
          };
        };
      };
      responses: {
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                reservation: {
                  /** Format: uuid */
                  id: string;
                  /** Format: uuid */
                  serviceId: string;
                  /** Format: uuid */
                  professionalId: string;
                  serviceName: string;
                  professionalName: string;
                  startsAt: string;
                  endsAt: string;
                  customerName: string;
                  customerEmail: string;
                  /** @enum {string} */
                  status: "confirmed" | "cancelled";
                  version: number;
                  deliveryStatus: string;
                  calendarStatus: string;
                  canGenerateConference?: boolean;
                  conference?: {
                    /** @enum {string|null} */
                    provider: "google_meet" | "teams" | "jitsi" | null;
                    /** Format: uri */
                    joinUrl: string | null;
                    /** @enum {string} */
                    status: "ready" | "pending" | "unsupported" | "failed";
                  } | null;
                };
                managementUrl: string;
              };
            };
          };
        };
        /** @description Confirmed reservation */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                reservation: {
                  /** Format: uuid */
                  id: string;
                  /** Format: uuid */
                  serviceId: string;
                  /** Format: uuid */
                  professionalId: string;
                  serviceName: string;
                  professionalName: string;
                  startsAt: string;
                  endsAt: string;
                  customerName: string;
                  customerEmail: string;
                  /** @enum {string} */
                  status: "confirmed" | "cancelled";
                  version: number;
                  deliveryStatus: string;
                  calendarStatus: string;
                  canGenerateConference?: boolean;
                  conference?: {
                    /** @enum {string|null} */
                    provider: "google_meet" | "teams" | "jitsi" | null;
                    /** Format: uri */
                    joinUrl: string | null;
                    /** @enum {string} */
                    status: "ready" | "pending" | "unsupported" | "failed";
                  } | null;
                };
                managementUrl: string;
              };
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
  "/api/public/bookings/manage/{token}": {
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
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                reservation: {
                  /** Format: uuid */
                  id: string;
                  /** Format: uuid */
                  serviceId: string;
                  /** Format: uuid */
                  professionalId: string;
                  serviceName: string;
                  professionalName: string;
                  startsAt: string;
                  endsAt: string;
                  customerName: string;
                  customerEmail: string;
                  /** @enum {string} */
                  status: "confirmed" | "cancelled";
                  version: number;
                  deliveryStatus: string;
                  calendarStatus: string;
                  canGenerateConference?: boolean;
                  conference?: {
                    /** @enum {string|null} */
                    provider: "google_meet" | "teams" | "jitsi" | null;
                    /** Format: uri */
                    joinUrl: string | null;
                    /** @enum {string} */
                    status: "ready" | "pending" | "unsupported" | "failed";
                  } | null;
                };
                publicUrl: string | null;
                timeZone: string;
                cancellationMinutes: number;
                horizonDays: number;
                leadMinutes: number;
                canReschedule: boolean;
              };
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/bookings/manage/{token}/availability": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query: {
          serviceId: string;
          professionalId?: string;
          from: string;
          to: string;
          displayTimeZone?: string;
        };
        header?: never;
        path: {
          token: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                displayTimeZone: string;
                businessTimeZone: string;
                days: {
                  date: string;
                  slots: {
                    startsAt: string;
                    endsAt: string;
                  }[];
                }[];
              };
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/bookings/manage/{token}/slots": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query: {
          date: string;
        };
        header?: never;
        path: {
          token: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                [key: string]: unknown;
              };
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/bookings/manage/{token}/cancel": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
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
            version: number;
          };
        };
      };
      responses: {
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                serviceId: string;
                /** Format: uuid */
                professionalId: string;
                serviceName: string;
                professionalName: string;
                startsAt: string;
                endsAt: string;
                customerName: string;
                customerEmail: string;
                /** @enum {string} */
                status: "confirmed" | "cancelled";
                version: number;
                deliveryStatus: string;
                calendarStatus: string;
                canGenerateConference?: boolean;
                conference?: {
                  /** @enum {string|null} */
                  provider: "google_meet" | "teams" | "jitsi" | null;
                  /** Format: uri */
                  joinUrl: string | null;
                  /** @enum {string} */
                  status: "ready" | "pending" | "unsupported" | "failed";
                } | null;
              };
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
  "/api/public/bookings/manage/{token}/reschedule": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
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
            version: number;
            /** Format: date-time */
            startsAt: string;
          };
        };
      };
      responses: {
        /** @description Booking response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                serviceId: string;
                /** Format: uuid */
                professionalId: string;
                serviceName: string;
                professionalName: string;
                startsAt: string;
                endsAt: string;
                customerName: string;
                customerEmail: string;
                /** @enum {string} */
                status: "confirmed" | "cancelled";
                version: number;
                deliveryStatus: string;
                calendarStatus: string;
                canGenerateConference?: boolean;
                conference?: {
                  /** @enum {string|null} */
                  provider: "google_meet" | "teams" | "jitsi" | null;
                  /** Format: uri */
                  joinUrl: string | null;
                  /** @enum {string} */
                  status: "ready" | "pending" | "unsupported" | "failed";
                } | null;
              };
            };
          };
        };
        /** @description Malformed input */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Access or verification denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Unavailable resource */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Slot or revision conflict */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid input */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Request limit */
        429: {
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
  "/v1/tenants/{tenantId}/sso-settings": {
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
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Redacted tenant SAML SSO settings */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              configured: boolean;
              displayName?: string;
              domain?: string;
              idpMetadata?: string;
              enabled?: boolean;
              ssoOnly?: boolean;
              providerId?: string;
              entityId?: string;
              acsUrl?: string;
              metadataUrl?: string;
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
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            displayName: string;
            domain: string;
            idpMetadata: string;
            enabled: boolean;
            ssoOnly: boolean;
          };
        };
      };
      responses: {
        /** @description Saved tenant SAML SSO settings */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              configured: boolean;
              displayName?: string;
              domain?: string;
              idpMetadata?: string;
              enabled?: boolean;
              ssoOnly?: boolean;
              providerId?: string;
              entityId?: string;
              acsUrl?: string;
              metadataUrl?: string;
            };
          };
        };
      };
    };
    post?: never;
    delete: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Removed tenant SAML SSO settings */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              /** @enum {boolean} */
              configured: false;
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
  "/v1/tenants/{tenantId}/social-settings": {
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
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Tenant Google, Microsoft, and ChatGPT sign-in settings */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              configured: boolean;
              googleEnabled: boolean;
              microsoftEnabled: boolean;
              /** @default false */
              chatgptEnabled: boolean;
              /** @default false */
              allowRegistration: boolean;
              /** @default false */
              allowMicrosoftPersonalAccounts: boolean;
              microsoftTenantId: string;
              emailReady?: boolean;
              googleAvailable: boolean;
              microsoftAvailable: boolean;
              /** @default false */
              chatgptAvailable: boolean;
              googleCallbackUrl: string;
              microsoftCallbackUrl: string;
              /** @default  */
              chatgptCallbackUrl: string;
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
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            googleEnabled: boolean;
            microsoftEnabled: boolean;
            /** @default false */
            chatgptEnabled?: boolean;
            /** @default false */
            allowRegistration?: boolean;
            /** @default false */
            allowMicrosoftPersonalAccounts?: boolean;
            microsoftTenantId: string;
          };
        };
      };
      responses: {
        /** @description Saved tenant Google, Microsoft, and ChatGPT sign-in settings */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              configured: boolean;
              googleEnabled: boolean;
              microsoftEnabled: boolean;
              /** @default false */
              chatgptEnabled: boolean;
              /** @default false */
              allowRegistration: boolean;
              /** @default false */
              allowMicrosoftPersonalAccounts: boolean;
              microsoftTenantId: string;
              emailReady?: boolean;
              googleAvailable: boolean;
              microsoftAvailable: boolean;
              /** @default false */
              chatgptAvailable: boolean;
              googleCallbackUrl: string;
              microsoftCallbackUrl: string;
              /** @default  */
              chatgptCallbackUrl: string;
            };
          };
        };
      };
    };
    post?: never;
    delete: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Removed tenant social login settings */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              configured: boolean;
              googleEnabled: boolean;
              microsoftEnabled: boolean;
              /** @default false */
              chatgptEnabled: boolean;
              /** @default false */
              allowRegistration: boolean;
              /** @default false */
              allowMicrosoftPersonalAccounts: boolean;
              microsoftTenantId: string;
              emailReady?: boolean;
              googleAvailable: boolean;
              microsoftAvailable: boolean;
              /** @default false */
              chatgptAvailable: boolean;
              googleCallbackUrl: string;
              microsoftCallbackUrl: string;
              /** @default  */
              chatgptCallbackUrl: string;
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
  "/v1/tenants/{tenantId}/registration-settings": {
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
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Safe tenant registration settings and readiness */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              allowEmailRegistration: boolean;
              /** @enum {string} */
              captchaMode: "inherit" | "tenant";
              siteKey: string;
              secretConfigured: boolean;
              emailReady: boolean;
              revision: string;
              passwordAllowed?: boolean;
              /** @enum {string} */
              captchaProvider: "turnstile" | "altcha";
              captchaReady: boolean;
              registrationReady: boolean;
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
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            allowEmailRegistration: boolean;
            /** @enum {string} */
            captchaMode: "inherit" | "tenant";
            siteKey?: string;
            secretKey?: string | null;
          };
        };
      };
      responses: {
        /** @description Safe tenant registration settings and readiness */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              allowEmailRegistration: boolean;
              /** @enum {string} */
              captchaMode: "inherit" | "tenant";
              siteKey: string;
              secretConfigured: boolean;
              emailReady: boolean;
              revision: string;
              passwordAllowed?: boolean;
              /** @enum {string} */
              captchaProvider: "turnstile" | "altcha";
              captchaReady: boolean;
              registrationReady: boolean;
            };
          };
        };
      };
    };
    post?: never;
    delete: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Safe tenant registration settings and readiness */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              allowEmailRegistration: boolean;
              /** @enum {string} */
              captchaMode: "inherit" | "tenant";
              siteKey: string;
              secretConfigured: boolean;
              emailReady: boolean;
              revision: string;
              passwordAllowed?: boolean;
              /** @enum {string} */
              captchaProvider: "turnstile" | "altcha";
              captchaReady: boolean;
              registrationReady: boolean;
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
  "/v1/public/registration": {
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
        /** @description Tenant registration response */
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
        /** @description Tenant registration response */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              [key: string]: unknown;
            };
          };
        };
        /** @description Tenant registration response */
        503: {
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
            name: string;
            /** Format: email */
            email: string;
            password: string;
            passwordConfirmation: string;
            captchaToken: string;
            /** Format: uuid */
            requestId: string;
          };
        };
      };
      responses: {
        /** @description Tenant registration response */
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
        /** @description Tenant registration response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              [key: string]: unknown;
            };
          };
        };
        /** @description Tenant registration response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              [key: string]: unknown;
            };
          };
        };
        /** @description Tenant registration response */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              [key: string]: unknown;
            };
          };
        };
        /** @description Tenant registration response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              [key: string]: unknown;
            };
          };
        };
        /** @description Tenant registration response */
        503: {
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
  "/v1/public/registration/challenge": {
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
        /** @description Tenant registration response */
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
        /** @description Tenant registration response */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              [key: string]: unknown;
            };
          };
        };
        /** @description Tenant registration response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              [key: string]: unknown;
            };
          };
        };
        /** @description Tenant registration response */
        503: {
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
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/access-control/audit": {
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
          limit?: number;
          cursor?: string;
          action?: "role.saved" | "role.deleted" | "assignments.saved";
          actorId?: string;
          targetId?: string;
          from?: string;
          to?: string;
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
              data: {
                id: string;
                scope: string;
                actor: {
                  id: string;
                  displayName: string;
                };
                action: string;
                targetId: string;
                createdAt: string;
              }[];
              nextCursor: string | null;
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
  "/v1/access-control/audit/{id}": {
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
              id: string;
              scope: string;
              actor: {
                id: string;
                displayName: string;
              };
              action: string;
              targetId: string;
              createdAt: string;
              before: unknown;
              after: unknown;
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
                /** @enum {string} */
                source?: "system" | "custom";
                assignedUsers?: {
                  id: string;
                  displayName: string;
                  email: string | null;
                }[];
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
  "/v1/companion/session": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get the current mobile Companion session and workspaces */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Safe identity and eligible workspace selection data */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              subject: string;
              displayName: string;
              workspaces: {
                id: number;
                name: string;
                slug: string;
              }[];
              grantedRecordingScopes: (
                "recordings:read" | "recordings:upload" | "recordings:process"
              )[];
            };
          };
        };
        /** @description A recording-scoped OAuth session is required */
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
  "/v1/identity/users": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List Savia users
     * @description Platform administrators see all users; tenant administrators see members of their active tenant.
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
                    emailVerified?: boolean;
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
        /** @description Platform or tenant administrator role is required */
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
     * @description Creates a Better Auth user and Savia principal. Tenant administrators can create users only in their active tenant; platform administrators can also create platform administrators.
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
            /** @default false */
            emailVerified?: boolean;
            temporaryPassword?: string;
            membership?: {
              tenantId?: number;
              agencyId?: number;
              /** @enum {string} */
              role: "tenant_admin" | "agency_admin" | "operator" | "viewer";
            };
            accessRoleIds?: string[];
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
                    emailVerified?: boolean;
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
        /** @description Platform or tenant administrator role is required */
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
        /** @description Email conflict, tenant membership invariant, or active-user capacity prevented provisioning */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description One or more custom access roles are unavailable in the destination tenant */
        422: {
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
                    emailVerified?: boolean;
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
        /** @description Platform or tenant administrator role is required */
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
        /** @description Tenant membership invariant or active-user capacity prevented assignment */
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
                    emailVerified?: boolean;
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
        /** @description Platform or tenant administrator role is required */
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
        /** @description Platform or tenant administrator role is required */
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
            emailVerified?: boolean;
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
                    emailVerified?: boolean;
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
        /** @description Platform or tenant administrator role is required */
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
        /** @description Tenant membership invariant or active-user capacity prevented the update */
        409: {
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
        /** @description Platform or tenant administrator role is required */
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
        /** @description Identity or tenant capacity constraints prevented the operation */
        409: {
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
        /** @description Platform or tenant administrator role is required */
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
        /** @description Identity or tenant capacity constraints prevented the operation */
        409: {
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
        /** @description Platform or tenant administrator role is required */
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
        /** @description Identity or tenant capacity constraints prevented the operation */
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
        /** @description Platform or tenant administrator role is required */
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
        /** @description Identity or tenant capacity constraints prevented the operation */
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
                grantTypes: ("authorization_code" | "refresh_token")[];
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
            applicationType?: "native" | "web";
            /** @enum {string} */
            clientAuthentication:
              "none" | "client_secret_basic" | "client_secret_post";
            clientName: string;
            grantTypes?: ("authorization_code" | "refresh_token")[];
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
                grantTypes: ("authorization_code" | "refresh_token")[];
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
            /** @enum {string} */
            applicationType?: "native" | "web";
            clientName?: string;
            grantTypes?: ("authorization_code" | "refresh_token")[];
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
                grantTypes: ("authorization_code" | "refresh_token")[];
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
            topics: (
              | "users"
              | "tenants"
              | "records"
              | "access-control"
              | "studio"
              | "settings"
              | "integrations"
              | "workflows"
              | "notifications"
              | "personal-integrations"
              | "account"
            )[];
            tenantId?: number;
            principalId?: string;
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
                topics: (
                  | "users"
                  | "tenants"
                  | "records"
                  | "access-control"
                  | "studio"
                  | "settings"
                  | "integrations"
                  | "workflows"
                  | "notifications"
                  | "personal-integrations"
                  | "account"
                )[];
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
  "/api/public/workflow-webhooks/{endpointId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Accept an authenticated webhook event
     * @description Requires endpoint bearer secret and Idempotency-Key. JSON object, at most 32 KiB. Accepted means queued.
     */
    post: {
      parameters: {
        query?: never;
        header: {
          authorization: string;
          "idempotency-key": string;
        };
        path: {
          endpointId: string;
        };
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
        /** @description Durably accepted event */
        202: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                executionId: string;
                duplicate: boolean;
              };
            };
          };
        };
        /** @description Invalid endpoint credentials */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Inactive workflow or conflicting event */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Body exceeds 32 KiB */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid JSON or key */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Admission limit reached */
        429: {
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
  "/v1/public-forms/{id}/short-url": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
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
        /** @description Public form response */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              [key: string]: unknown;
            };
          };
        };
        /** @description Public form response */
        503: {
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
  "/s/{code}": {
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
          code: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Redirect to the published public form */
        302: {
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
          tenantId?: number | null;
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
            tenantId: number | null;
            objectName: string;
            /** @enum {string} */
            kind: "record" | "quote";
            /** Format: date-time */
            expiresAt?: string;
            /** @default 25 */
            dailyLimit?: number;
            /** @default false */
            returnResult?: boolean;
            logoImage?: string;
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
        query?: {
          hard?: string;
        };
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
        /** @description Public form response */
        404: {
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
  "/api/public/forms/{token}/challenge": {
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
    post?: never;
    delete?: never;
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
  "/api/public/forms/{token}/cities": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query: {
          search: string;
        };
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
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/forms/{token}/status/{submissionId}": {
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
          submissionId: string;
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
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/forms/{token}/vehicle-lookup": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
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
            plate: string;
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
          tenantId?: number | null;
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
                tenantId: number;
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
            tenantId: number | null;
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
              tenantId: number;
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
                  connectionBlocked?: boolean;
                  /** @enum {string} */
                  activeProvider?:
                    "hubspot" | "salesforce" | "zoho" | "pipedrive";
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
    /** List the current user’s active CRM connection in the selected organization */
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
        /** @description The organization already has a CRM connection */
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
        /** @description The organization already has a CRM connection */
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
        /** @description The organization already has a CRM connection */
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
  "/v1/tenant-workspaces": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List authorized tenant workspaces */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Authorized tenant workspaces */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                tenantId: number;
                label: string;
                /** @enum {string} */
                kind: "platform" | "tenant";
                apiBasePath: string;
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
  "/v1/tenants/{tenantId}/user-capacity": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read tenant active-user capacity */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Tenant active-user capacity */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                tenantId: number;
                maxActiveUsers: number | null;
                activeUsers: number;
              };
            };
          };
        };
        /** @description Tenant administration is required; only platform administrators may change capacity */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Commercial tenant not found */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    /** Set tenant active-user capacity */
    put: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            maxActiveUsers: number | null;
          };
        };
      };
      responses: {
        /** @description Tenant active-user capacity */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                tenantId: number;
                maxActiveUsers: number | null;
                activeUsers: number;
              };
            };
          };
        };
        /** @description Tenant administration is required; only platform administrators may change capacity */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Commercial tenant not found */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
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
  "/v1/personal-integrations/providers": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List the available personal integrations
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
                  | "onedrive_business"
                  | "jira"
                  | "linear"
                  | "github";
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
                    | "onedrive_business"
                    | "jira"
                    | "linear"
                    | "github";
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
                    | "onedrive_business"
                    | "jira"
                    | "linear"
                    | "github";
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
  "/v1/personal-integrations/issue-preview": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Preview a linked issue from a caller-owned integration
     * @description Parses supported Jira Cloud, Linear, and GitHub issue or pull request links, then reads safe summary metadata through the caller's active personal connection.
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
            url: string;
          };
        };
      };
      responses: {
        /** @description Transient issue preview for the current viewer */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {string} */
                provider: "jira" | "linear" | "github";
                /** Format: uri */
                url: string;
                identifier: string;
                title: string;
                status: string | null;
                assignee: string | null;
                repository?: string;
                /** @enum {string} */
                kind?: "issue" | "pull_request";
              };
            };
          };
        };
        /** @description Unsupported issue link */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description The connected account cannot access this issue */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Issue provider request failed */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Issue provider connection is unavailable */
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
          query?: string;
          cursor?: string;
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
                webLink: string | null;
              }[];
              pagination: {
                nextCursor: string | null;
              };
            };
          };
        };
        /** @description Invalid message cursor */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
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
    /** Send caller-confirmed mail from a personal mailbox */
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
            provider: "gmail" | "outlook";
            to: string[];
            subject: string;
            body: string;
            context?: {
              apiBasePath: string;
              collection: string;
              recordId: string;
              fields: string[];
            }[];
          };
        };
      };
      responses: {
        /** @description Mail submitted */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {string} */
                provider: "gmail" | "outlook";
                /** @enum {string} */
                action: "send-email";
              };
            };
          };
        };
        /** @description Invalid mail */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Context access denied */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Context record missing */
        404: {
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
        /** @description Connection unavailable */
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
                allDay?: boolean;
                timeZone?: string | null;
                conference?: {
                  /** @enum {string|null} */
                  provider: "google_meet" | "teams" | "jitsi" | null;
                  /** Format: uri */
                  joinUrl: string | null;
                  /** @enum {string} */
                  status: "ready" | "pending" | "unsupported" | "failed";
                };
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
            videoCall?: boolean;
            /** @enum {string} */
            conferenceProvider?: "jitsi";
            attendees?: string[];
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
                connectionId: string;
                title: string | null;
                startsAt: string | null;
                endsAt: string | null;
                /** Format: uri */
                webLink: string | null;
                conference?: {
                  /** @enum {string|null} */
                  provider: "google_meet" | "teams" | "jitsi" | null;
                  /** Format: uri */
                  joinUrl: string | null;
                  /** @enum {string} */
                  status: "ready" | "pending" | "unsupported" | "failed";
                };
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
  "/v1/personal-integrations/events/{provider}/{eventId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /**
     * Delete a confirmed event from a caller-owned calendar
     * @description Deletes one event from the caller's primary Google Calendar or Outlook calendar only after explicit confirmation. Savia booking events and recurring series are protected.
     */
    delete: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          provider: "google_calendar" | "outlook";
          eventId: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            /** @enum {boolean} */
            confirmed: true;
            connectionId: string;
          };
        };
      };
      responses: {
        /** @description Calendar event deleted */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {boolean} */
                deleted: true;
              };
            };
          };
        };
        /** @description Confirmation, event id, or event type is invalid */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
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
        /** @description Connection unavailable */
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
  "/v1/personal-integrations/calendars": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List shared calendar sources */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Calendar sources */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                /** @enum {string} */
                kind: "subscription" | "import";
                name: string;
                /**
                 * @default blue
                 * @enum {string}
                 */
                color:
                  "blue" | "emerald" | "violet" | "amber" | "rose" | "slate";
                /** @default UTC */
                timeZone: string;
                visible: boolean;
                hostname: string | null;
                lastSyncedAt: string | null;
                createdAt: string;
                updatedAt: string;
              }[];
            };
          };
        };
      };
    };
    put?: never;
    /** Add a shared calendar source */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: {
        content: {
          "application/json":
            | {
                /** @enum {string} */
                kind: "subscription";
                name: string;
                /**
                 * @default blue
                 * @enum {string}
                 */
                color?:
                  "blue" | "emerald" | "violet" | "amber" | "rose" | "slate";
                /** @default UTC */
                timeZone?: string;
                url: string;
              }
            | {
                /** @enum {string} */
                kind: "import";
                name: string;
                /**
                 * @default blue
                 * @enum {string}
                 */
                color?:
                  "blue" | "emerald" | "violet" | "amber" | "rose" | "slate";
                /** @default UTC */
                timeZone?: string;
                content: string;
              };
        };
      };
      responses: {
        /** @description Created calendar source */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                /** @enum {string} */
                kind: "subscription" | "import";
                name: string;
                /**
                 * @default blue
                 * @enum {string}
                 */
                color:
                  "blue" | "emerald" | "violet" | "amber" | "rose" | "slate";
                /** @default UTC */
                timeZone: string;
                visible: boolean;
                hostname: string | null;
                lastSyncedAt: string | null;
                createdAt: string;
                updatedAt: string;
              };
            };
          };
        };
        /** @description Invalid calendar source */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Calendar content exceeds the size limit */
        413: {
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
  "/v1/personal-integrations/calendars/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** Delete a shared calendar source */
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
        /** @description Calendar source deleted */
        204: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Calendar source not found */
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
    /** Update a shared calendar source */
    patch: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          id: string;
        };
        cookie?: never;
      };
      requestBody?: {
        content: {
          "application/json": {
            name?: string;
            /** @enum {string} */
            color?: "blue" | "emerald" | "violet" | "amber" | "rose" | "slate";
            timeZone?: string;
            visible?: boolean;
          };
        };
      };
      responses: {
        /** @description Updated calendar source */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                /** @enum {string} */
                kind: "subscription" | "import";
                name: string;
                /**
                 * @default blue
                 * @enum {string}
                 */
                color:
                  "blue" | "emerald" | "violet" | "amber" | "rose" | "slate";
                /** @default UTC */
                timeZone: string;
                visible: boolean;
                hostname: string | null;
                lastSyncedAt: string | null;
                createdAt: string;
                updatedAt: string;
              };
            };
          };
        };
        /** @description Calendar source not found */
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
  "/v1/personal-integrations/calendars/{id}/events": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read shared calendar events */
    get: {
      parameters: {
        query: {
          from: string;
          to: string;
          timeZone?: string;
          refresh?: "true" | "false";
        };
        header?: never;
        path: {
          id: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Events for the requested range */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                sourceId: string;
                title: string | null;
                startsAt: string;
                endsAt: string;
                allDay: boolean;
                busy?: boolean;
                webLink: string | null;
                timeZone: string;
              }[];
              stale: boolean;
              error: string | null;
              lastSyncedAt: string | null;
            };
          };
        };
        /** @description Calendar source not found */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Invalid or overlong range */
        422: {
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
  "/v1/personal-integrations/calendars/{id}/refresh": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Refresh a shared calendar subscription */
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
        /** @description Refreshed calendar source */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                /** @enum {string} */
                kind: "subscription" | "import";
                name: string;
                /**
                 * @default blue
                 * @enum {string}
                 */
                color:
                  "blue" | "emerald" | "violet" | "amber" | "rose" | "slate";
                /** @default UTC */
                timeZone: string;
                visible: boolean;
                hostname: string | null;
                lastSyncedAt: string | null;
                createdAt: string;
                updatedAt: string;
              };
            };
          };
        };
        /** @description Calendar source not found */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Imported copies cannot be refreshed */
        422: {
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
  "/v1/user-preferences/calendar": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read calendar visibility preferences */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Calendar visibility preferences */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @default true */
                google_calendar: boolean;
                /** @default true */
                outlook: boolean;
              };
            };
          };
        };
      };
    };
    /** Save calendar visibility preferences */
    put: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: {
        content: {
          "application/json": {
            /** @default true */
            google_calendar?: boolean;
            /** @default true */
            outlook?: boolean;
          };
        };
      };
      responses: {
        /** @description Saved calendar visibility preferences */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @default true */
                google_calendar: boolean;
                /** @default true */
                outlook: boolean;
              };
            };
          };
        };
        /** @description Invalid preferences */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
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
  "/v1/tenants/{tenantId}/pages-search-settings": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read tenant page-search settings */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Tenant page-search settings */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                tenantId: number;
                allowed: boolean;
                enabled: boolean;
                effectiveEnabled: boolean;
                canGrant: boolean;
              };
            };
          };
        };
        /** @description Invalid settings */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Tenant administration is required */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Active commercial tenant not found */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
      };
    };
    /** Update tenant page-search settings */
    put: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            allowed?: boolean;
            enabled?: boolean;
          };
        };
      };
      responses: {
        /** @description Tenant page-search settings */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                tenantId: number;
                allowed: boolean;
                enabled: boolean;
                effectiveEnabled: boolean;
                canGrant: boolean;
              };
            };
          };
        };
        /** @description Invalid settings */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Tenant administration is required */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Active commercial tenant not found */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
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
  "/v1/pages/search/status": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get authorized Pages indexing status */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Cloudflare Pages search */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                enabled: boolean;
                available: boolean;
                total: number;
                indexed: number;
                needed: string[];
              };
            };
          };
        };
        /** @description Search disabled */
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
        /** @description Page not found */
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
        /** @description Page changed or indexing is already in progress */
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
        /** @description Tenant search rate limit */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Search unavailable */
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
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/pages/search/index/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Index an accessible page in Cloudflare */
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
        /** @description Cloudflare Pages search */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                version: number;
                reused: boolean;
              };
            };
          };
        };
        /** @description Search disabled */
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
        /** @description Page not found */
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
        /** @description Page changed or indexing is already in progress */
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
        /** @description Tenant search rate limit */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Search unavailable */
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
  "/v1/pages/search": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Search accessible Pages semantically with Cloudflare */
    get: {
      parameters: {
        query: {
          q: string;
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Cloudflare Pages search */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                /** @enum {string} */
                kind: "page" | "folder";
                parentId: string | null;
                rootId: string;
                title: string;
                version: number;
                updatedAt: string;
                ownerId: string;
                /** @enum {string} */
                role: "owner" | "editor" | "reader";
                isShared: boolean;
                binding: {
                  domain: string;
                  collection: string;
                  recordId: string;
                } | null;
                score: number;
                excerpt?: string;
              }[];
            };
          };
        };
        /** @description Search disabled */
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
        /** @description Page not found */
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
        /** @description Page changed or indexing is already in progress */
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
        /** @description Tenant search rate limit */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Search unavailable */
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
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/pages/export": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Export all pages owned by the caller with referenced attachments */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Portable Pages archive */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {string} */
                format: "savia-pages";
                /** @enum {number} */
                version: 1;
                exportedAt: string;
                pages: {
                  id: string;
                  parentId: string | null;
                  title: string;
                  /** @enum {string} */
                  kind: "page" | "folder";
                  content: {
                    [key: string]: unknown;
                  }[];
                }[];
                files: {
                  id: string;
                  pageId: string;
                  name: string;
                  mimeType: string;
                  size: number;
                  data: string;
                }[];
              };
            };
          };
        };
        /** @description Export source changed or contains unavailable content */
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
        /** @description Archive exceeds the size limit */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Attachment storage is unavailable */
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
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/pages/import": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Import a portable Pages archive as private copies */
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
            format: "savia-pages";
            /** @enum {number} */
            version: 1;
            exportedAt: string;
            pages: {
              id: string;
              parentId: string | null;
              title: string;
              /** @enum {string} */
              kind: "page" | "folder";
              content: {
                [key: string]: unknown;
              }[];
            }[];
            files: {
              id: string;
              pageId: string;
              name: string;
              mimeType: string;
              size: number;
              data: string;
            }[];
          };
        };
      };
      responses: {
        /** @description Imported private copies */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                pages: number;
                folders: number;
                files: number;
              };
            };
          };
        };
        /** @description Archive is invalid */
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
        /** @description Archive exceeds the size limit */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Attachment storage is unavailable */
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
  "/v1/pages/capture": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Capture an HTTP(S) link as a private Page */
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
            captureId: string;
            title: string;
            url: string;
            note?: string;
            parentId?: string;
            folderTitle?: string;
          };
        };
      };
      responses: {
        /** @description Captured page document */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {string} */
                kind: "page" | "folder";
                id: string;
                parentId: string | null;
                rootId: string;
                title: string;
                version: number;
                updatedAt: string;
                ownerId: string;
                /** @enum {string} */
                role: "owner" | "editor" | "reader";
                isShared: boolean;
                binding: {
                  domain: string;
                  collection: string;
                  recordId: string;
                } | null;
                excerpt?: string;
                content: {
                  [key: string]: unknown;
                }[];
              };
            };
          };
        };
        /** @description Captured page document */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {string} */
                kind: "page" | "folder";
                id: string;
                parentId: string | null;
                rootId: string;
                title: string;
                version: number;
                updatedAt: string;
                ownerId: string;
                /** @enum {string} */
                role: "owner" | "editor" | "reader";
                isShared: boolean;
                binding: {
                  domain: string;
                  collection: string;
                  recordId: string;
                } | null;
                excerpt?: string;
                content: {
                  [key: string]: unknown;
                }[];
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
        /** @description Page not found */
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
        /** @description Version conflict */
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
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/pages": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List pages accessible to the caller */
    get: {
      parameters: {
        query?: {
          q?: string;
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Accessible page summaries */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {string} */
                kind: "page" | "folder";
                id: string;
                parentId: string | null;
                rootId: string;
                title: string;
                version: number;
                updatedAt: string;
                ownerId: string;
                /** @enum {string} */
                role: "owner" | "editor" | "reader";
                isShared: boolean;
                binding: {
                  domain: string;
                  collection: string;
                  recordId: string;
                } | null;
                excerpt?: string;
              }[];
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
        /** @description Page not found */
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
        /** @description Version conflict */
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
    /** Create a private page or folder, optionally nested */
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
            title: string;
            /** @enum {string} */
            kind?: "page" | "folder";
            parentId?: string;
            binding?: {
              domain: string;
              collection: string;
              recordId: string;
            } | null;
          };
        };
      };
      responses: {
        /** @description Created page document */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {string} */
                kind: "page" | "folder";
                id: string;
                parentId: string | null;
                rootId: string;
                title: string;
                version: number;
                updatedAt: string;
                ownerId: string;
                /** @enum {string} */
                role: "owner" | "editor" | "reader";
                isShared: boolean;
                binding: {
                  domain: string;
                  collection: string;
                  recordId: string;
                } | null;
                excerpt?: string;
                content: {
                  [key: string]: unknown;
                }[];
              };
            };
          };
        };
        /** @description Created page document */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {string} */
                kind: "page" | "folder";
                id: string;
                parentId: string | null;
                rootId: string;
                title: string;
                version: number;
                updatedAt: string;
                ownerId: string;
                /** @enum {string} */
                role: "owner" | "editor" | "reader";
                isShared: boolean;
                binding: {
                  domain: string;
                  collection: string;
                  recordId: string;
                } | null;
                excerpt?: string;
                content: {
                  [key: string]: unknown;
                }[];
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
        /** @description Page not found */
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
        /** @description Version conflict */
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
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/pages/members": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List active members of the caller's tenant */
    get: {
      parameters: {
        query?: {
          q?: string;
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Safe member summaries */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                principalId: string;
                displayName: string;
                email: string;
              }[];
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
        /** @description Page not found */
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
        /** @description Version conflict */
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
  "/v1/pages/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get a page document */
    get: {
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
        /** @description Page document */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {string} */
                kind: "page" | "folder";
                id: string;
                parentId: string | null;
                rootId: string;
                title: string;
                version: number;
                updatedAt: string;
                ownerId: string;
                /** @enum {string} */
                role: "owner" | "editor" | "reader";
                isShared: boolean;
                binding: {
                  domain: string;
                  collection: string;
                  recordId: string;
                } | null;
                excerpt?: string;
                content: {
                  [key: string]: unknown;
                }[];
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
        /** @description Page not found */
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
        /** @description Version conflict */
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
    /** Save a page document using version compare-and-swap */
    put: {
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
            title: string;
            content: unknown[];
            version: number;
          };
        };
      };
      responses: {
        /** @description Saved page document */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {string} */
                kind: "page" | "folder";
                id: string;
                parentId: string | null;
                rootId: string;
                title: string;
                version: number;
                updatedAt: string;
                ownerId: string;
                /** @enum {string} */
                role: "owner" | "editor" | "reader";
                isShared: boolean;
                binding: {
                  domain: string;
                  collection: string;
                  recordId: string;
                } | null;
                excerpt?: string;
                content: {
                  [key: string]: unknown;
                }[];
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
        /** @description Page not found */
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
        /** @description Version conflict */
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
    post?: never;
    /** Delete a page with no children */
    delete: {
      parameters: {
        query?: {
          version?: number;
        };
        header?: never;
        path: {
          id: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Page deleted */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                deleted: boolean;
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
        /** @description Page not found */
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
        /** @description Version conflict */
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
    patch?: never;
    trace?: never;
  };
  "/v1/pages/{id}/revisions": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List page revisions */
    get: {
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
        /** @description Page revision summaries */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                version: number;
                title: string;
                createdAt: string;
              }[];
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
        /** @description Page not found */
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
        /** @description Version conflict */
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
    /** Delete historical page revisions */
    delete: {
      parameters: {
        query: {
          version: number;
        };
        header?: never;
        path: {
          id: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Historical revisions deleted */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                deleted: boolean;
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
        /** @description Page not found */
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
        /** @description Version conflict */
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
    patch?: never;
    trace?: never;
  };
  "/v1/pages/{id}/revisions/{version}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get a page revision */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          id: string;
          version: number;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Page revision document */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {string} */
                kind: "page" | "folder";
                id: string;
                parentId: string | null;
                rootId: string;
                title: string;
                version: number;
                updatedAt: string;
                ownerId: string;
                /** @enum {string} */
                role: "owner" | "editor" | "reader";
                isShared: boolean;
                binding: {
                  domain: string;
                  collection: string;
                  recordId: string;
                } | null;
                excerpt?: string;
                content: {
                  [key: string]: unknown;
                }[];
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
        /** @description Page not found */
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
        /** @description Version conflict */
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
  "/v1/pages/{id}/restore": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Restore a revision as a new page version */
    post: {
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
            revision: number;
            version: number;
          };
        };
      };
      responses: {
        /** @description Restored page document */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {string} */
                kind: "page" | "folder";
                id: string;
                parentId: string | null;
                rootId: string;
                title: string;
                version: number;
                updatedAt: string;
                ownerId: string;
                /** @enum {string} */
                role: "owner" | "editor" | "reader";
                isShared: boolean;
                binding: {
                  domain: string;
                  collection: string;
                  recordId: string;
                } | null;
                excerpt?: string;
                content: {
                  [key: string]: unknown;
                }[];
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
        /** @description Page not found */
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
        /** @description Version conflict */
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
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/pages/{id}/shares": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get root page shares */
    get: {
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
        /** @description Root shares and share-set version */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                rootId: string;
                version: number;
                shares: {
                  principalId: string;
                  /** @enum {string} */
                  role: "reader" | "editor";
                }[];
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
        /** @description Page not found */
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
        /** @description Version conflict */
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
    /** Replace root page shares using version compare-and-swap */
    put: {
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
            version: number;
            shares: {
              principalId: string;
              /** @enum {string} */
              role: "reader" | "editor";
            }[];
          };
        };
      };
      responses: {
        /** @description Updated root shares */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                rootId: string;
                version: number;
                shares: {
                  principalId: string;
                  /** @enum {string} */
                  role: "reader" | "editor";
                }[];
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
        /** @description Page not found */
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
        /** @description Version conflict */
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
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/pages/{id}/files": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Upload a page attachment */
    post: {
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
          "multipart/form-data": {
            file?: unknown;
          };
        };
      };
      responses: {
        /** @description Uploaded attachment */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                name: string;
                mimeType: string;
                size: number;
              };
            };
          };
        };
        /** @description Uploaded attachment */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                name: string;
                mimeType: string;
                size: number;
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
        /** @description Page not found */
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
        /** @description Version conflict */
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
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/pages/{id}/files/{fileId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Download an authorized page attachment */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          id: string;
          fileId: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Attachment bytes */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/octet-stream": string;
          };
        };
        /** @description File not found */
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
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/office-documents": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List the caller's private office documents */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Private document summaries */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                name: string;
                mime: string;
                size: number;
                version: number;
                updatedAt: string;
                /** @enum {string} */
                role: "owner" | "reader" | "editor";
                ownerName: string;
              }[];
            };
          };
        };
        /** @description The office suite is disabled for this tenant */
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
    /** Create a private office document */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          "multipart/form-data": {
            file?: unknown;
          };
        };
      };
      responses: {
        /** @description Created private document */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                name: string;
                mime: string;
                size: number;
                version: number;
                updatedAt: string;
                /** @enum {string} */
                role: "owner" | "reader" | "editor";
                ownerName: string;
              };
            };
          };
        };
        /** @description Invalid upload */
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
        /** @description The office suite is disabled for this tenant */
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
        /** @description Upload exceeds size limit */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Unsupported Office document */
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
  "/v1/office-documents/members": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Find active members in the current tenant */
    get: {
      parameters: {
        query?: {
          q?: string;
        };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Tenant members */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                principalId: string;
                displayName: string;
                email: string;
              }[];
            };
          };
        };
        /** @description The office suite is disabled for this tenant */
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
  "/v1/office-documents/{id}/shares": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List document access grants */
    get: {
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
        /** @description Document shares */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                version: number;
                shares: {
                  principalId: string;
                  /** @enum {string} */
                  role: "reader" | "editor";
                  displayName: string;
                  email: string;
                }[];
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
        /** @description The office suite is disabled for this tenant */
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
    /** Replace document access grants */
    put: {
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
            version: number;
            shares: {
              principalId: string;
              /** @enum {string} */
              role: "reader" | "editor";
            }[];
          };
        };
      };
      responses: {
        /** @description Updated document shares */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                version: number;
                shares: {
                  principalId: string;
                  /** @enum {string} */
                  role: "reader" | "editor";
                  displayName: string;
                  email: string;
                }[];
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
        /** @description The office suite is disabled for this tenant */
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
        /** @description Shares changed */
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
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/office-documents/api/file/{id}/office": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get Office editor metadata */
    get: {
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
        /** @description Editor metadata */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                name: string;
                mime: string;
                size: number;
                version: number;
                updatedAt: string;
                /** @enum {string} */
                role: "owner" | "reader" | "editor";
                ownerName: string;
                field: null;
                object: null;
                recordId: null;
                readOnly: boolean;
                maxSize: number;
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
        /** @description The office suite is disabled for this tenant */
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
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/office-documents/api/file/{id}/revisions": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List document revisions */
    get: {
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
        /** @description Revision history */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                version: number;
                size: number;
                created_at: string;
                created_by: string | null;
              }[];
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
        /** @description The office suite is disabled for this tenant */
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
    put?: never;
    /** Save a new document revision */
    post: {
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
          "multipart/form-data": {
            file?: unknown;
            version: number;
          };
        };
      };
      responses: {
        /** @description Saved revision */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                name: string;
                mime: string;
                size: number;
                version: number;
                updatedAt: string;
                /** @enum {string} */
                role: "owner" | "reader" | "editor";
                ownerName: string;
              };
            };
          };
        };
        /** @description The office suite is disabled for this tenant */
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
        /** @description Document version conflict */
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
        /** @description Upload exceeds size limit */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Unsupported Office document */
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
  "/v1/office-documents/api/file/{id}/revisions/{version}/download": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Download a document revision */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          id: string;
          version: number;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Office document bytes */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/octet-stream": string;
          };
        };
        /** @description The office suite is disabled for this tenant */
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
        /** @description Revision not found */
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
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/office-documents/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** Delete a private office document and its revisions */
    delete: {
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
            version: number;
          };
        };
      };
      responses: {
        /** @description Document and revisions deleted */
        204: {
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
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description The office suite is disabled for this tenant */
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
        /** @description Document version conflict */
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
    patch?: never;
    trace?: never;
  };
  "/v1/connected-office-documents/providers": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List connected office providers available to the caller */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Connected office providers */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {string} */
                provider:
                  "google_drive" | "onedrive_personal" | "onedrive_business";
                label: string;
                accountLabel: string | null;
              }[];
            };
          };
        };
        /** @description Office suite is disabled */
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
        /** @description Active tenant is unavailable */
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
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/connected-office-documents": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List the caller's private connected office documents */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Private connected document links */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                name: string;
                /** @enum {string} */
                format: "docx" | "xlsx" | "pptx";
                /** @enum {string} */
                provider:
                  "google_drive" | "onedrive_personal" | "onedrive_business";
                /** Format: uri */
                url: string;
                createdAt: string;
              }[];
            };
          };
        };
        /** @description Office suite is disabled */
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
        /** @description Active tenant is unavailable */
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
    put?: never;
    /** Create a document in the caller's connected drive */
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          "multipart/form-data": {
            provider: string;
            format: string;
            name: string;
            /** Format: uuid */
            requestId: string;
            file?: unknown;
          };
        };
      };
      responses: {
        /** @description Idempotent replay of a completed request */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                name: string;
                /** @enum {string} */
                format: "docx" | "xlsx" | "pptx";
                /** @enum {string} */
                provider:
                  "google_drive" | "onedrive_personal" | "onedrive_business";
                /** Format: uri */
                url: string;
                createdAt: string;
              };
            };
          };
        };
        /** @description Created connected document */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                name: string;
                /** @enum {string} */
                format: "docx" | "xlsx" | "pptx";
                /** @enum {string} */
                provider:
                  "google_drive" | "onedrive_personal" | "onedrive_business";
                /** Format: uri */
                url: string;
                createdAt: string;
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
        /** @description Provider not connected or office suite disabled */
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
        /** @description Active tenant is unavailable */
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
        /** @description Conflicting or in-progress idempotency request */
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
        /** @description Upload exceeds 5 MB */
        413: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Invalid Office template */
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
        /** @description Provider request failed or had an uncertain outcome */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                code: string;
                message: string;
              };
            };
          };
        };
        /** @description Provider service or private metadata storage is unavailable */
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
  "/v1/connected-office-documents/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** Remove a saved connected office document reference */
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
        /** @description Saved reference removed */
        204: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description Office suite is disabled */
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
        /** @description Connected document not found */
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
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/office-settings": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get office settings for the active tenant */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Office suite settings */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                tenantId: number;
                platformAllowed: boolean;
                tenantEnabled: boolean;
                enabled: boolean;
                canManagePlatform: boolean;
                canManageTenant: boolean;
              };
            };
          };
        };
        /** @description Invalid settings patch */
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
        /** @description Settings change is forbidden */
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
        /** @description Tenant is unavailable */
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
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/tenants/{tenantId}/office-settings": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get office settings for a tenant */
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
        /** @description Office suite settings */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                tenantId: number;
                platformAllowed: boolean;
                tenantEnabled: boolean;
                enabled: boolean;
                canManagePlatform: boolean;
                canManageTenant: boolean;
              };
            };
          };
        };
        /** @description Invalid settings patch */
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
        /** @description Settings change is forbidden */
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
        /** @description Tenant is unavailable */
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
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /** Update office settings for a tenant */
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
            platformAllowed?: boolean;
            tenantEnabled?: boolean;
          };
        };
      };
      responses: {
        /** @description Office suite settings */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                tenantId: number;
                platformAllowed: boolean;
                tenantEnabled: boolean;
                enabled: boolean;
                canManagePlatform: boolean;
                canManageTenant: boolean;
              };
            };
          };
        };
        /** @description Invalid settings patch */
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
        /** @description Settings change is forbidden */
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
        /** @description Tenant is unavailable */
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
    trace?: never;
  };
  "/v1/pages/{id}/public-links": {
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
          id: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Public links for an owned page */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                path: string;
                shortUrl: string | null;
                createdAt: string;
                expiresAt: string | null;
                revokedAt: string | null;
              }[];
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
        /** @description Page or link unavailable */
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
    put?: never;
    post: {
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
            /** Format: date-time */
            expiresAt?: string | null;
          };
        };
      };
      responses: {
        /** @description Created public page link */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                path: string;
                shortUrl: string | null;
                createdAt: string;
                expiresAt: string | null;
                revokedAt: string | null;
              };
            };
          };
        };
        /** @description Created public page link */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                path: string;
                shortUrl: string | null;
                createdAt: string;
                expiresAt: string | null;
                revokedAt: string | null;
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
        /** @description Page or link unavailable */
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
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/pages/{id}/public-links/{linkId}/short-url": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          id: string;
          linkId: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Reusable short URL for an active public page link */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                shortUrl: string;
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
        /** @description Page or link unavailable */
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
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/s/p/{code}": {
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
          code: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Redirect to the public page */
        302: {
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
  "/v1/pages/{id}/public-links/{linkId}": {
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
          linkId: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Revoked public page link */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                id: string;
                path: string;
                shortUrl: string | null;
                createdAt: string;
                expiresAt: string | null;
                revokedAt: string | null;
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
        /** @description Page or link unavailable */
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
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/pages/{token}": {
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
        /** @description Publicly shared page content */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                root: {
                  id: string;
                  title: string;
                };
                page: {
                  id: string;
                  title: string;
                  /** @enum {string} */
                  kind: "page" | "folder";
                  content: unknown[];
                  updatedAt: string;
                };
                children: {
                  id: string;
                  title: string;
                  /** @enum {string} */
                  kind: "page" | "folder";
                }[];
                breadcrumbs: {
                  id: string;
                  title: string;
                }[];
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
        /** @description Page or link unavailable */
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
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/pages/{token}/pages/{pageId}": {
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
          pageId: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Publicly shared page content */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                root: {
                  id: string;
                  title: string;
                };
                page: {
                  id: string;
                  title: string;
                  /** @enum {string} */
                  kind: "page" | "folder";
                  content: unknown[];
                  updatedAt: string;
                };
                children: {
                  id: string;
                  title: string;
                  /** @enum {string} */
                  kind: "page" | "folder";
                }[];
                breadcrumbs: {
                  id: string;
                  title: string;
                }[];
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
        /** @description Page or link unavailable */
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
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/pages/{token}/pages/{pageId}/files/{fileId}": {
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
          pageId: string;
          fileId: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Page attachment */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content?: never;
        };
        /** @description File unavailable */
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
                /** @enum {number} */
                presetVersion?: 2;
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
                            | "studio"
                            | "my-day"
                            | "bookings"
                            | "pages"
                            | "office-suite"
                            | "companion-recordings"
                            | "integrations"
                            | "provider-credentials"
                            | "assistant-configuration"
                            | "service-credentials"
                            | "access-control"
                            | "users"
                            | "tenants"
                            | "page-administrator"
                            | "domain-sources"
                            | "domain-workflows"
                            | "domain-reports"
                            | "domain-api"
                            | "domain-history"
                            | "domain-packages"
                            | "virtual-employees"
                            | "tenant-branding"
                          )
                        | "dynamic-crm"
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
                            | "studio"
                            | "my-day"
                            | "bookings"
                            | "pages"
                            | "office-suite"
                            | "companion-recordings"
                            | "integrations"
                            | "provider-credentials"
                            | "assistant-configuration"
                            | "service-credentials"
                            | "access-control"
                            | "users"
                            | "tenants"
                            | "page-administrator"
                            | "domain-sources"
                            | "domain-workflows"
                            | "domain-reports"
                            | "domain-api"
                            | "domain-history"
                            | "domain-packages"
                            | "virtual-employees"
                            | "tenant-branding"
                          )
                        | "dynamic-crm"
                        | string
                      )[];
                      collapsed: boolean;
                    }
                )[];
                hiddenItems?: (
                  | (
                      | "dashboard"
                      | "studio"
                      | "my-day"
                      | "bookings"
                      | "pages"
                      | "office-suite"
                      | "companion-recordings"
                      | "integrations"
                      | "provider-credentials"
                      | "assistant-configuration"
                      | "service-credentials"
                      | "access-control"
                      | "users"
                      | "tenants"
                      | "page-administrator"
                      | "domain-sources"
                      | "domain-workflows"
                      | "domain-reports"
                      | "domain-api"
                      | "domain-history"
                      | "domain-packages"
                      | "virtual-employees"
                      | "tenant-branding"
                    )
                  | "dynamic-crm"
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
                /** @enum {number} */
                presetVersion?: 2;
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
                            | "studio"
                            | "my-day"
                            | "bookings"
                            | "pages"
                            | "office-suite"
                            | "companion-recordings"
                            | "integrations"
                            | "provider-credentials"
                            | "assistant-configuration"
                            | "service-credentials"
                            | "access-control"
                            | "users"
                            | "tenants"
                            | "page-administrator"
                            | "domain-sources"
                            | "domain-workflows"
                            | "domain-reports"
                            | "domain-api"
                            | "domain-history"
                            | "domain-packages"
                            | "virtual-employees"
                            | "tenant-branding"
                          )
                        | "dynamic-crm"
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
                            | "studio"
                            | "my-day"
                            | "bookings"
                            | "pages"
                            | "office-suite"
                            | "companion-recordings"
                            | "integrations"
                            | "provider-credentials"
                            | "assistant-configuration"
                            | "service-credentials"
                            | "access-control"
                            | "users"
                            | "tenants"
                            | "page-administrator"
                            | "domain-sources"
                            | "domain-workflows"
                            | "domain-reports"
                            | "domain-api"
                            | "domain-history"
                            | "domain-packages"
                            | "virtual-employees"
                            | "tenant-branding"
                          )
                        | "dynamic-crm"
                        | string
                      )[];
                      collapsed: boolean;
                    }
                )[];
                hiddenItems?: (
                  | (
                      | "dashboard"
                      | "studio"
                      | "my-day"
                      | "bookings"
                      | "pages"
                      | "office-suite"
                      | "companion-recordings"
                      | "integrations"
                      | "provider-credentials"
                      | "assistant-configuration"
                      | "service-credentials"
                      | "access-control"
                      | "users"
                      | "tenants"
                      | "page-administrator"
                      | "domain-sources"
                      | "domain-workflows"
                      | "domain-reports"
                      | "domain-api"
                      | "domain-history"
                      | "domain-packages"
                      | "virtual-employees"
                      | "tenant-branding"
                    )
                  | "dynamic-crm"
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
  "/v1/user-preferences/my-day-widgets": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read the caller's My Day widgets layout */
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description My Day widgets layout */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {number} */
                version: 1;
                widgets: (
                  | {
                      id: string;
                      apiBasePath: string;
                      collection: string;
                      kind:
                        ("summary" | "items" | "chart" | "actions") | string;
                      title?: string;
                      config?: {
                        statusField?: string;
                        amountField?: string;
                        dateField?: string;
                        groupField?: string;
                        limit?: number;
                        sort?: string;
                        /** @enum {string} */
                        order?: "ASC" | "DESC";
                      };
                      /** @enum {string} */
                      size?: "sm" | "md" | "lg";
                    }
                  | {
                      id: string;
                      /** @enum {string} */
                      kind:
                        "agenda" | "quick_task" | "mail" | "office_documents";
                      title?: string;
                      /** @enum {string} */
                      size?: "sm" | "md" | "lg";
                    }
                )[];
              };
            };
          };
        };
      };
    };
    /** Save the caller's My Day widgets layout */
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
        /** @description Saved My Day widgets layout */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                /** @enum {number} */
                version: 1;
                widgets: (
                  | {
                      id: string;
                      apiBasePath: string;
                      collection: string;
                      kind:
                        ("summary" | "items" | "chart" | "actions") | string;
                      title?: string;
                      config?: {
                        statusField?: string;
                        amountField?: string;
                        dateField?: string;
                        groupField?: string;
                        limit?: number;
                        sort?: string;
                        /** @enum {string} */
                        order?: "ASC" | "DESC";
                      };
                      /** @enum {string} */
                      size?: "sm" | "md" | "lg";
                    }
                  | {
                      id: string;
                      /** @enum {string} */
                      kind:
                        "agenda" | "quick_task" | "mail" | "office_documents";
                      title?: string;
                      /** @enum {string} */
                      size?: "sm" | "md" | "lg";
                    }
                )[];
              };
            };
          };
        };
        /** @description Invalid My Day widgets layout */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              error: {
                /** @enum {string} */
                code: "INVALID_MY_DAY_WIDGETS";
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
            initialUser?: {
              /** Format: email */
              email: string;
              firstName: string;
              lastName: string;
              /** @enum {string} */
              role: "tenant_admin" | "agency_admin" | "operator" | "viewer";
              temporaryPassword?: string;
              emailVerified?: boolean;
            };
            existingMember?: {
              principalId: string;
              /** @enum {string} */
              role: "tenant_admin" | "agency_admin" | "operator" | "viewer";
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
              emailVerified?: boolean;
            };
            existingMember?: {
              principalId: string;
              /** @enum {string} */
              role: "tenant_admin" | "agency_admin" | "operator" | "viewer";
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
  "/v1/tenants/{tenantId}/branding": {
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
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Tenant branding */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                displayName: string;
                loginTitle: string;
                loginDescription: string;
                primaryColor: string;
                accentColor: string;
                logoUrl: string | null;
                coverUrl: string | null;
                /** @default null */
                loginAnimationUrl: string | null;
                /** @default true */
                loginAnimationRepeat: boolean;
                version: number;
              };
              canManage?: boolean;
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
          tenantId: number;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "application/json": {
            displayName: string;
            loginTitle: string;
            loginDescription: string;
            primaryColor: string;
            accentColor: string;
            logoUrl: string | null;
            coverUrl: string | null;
            /** @default null */
            loginAnimationUrl?: string | null;
            /** @default true */
            loginAnimationRepeat?: boolean;
            version: number;
          };
        };
      };
      responses: {
        /** @description Tenant branding */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                displayName: string;
                loginTitle: string;
                loginDescription: string;
                primaryColor: string;
                accentColor: string;
                logoUrl: string | null;
                coverUrl: string | null;
                /** @default null */
                loginAnimationUrl: string | null;
                /** @default true */
                loginAnimationRepeat: boolean;
                version: number;
              };
              canManage?: boolean;
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
  "/v1/tenants/{tenantId}/branding/assets/{kind}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          tenantId: number;
          kind: "logo" | "cover" | "login-animation";
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          "multipart/form-data": {
            /** Format: binary */
            file?: string;
          };
        };
      };
      responses: {
        /** @description Uploaded image awaiting branding save */
        201: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                url: string;
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
  "/api/public/tenant-branding": {
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
        /** @description Branding for the requested tenant hostname */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "application/json": {
              data: {
                displayName: string;
                loginTitle: string;
                loginDescription: string;
                primaryColor: string;
                accentColor: string;
                logoUrl: string | null;
                coverUrl: string | null;
                /** @default null */
                loginAnimationUrl: string | null;
                /** @default true */
                loginAnimationRepeat: boolean;
                version: number;
              } | null;
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
  "/api/public/tenant-branding/assets/{tenantId}/{assetId}": {
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
          tenantId: number;
          assetId: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Published tenant logo, cover or login animation */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "image/png": string;
            "image/jpeg": string;
            "image/webp": string;
            "application/json": string;
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
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
