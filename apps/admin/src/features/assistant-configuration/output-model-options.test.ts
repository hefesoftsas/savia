import { describe, expect, it } from "vitest";
import type { AssistantModel } from "@/api/assistant-configuration-client";
import {
  cheapestOutputModelSuggestions,
  compatibleOutputModels,
  hasIncomparableOutputPricing,
  hasUnknownOutputPricing,
} from "./output-model-options";

const model = (
  id: string,
  overrides: Partial<AssistantModel> = {},
): AssistantModel => ({
  id,
  name: id,
  contextLength: null,
  inputPricePerMillion: null,
  outputPricePerMillion: null,
  modalities: {
    text: false,
    image: false,
    audio: false,
    file: false,
    imageOutput: false,
    speechOutput: false,
  },
  ...overrides,
});

describe("output model options", () => {
  it("filters image and speech options by output modalities", () => {
    const models = [
      model("image", {
        modalities: {
          text: false,
          image: false,
          audio: false,
          file: false,
          imageOutput: true,
          speechOutput: false,
        },
      }),
      model("speech", {
        modalities: {
          text: false,
          image: false,
          audio: false,
          file: false,
          imageOutput: false,
          speechOutput: true,
        },
      }),
      model("input-only", {
        modalities: {
          text: false,
          image: true,
          audio: true,
          file: true,
          imageOutput: false,
          speechOutput: false,
        },
      }),
    ];

    expect(compatibleOutputModels(models, "image").map(({ id }) => id)).toEqual(
      ["image"],
    );
    expect(
      compatibleOutputModels(models, "speech").map(({ id }) => id),
    ).toEqual(["speech"]);
  });

  it("suggests the cheapest known model only within matching task price units", () => {
    const models = [
      model("image-cheap", {
        modalities: {
          text: false,
          image: false,
          audio: false,
          file: false,
          imageOutput: true,
          speechOutput: false,
        },
        generationPricing: { image: { price: 0.02, unit: "image" } },
      }),
      model("image-expensive", {
        modalities: {
          text: false,
          image: false,
          audio: false,
          file: false,
          imageOutput: true,
          speechOutput: false,
        },
        generationPricing: { image: { price: 0.04, unit: "image" } },
      }),
      model("megapixel", {
        modalities: {
          text: false,
          image: false,
          audio: false,
          file: false,
          imageOutput: true,
          speechOutput: false,
        },
        generationPricing: { image: { price: 0.01, unit: "megapixel" } },
      }),
      model("image-1024", {
        modalities: {
          text: false,
          image: false,
          audio: false,
          file: false,
          imageOutput: true,
          speechOutput: false,
        },
        generationPricing: {
          image: { price: 0.03, unit: "image", variant: "1024x1024" },
        },
      }),
      model("image-2048", {
        modalities: {
          text: false,
          image: false,
          audio: false,
          file: false,
          imageOutput: true,
          speechOutput: false,
        },
        generationPricing: {
          image: { price: 0.05, unit: "image", variant: "2048x2048" },
        },
      }),
      model("image-unknown", {
        modalities: {
          text: false,
          image: false,
          audio: false,
          file: false,
          imageOutput: true,
          speechOutput: false,
        },
      }),
      model("speech-char", {
        modalities: {
          text: false,
          image: false,
          audio: false,
          file: false,
          imageOutput: false,
          speechOutput: true,
        },
        generationPricing: {
          speech: { prompt: { price: 0.00001, unit: "character" } },
        },
      }),
      model("speech-second", {
        modalities: {
          text: false,
          image: false,
          audio: false,
          file: false,
          imageOutput: false,
          speechOutput: true,
        },
        generationPricing: {
          speech: { completion: { price: 0.0002, unit: "second" } },
        },
      }),
      model("speech-mixed", {
        modalities: {
          text: false,
          image: false,
          audio: false,
          file: false,
          imageOutput: false,
          speechOutput: true,
        },
        generationPricing: {
          speech: {
            prompt: { price: 0.000001, unit: "character" },
            completion: { price: 0.0003, unit: "second" },
          },
        },
      }),
      model("speech-invalid", {
        modalities: {
          text: false,
          image: false,
          audio: false,
          file: false,
          imageOutput: false,
          speechOutput: true,
        },
        generationPricing: {
          speech: {
            prompt: { price: Number.NaN, unit: "character" },
            completion: { price: 0, unit: "second" },
          },
        },
      }),
    ];

    const suggestions = cheapestOutputModelSuggestions(models, "image");
    expect(
      suggestions.map(({ group, model: result }) => [group, result.id]),
    ).toEqual([
      ["image:", "image-cheap"],
      ["image:1024x1024", "image-1024"],
      ["image:2048x2048", "image-2048"],
      ["megapixel:", "megapixel"],
    ]);
    expect(
      cheapestOutputModelSuggestions(models, "speech")
        .map(({ unit, model: result }) => [unit, result.id])
        .sort(([leftUnit], [rightUnit]) =>
          String(leftUnit).localeCompare(String(rightUnit)),
        ),
    ).toEqual([
      ["character", "speech-char"],
      ["second", "speech-second"],
    ]);
    expect(hasUnknownOutputPricing(models, "image")).toBe(true);
    expect(hasUnknownOutputPricing(models, "speech")).toBe(true);
    expect(hasIncomparableOutputPricing(models, "speech")).toBe(true);
  });
});
