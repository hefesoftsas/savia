import type {
  MyDayWidget,
  MyDayWidgetsLayout,
} from "@savia/crm-shared/my-day-widgets";

export type { MyDayWidget, MyDayWidgetsLayout };

export type WidgetDomain = {
  id: string;
  label: string;
  kind: "platform" | "custom" | "agency" | "tenant";
  apiBasePath: string;
};

export type WidgetCollection = {
  apiBasePath: string;
  name: string;
  label: string;
  count?: number;
};

export type WidgetCollectionField = {
  name: string;
  label: string;
  type: string;
};

export type WidgetCollectionSchema = {
  apiBasePath: string;
  name: string;
  label: string;
  fields: WidgetCollectionField[];
};

export type WidgetRecord = {
  id: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};

export type WidgetRecordsPage = {
  data: WidgetRecord[];
  total: number;
};

export type WidgetSummaryGroup = {
  value: string;
  count: number;
  amount: number;
};
