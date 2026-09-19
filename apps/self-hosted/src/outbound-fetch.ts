import { lookup as systemLookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { isPublicAddress } from "@savia/crm-server/integrations";

type Transport = (
  url: string,
  init: RequestInit & { dispatcher: Agent; duplex?: "half" },
) => Promise<Response>;
type Options = {
  /** Injectable DNS/transport seams for deterministic tests, not user configuration. */
  lookup?: (hostname: string) => Promise<LookupAddress[]>;
  transport?: Transport;
};
function publicDomain(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.hash &&
    (!url.port || url.port === "443") &&
    url.hostname.includes(".") &&
    !isIP(url.hostname) &&
    !url.hostname.includes(":") &&
    !url.hostname.endsWith(".") &&
    !/(^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(
      url.hostname,
    ) &&
    url.hostname
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  );
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) {
      void promise.catch(() => {});
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
/** Collection-only transport. Never replaces global fetch or affects business integrations. */
export function createNativeCollectionFetch(options: Options = {}): {
  fetch: typeof fetch;
  close(): Promise<void>;
} {
  const lookup =
    options.lookup ??
    ((hostname) => systemLookup(hostname, { all: true, verbatim: true }));
  const transport = options.transport ?? (undiciFetch as unknown as Transport);
  const agents = new Set<Agent>();
  const lifetime = new AbortController();
  let closed = false;
  const fetcher = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    if (closed) throw new Error("Collection fetch adapter is closed.");
    const request = new Request(input, init);
    const signal = AbortSignal.any([request.signal, lifetime.signal]);
    signal.throwIfAborted();
    const url = new URL(request.url);
    if (!publicDomain(url))
      throw new Error(
        "Collection requests require a public HTTPS domain on port 443.",
      );
    if (
      url.origin === "https://cloudflare-dns.com" &&
      url.pathname === "/dns-query"
    ) {
      const names = url.searchParams.getAll("name");
      const types = url.searchParams.getAll("type");
      let destination: URL | undefined;
      try {
        destination = new URL(`https://${names[0]}`);
      } catch {
        /* Invalid validation names are rejected below. */
      }
      if (
        request.method !== "GET" ||
        names.length !== 1 ||
        types.length !== 1 ||
        !["A", "AAAA"].includes(types[0]) ||
        [...url.searchParams.keys()].some(
          (key) => key !== "name" && key !== "type",
        ) ||
        !destination ||
        !publicDomain(destination) ||
        destination.hostname !== names[0]
      )
        return Response.json(
          { error: "Invalid DNS validation request" },
          { status: 400 },
        );
      try {
        const addresses = await abortable(lookup(names[0]), signal);
        const family = types[0] === "A" ? 4 : 6;
        return Response.json({
          Status: 0,
          Answer: addresses
            .filter((item) => item.family === family)
            .map((item) => ({
              type: family === 4 ? 1 : 28,
              data: item.address,
            })),
        });
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        return Response.json({ Status: 3, Answer: [] });
      }
    }
    const guardedLookup: LookupFunction = (
      hostname,
      lookupOptions,
      callback,
    ) => {
      void abortable(lookup(hostname), signal)
        .then((addresses) => {
          if (
            !addresses.length ||
            addresses.some(
              (item) =>
                ![4, 6].includes(item.family) ||
                isIP(item.address) !== item.family ||
                !isPublicAddress(item.address),
            )
          )
            throw new Error(
              "Collection destination must resolve exclusively to public IP addresses.",
            );
          const family = Number(lookupOptions.family);
          const selected =
            family === 4 || family === 6
              ? addresses.filter((item) => item.family === family)
              : addresses;
          if (!selected.length)
            throw new Error("No public address for requested family.");
          if (lookupOptions.all) callback(null, selected);
          else callback(null, selected[0].address, selected[0].family);
        })
        .catch((error) =>
          callback(
            error instanceof Error
              ? error
              : new Error("Public DNS lookup failed"),
            [],
          ),
        );
    };
    // One dispatcher per request prevents a later request from skipping its
    // connection-time DNS check via a pooled socket; TLS still verifies URL host.
    const agent = new Agent({
      connect: { lookup: guardedLookup, timeout: 10_000 },
      connections: 1,
    });
    agents.add(agent);
    let finished = false;
    const finish = async (destroy = false) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", onAbort);
      try {
        if (destroy) await agent.destroy();
        else await agent.close();
      } finally {
        agents.delete(agent);
      }
    };
    const onAbort = () => {
      void finish(true).catch(() => {});
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await transport(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal,
        redirect: "manual",
        dispatcher: agent,
        ...(request.body ? { duplex: "half" as const } : {}),
      });
      if (!response.body) {
        await finish();
        return response;
      }
      const reader = response.body.getReader();
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              controller.close();
              await finish();
            } else controller.enqueue(next.value);
          } catch (error) {
            controller.error(error);
            await finish(true);
          }
        },
        async cancel(reason) {
          try {
            await reader.cancel(reason);
          } finally {
            await finish(true);
          }
        },
      });
      const result = new Response(stream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      Object.defineProperty(result, "url", { value: response.url });
      Object.defineProperty(result, "redirected", {
        value: response.redirected,
      });
      return result;
    } catch (error) {
      await finish(true);
      throw error;
    }
  };
  return {
    fetch: fetcher as typeof fetch,
    async close() {
      closed = true;
      lifetime.abort(
        new DOMException("Collection fetch adapter closed", "AbortError"),
      );
      await Promise.all([...agents].map((agent) => agent.destroy()));
      agents.clear();
    },
  };
}
