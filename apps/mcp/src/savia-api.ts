import { SaviaApiClient as SharedSaviaApiClient } from "@savia/release-catalog/assistant-api-client";
export * from "@savia/release-catalog/assistant-api-client";
export class SaviaApiClient extends SharedSaviaApiClient {
  constructor(
    baseUrl = process.env.SAVIA_API_URL ?? "http://127.0.0.1:8787",
    accessToken = process.env.SAVIA_API_TOKEN,
    fetcher: typeof fetch = fetch,
  ) {
    super(baseUrl, accessToken, fetcher);
  }
}
