import { ApiClient, ApiClientError } from "./api-client";
import type { RequestResult } from "../../../api/src/request-results/contracts";
export type { RequestResult } from "../../../api/src/request-results/contracts";
export type InsuranceExecutionInput = {
  mode: "mock" | "live";
  input: Record<string, string>;
  versionId?: string;
};
export class RequestResultClient {
  constructor(private readonly api: ApiClient) {}
  private async result(
    operation: () => Promise<RequestResult>,
  ): Promise<RequestResult> {
    try {
      return await operation();
    } catch (error) {
      const details = error instanceof ApiClientError ? error.details : null;
      if (
        details &&
        typeof details === "object" &&
        "schemaVersion" in details &&
        details.schemaVersion === "1.0" &&
        "status" in details &&
        details.status === "error"
      )
        return details as RequestResult;
      throw error;
    }
  }
  execute(flowId: string, input: InsuranceExecutionInput) {
    return this.result(() =>
      this.api.post<RequestResult>(
        "/v1/request-results/flows/" + encodeURIComponent(flowId) + "/runs",
        input,
      ),
    );
  }
  read(flowId: string, runId: string) {
    return this.result(() =>
      this.api.get<RequestResult>(
        "/v1/request-results/flows/" +
          encodeURIComponent(flowId) +
          "/runs/" +
          encodeURIComponent(runId),
      ),
    );
  }
}
