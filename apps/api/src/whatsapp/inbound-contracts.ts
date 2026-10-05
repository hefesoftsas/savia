import type { NativeConfiguration, NativeReply } from "./native";
import type { NativeInbound } from "./native-input";
import type { ActiveWhatsappConnection } from "./contracts";

export type WhatsappAssistantSettings = {
  connectionId: string;
  tenantId: number;
  employeeId: string;
  enabled: boolean;
  allowedContacts: string[];
  updatedBy: string;
  native?: NativeConfiguration;
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
  native?: NativeInbound;
};

export type WhatsappInboundDispatchInput = WhatsappInboundInput & {
  tenantId: number;
  connectionId: string;
  assignedEmployeeId: string | null;
  assignedOwnerPrincipalId: string | null;
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
  indicator?(
    binding: WhatsappAssistantBinding,
    messageId: string,
  ): Promise<void>;
  generate(
    binding: WhatsappAssistantBinding,
    history: WhatsappChatMessage[],
    message: string,
    input?: WhatsappInboundInput,
  ): Promise<string | NativeReply>;
  send(
    binding: WhatsappAssistantBinding,
    text: string | NativeReply,
    contactPhone: string,
    input?: WhatsappInboundDispatchInput,
  ): Promise<string>;
};
