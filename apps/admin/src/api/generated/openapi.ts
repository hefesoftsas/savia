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
              maxAudioBytes: number;
              maxCompressedAudioBytes: number;
              audioFormats: ("wav" | "ogg")[];
              storageAvailable: boolean;
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
            source: "microphone" | "system";
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
              source: "microphone" | "system";
              model: string;
              durationSeconds: number;
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
                /** @enum {string} */
                source: "microphone" | "system";
                /** @enum {string} */
                format: "ogg";
                bytes: number;
                durationSeconds: number;
                /** Format: date-time */
                createdAt: string;
                sha256: string;
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
            source: "microphone" | "system";
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
              /** @enum {string} */
              source: "microphone" | "system";
              /** @enum {string} */
              format: "ogg";
              bytes: number;
              durationSeconds: number;
              /** Format: date-time */
              createdAt: string;
              sha256: string;
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
        /** @description Ogg/Opus audio */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            "audio/ogg": string;
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
                source: "microphone" | "system";
                model: string;
                durationSeconds: number;
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
                source: "microphone" | "system";
                model: string;
                durationSeconds: number;
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
              source: "microphone" | "system";
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
                  | "linear";
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
                    | "linear";
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
                    | "linear";
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
     * Preview a linked issue from a caller-owned Jira or Linear account
     * @description Parses supported Jira Cloud and Linear issue links, then reads safe summary metadata through the caller's active personal connection.
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
                provider: "jira" | "linear";
                /** Format: uri */
                url: string;
                identifier: string;
                title: string;
                status: string | null;
                assignee: string | null;
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
                            | "pages"
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
                            | "pages"
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
                      | "pages"
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
                            | "pages"
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
                            | "pages"
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
                      | "pages"
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
                      kind: "agenda" | "quick_task" | "mail";
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
                      kind: "agenda" | "quick_task" | "mail";
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
