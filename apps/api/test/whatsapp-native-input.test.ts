import { describe, expect, it } from "vitest";
import { parseWhatsappNativeInput } from "../src/whatsapp/native-input";

describe("native WhatsApp incoming messages", () => {
  it("keeps choice IDs and user-visible labels as untrusted conversation input", () => {
    const result = parseWhatsappNativeInput({
      type: "interactive",
      context: { id: "outbound" },
      interactive: {
        type: "button_reply",
        button_reply: { id: "yes", title: "Confirmar" },
      },
    });
    expect(result).toEqual({
      text: "Confirmar",
      native: {
        kind: "choice",
        choiceType: "button",
        id: "yes",
        title: "Confirmar",
        contextMessageId: "outbound",
      },
    });
  });
  it("accepts list replies and template quick replies", () => {
    expect(
      parseWhatsappNativeInput({
        type: "interactive",
        interactive: {
          type: "list_reply",
          list_reply: {
            id: "service",
            title: "Servicio",
            description: "Details",
          },
        },
      })?.native,
    ).toMatchObject({ kind: "choice", choiceType: "list", id: "service" });
    expect(
      parseWhatsappNativeInput({
        type: "button",
        button: { payload: "support", text: "Soporte" },
      })?.native,
    ).toMatchObject({ kind: "choice", choiceType: "template" });
  });
  it("parses completed static Flow forms without exposing their token to the assistant", () => {
    const result = parseWhatsappNativeInput({
      type: "interactive",
      interactive: {
        type: "nfm_reply",
        nfm_reply: {
          response_json: JSON.stringify({
            flow_token: "private-token",
            plate: "TESTCAR",
            consent: true,
          }),
        },
      },
    });
    expect(result?.native).toEqual({
      kind: "flow",
      values: { plate: "TESTCAR", consent: true },
    });
    expect(result?.text).not.toContain("private-token");
  });
  it("bounds malformed Flow data and native coordinates", () => {
    expect(() =>
      parseWhatsappNativeInput({
        type: "interactive",
        interactive: {
          type: "nfm_reply",
          nfm_reply: { response_json: "not json" },
        },
      }),
    ).toThrow();
    expect(() =>
      parseWhatsappNativeInput({
        type: "location",
        location: { latitude: 91, longitude: 0 },
      }),
    ).toThrow();
    expect(() =>
      parseWhatsappNativeInput({
        type: "interactive",
        interactive: {
          type: "nfm_reply",
          nfm_reply: {
            response_json: JSON.stringify({ text: "x".repeat(17000) }),
          },
        },
      }),
    ).toThrow();
  });
  it("defers media downloads and handles shared locations and catalog orders", () => {
    expect(
      parseWhatsappNativeInput({
        type: "audio",
        audio: {
          id: "123456789",
          mime_type: "audio/ogg",
          sha256: "abc",
          voice: true,
        },
      })?.native,
    ).toMatchObject({
      kind: "media",
      mediaType: "audio",
      mediaId: "123456789",
    });
    expect(
      parseWhatsappNativeInput({
        type: "location",
        location: { latitude: 4.6, longitude: -74.1, name: "Bogotá" },
      })?.text,
    ).toContain("4.6");
    expect(
      parseWhatsappNativeInput({
        type: "order",
        order: {
          catalog_id: "123456",
          product_items: [
            {
              product_retailer_id: "sku",
              quantity: 1,
              item_price: "100",
              currency: "COP",
            },
          ],
        },
      })?.native,
    ).toMatchObject({ kind: "order", catalogId: "123456" });
    expect(parseWhatsappNativeInput({ type: "unsupported" })).toBeUndefined();
  });
});
