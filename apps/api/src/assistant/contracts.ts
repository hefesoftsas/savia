export type AssistantChatRequest = {
  principalId: string;
  authorization: string;
  messages: unknown[];
  employeeId?: string;
  employeeHandle?: string;
};

export type AssistantActionRequest = {
  actionId: string;
  principalId: string;
  authorization: string;
};

export type AssistantActionResult =
  | { state: "completed"; result: unknown }
  | { state: "failed" }
  | { state: "cancelled" }
  | { state: "unavailable" };

export type AssistantService = {
  chat(request: AssistantChatRequest): Promise<Response>;
  confirmAction(
    request: AssistantActionRequest,
  ): Promise<AssistantActionResult>;
  cancelAction(
    request: Omit<AssistantActionRequest, "authorization">,
  ): Promise<AssistantActionResult>;
};
