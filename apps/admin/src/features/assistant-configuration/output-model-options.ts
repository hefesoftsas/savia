import type { AssistantModel } from "@/api/assistant-configuration-client";

export type OutputModelTask = "image" | "speech";

export type OutputModelSuggestion = {
  model: AssistantModel;
  price: number;
  unit: string;
  group: string;
  variant?: string;
};

export function compatibleOutputModels(
  models: AssistantModel[],
  task: OutputModelTask,
): AssistantModel[] {
  return models.filter((model) =>
    task === "image"
      ? model.modalities?.imageOutput === true
      : model.modalities?.speechOutput === true,
  );
}

export function cheapestOutputModelSuggestions(
  models: AssistantModel[],
  task: OutputModelTask,
): OutputModelSuggestion[] {
  const prices: OutputModelSuggestion[] = [];
  for (const model of compatibleOutputModels(models, task)) {
    const pricing = model.generationPricing;
    if (task === "image" && pricing?.image) {
      if (!Number.isFinite(pricing.image.price) || pricing.image.price < 0)
        continue;
      prices.push({
        model,
        price: pricing.image.price,
        unit: pricing.image.unit,
        group: `${pricing.image.unit}:${pricing.image.variant ?? ""}`,
        variant: pricing.image.variant,
      });
    }
    if (task === "speech") {
      const prompt = pricing?.speech?.prompt;
      const completion = pricing?.speech?.completion;
      const validPrompt =
        prompt !== undefined &&
        Number.isFinite(prompt.price) &&
        prompt.price >= 0;
      const validCompletion =
        completion !== undefined &&
        Number.isFinite(completion.price) &&
        completion.price >= 0;
      if (
        (prompt !== undefined && !validPrompt) ||
        (completion !== undefined && !validCompletion)
      )
        continue;
      const promptRate = validPrompt ? prompt : undefined;
      const completionRate = validCompletion ? completion : undefined;
      if (
        promptRate &&
        (completionRate === undefined || completionRate.price === 0) &&
        promptRate.price >= 0
      ) {
        prices.push({
          model,
          price: promptRate.price,
          unit: promptRate.unit,
          group: `prompt-${promptRate.unit}`,
        });
      }
      if (
        completionRate &&
        (promptRate === undefined || promptRate.price === 0)
      ) {
        prices.push({
          model,
          price: completionRate.price,
          unit: completionRate.unit,
          group: `completion-${completionRate.unit}`,
        });
      }
    }
  }

  const cheapest = new Map<string, OutputModelSuggestion>();
  for (const candidate of prices) {
    const current = cheapest.get(candidate.group);
    if (
      current === undefined ||
      candidate.price < current.price ||
      (candidate.price === current.price &&
        candidate.model.id.localeCompare(current.model.id) < 0)
    ) {
      cheapest.set(candidate.group, candidate);
    }
  }
  return [...cheapest.values()].sort((left, right) =>
    left.group.localeCompare(right.group),
  );
}

export function hasUnknownOutputPricing(
  models: AssistantModel[],
  task: OutputModelTask,
): boolean {
  return compatibleOutputModels(models, task).some((model) => {
    const pricing = model.generationPricing;
    if (task === "image")
      return (
        pricing?.image === undefined ||
        !Number.isFinite(pricing.image.price) ||
        pricing.image.price < 0
      );
    const speechRates = [
      pricing?.speech?.prompt?.price,
      pricing?.speech?.completion?.price,
    ].filter((price): price is number => price !== undefined);
    return (
      speechRates.length === 0 ||
      speechRates.some((price) => !Number.isFinite(price) || price < 0)
    );
  });
}

export function hasIncomparableOutputPricing(
  models: AssistantModel[],
  task: OutputModelTask,
): boolean {
  if (task !== "speech") return false;
  return compatibleOutputModels(models, task).some((model) => {
    const prompt = model.generationPricing?.speech?.prompt?.price;
    const completion = model.generationPricing?.speech?.completion?.price;
    return (
      prompt !== undefined &&
      completion !== undefined &&
      Number.isFinite(prompt) &&
      Number.isFinite(completion) &&
      prompt > 0 &&
      completion > 0
    );
  });
}

export type OutputPriceGroupLabel =
  | "per image"
  | "per megapixel"
  | "per image token"
  | "per input character"
  | "per input token"
  | "per generated audio second"
  | "per output token";

export function outputPriceGroupLabel(group: string): OutputPriceGroupLabel {
  const normalizedGroup =
    group.startsWith("prompt-") || group.startsWith("completion-")
      ? group
      : group.split(":")[0]!;
  switch (normalizedGroup) {
    case "image":
      return "per image";
    case "megapixel":
      return "per megapixel";
    case "token":
      return "per image token";
    case "prompt-character":
      return "per input character";
    case "prompt-token":
      return "per input token";
    case "completion-second":
      return "per generated audio second";
    case "completion-token":
      return "per output token";
    default:
      return "per image";
  }
}
