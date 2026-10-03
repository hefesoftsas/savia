import type {
  SearchPage,
  SearchPageSummary,
  SearchHit,
} from "./browser-search-index";
export type SearchWorkerRequest =
  | {
      type: "open";
      scope: string;
      pages: SearchPageSummary[];
      rebuild?: boolean;
    }
  | { type: "upsert"; page: SearchPage }
  | { type: "finish" }
  | { type: "cancel-search"; requestId: number }
  | { type: "search"; requestId: number; term: string };
export type SearchWorkerResponse =
  | { type: "plan"; needed: string[]; reused: number; total: number }
  | { type: "updated"; id: string }
  | { type: "indexing"; done: number; total: number }
  | { type: "ready"; total: number; reused: number; elapsedMs: number }
  | { type: "results"; requestId: number; hits: SearchHit[]; elapsedMs: number }
  | { type: "error"; requestId?: number };
