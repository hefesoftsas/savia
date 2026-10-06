import { describe, expect, it } from "vitest";
import {
  captureErrorMessage,
  localizedOperationError,
  operationErrorMessage,
  renderMessage,
} from "./capture-errors";

describe("localized capture messages", () => {
  it("keeps a recognized native error as a locale-independent message key", () => {
    const message = captureErrorMessage("microphonePermissionDenied");

    expect(message.key).toBe("CAPTURE_PERMISSION_DENIED_MICROPHONE");
    expect(renderMessage("en", message)).toBe(
      "Check microphone permissions in system settings.",
    );
    expect(renderMessage("es", message)).toBe(
      "Revisa los permisos del micrófono en la configuración del sistema.",
    );
  });

  it("uses generic localized guidance for unknown native or operation errors", () => {
    const message = operationErrorMessage(
      new Error("private provider diagnostic with a secret"),
    );

    expect(message.key).toBe("OPERATION_FAILED");
    expect(renderMessage("en", message)).toBe(
      "This action could not be completed.",
    );
    expect(renderMessage("pt", message)).toBe(
      "Não foi possível concluir esta ação.",
    );
  });

  it("preserves known upload validation guidance as a key across locale changes", () => {
    const message = operationErrorMessage(
      localizedOperationError(
        "Connect storage and confirm permission before upload.",
      ),
    );

    expect(message.key).toBe(
      "Connect storage and confirm permission before upload.",
    );
    expect(renderMessage("en", message)).toBe(
      "Connect storage and confirm permission before upload.",
    );
    expect(renderMessage("es", message)).toBe(
      "Conecta el almacenamiento y confirma el permiso antes de subir.",
    );
  });

  it("preserves the recoverable-audio validation message", () => {
    const message = operationErrorMessage(
      localizedOperationError("No recoverable audio is available to upload."),
    );

    expect(renderMessage("es", message)).toBe(
      "No hay audio recuperable para subir.",
    );
  });

  it("falls back to a localized capture message for unknown capture codes", () => {
    const message = captureErrorMessage(undefined);

    expect(message.key).toBe("CAPTURE_FAILED");
    expect(renderMessage("en", message)).toBe(
      "Audio capture could not be completed.",
    );
  });
});
