import { translate, type Locale, type MessageKey } from "./i18n";
import type { CaptureErrorCode } from "./client";

export type LocalizedMessage = {
  key: MessageKey;
  vars?: Record<string, string | number>;
};

class LocalizedOperationError extends Error {
  constructor(readonly localizedMessage: LocalizedMessage) {
    super("Known local validation failure");
  }
}

export function captureErrorMessage(
  code: CaptureErrorCode | null | undefined,
): LocalizedMessage {
  const key: MessageKey =
    code === "microphonePermissionDenied"
      ? "CAPTURE_PERMISSION_DENIED_MICROPHONE"
      : code === "systemPermissionDenied"
        ? "CAPTURE_PERMISSION_DENIED_SYSTEM"
        : code === "captureUnavailable"
          ? "CAPTURE_UNAVAILABLE"
          : "CAPTURE_FAILED";
  return { key };
}

export function localizedOperationError(key: MessageKey): Error {
  return new LocalizedOperationError({ key });
}

export function operationErrorMessage(error?: unknown): LocalizedMessage {
  if (error instanceof LocalizedOperationError) return error.localizedMessage;
  return { key: "OPERATION_FAILED" };
}

export function renderMessage(
  locale: Locale,
  message: LocalizedMessage,
): string {
  return translate(locale, message.key, message.vars);
}
