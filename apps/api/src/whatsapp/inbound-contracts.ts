import type { ActiveWhatsappConnection } from "./contracts";

export type WhatsappAssistantSettings = {
  connectionId: string;
  tenantId: number;
  employeeId: string;
  enabled: boolean;
  allowedContacts: string[];
  updatedBy: string;
};

export type WhatsappAssistantBinding = WhatsappAssistantSettings & {
  connection: ActiveWhatsappConnection;
  ownerPrincipalId: string;
};

export type WhatsappInboundInput = {
  phoneNumberId: string;
  wabaId: string;
  messageId: string;
  contactPhone: string;
  text: string;
  timestamp: string;
};

export type WhatsappDeliveryInput = {
  phoneNumberId: string;
  wabaId: string;
  messageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  errorCode?: string;
};

export type WhatsappChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type WhatsappInboundDependencies = {
  generate(
    binding: WhatsappAssistantBinding,
    history: WhatsappChatMessage[],
    message: string,
  ): Promise<string>;
  send(
    binding: WhatsappAssistantBinding,
    text: string,
    contactPhone: string,
  ): Promise<string>;
};
