import { afterEach, describe, expect, it, vi } from "vitest";
import { requestSaviaFlowsSocketTicket } from "@/savia/transport";
import {
  connectWorkflowExecutionWS,
  WorkflowWebSocket,
} from "./workflow-session-service";

vi.mock("@/savia/transport", () => ({
  requestSaviaFlowsSocketTicket: vi.fn(),
}));

class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.OPEN;
  sent: string[] = [];
  onopen?: () => void;
  onclose?: (event: CloseEvent) => void;
  onmessage?: (event: MessageEvent) => void;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
  }
  send(message: string) {
    this.sent.push(message);
  }
  serverMessage(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }
  serverClose(code: number, reason: string) {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code, reason, wasClean: code !== 1006 } as CloseEvent);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  FakeSocket.instances = [];
});

async function connect() {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.mocked(requestSaviaFlowsSocketTicket).mockResolvedValue(
    "ws://savia.test/api/public/savia-flows/ws?ticket=fresh",
  );
  const client = new WorkflowWebSocket("tenant:101", "workflow");
  client.connect();
  await vi.advanceTimersByTimeAsync(0);
  return { client, socket: FakeSocket.instances[0] };
}

describe("editor identity lease renewal", () => {
  it("obtains a new ticket after a clean server close caused by lease expiry", async () => {
    const { client, socket } = await connect();
    socket.serverClose(1008, "Editor session expired; reconnect required");
    await vi.advanceTimersByTimeAsync(1000);
    expect(requestSaviaFlowsSocketTicket).toHaveBeenCalledTimes(2);
    expect(FakeSocket.instances).toHaveLength(2);
    client.disconnect();
  });

  it("does not retry a clean permission revocation or a normal close", async () => {
    const { client, socket } = await connect();
    socket.serverClose(1008, "Editor access revoked; reconnect required");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(requestSaviaFlowsSocketTicket).toHaveBeenCalledTimes(1);
    client.disconnect();
  });

  it("does not open another socket after disposal during a scheduled renewal", async () => {
    const { client, socket } = await connect();
    socket.serverClose(1008, "Editor session expired; reconnect required");
    client.disconnect();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(requestSaviaFlowsSocketTicket).toHaveBeenCalledTimes(1);
  });
});

describe("HTTP execution event subscription", () => {
  it("reports when ticket failures exhaust automatic reconnection", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(requestSaviaFlowsSocketTicket).mockRejectedValue(
      new Error("ticket denied"),
    );
    const onReconnectExhausted = vi.fn();
    const client = new WorkflowWebSocket("tenant:101", "workflow", {
      onReconnectExhausted,
    });
    client.connect();

    await vi.advanceTimersByTimeAsync(100_000);
    expect(requestSaviaFlowsSocketTicket).toHaveBeenCalledTimes(6);
    expect(onReconnectExhausted).toHaveBeenCalledTimes(1);
    client.disconnect();
    log.mockRestore();
  });

  it("retries ticket acquisition failures with a fresh ticket", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.mocked(requestSaviaFlowsSocketTicket)
      .mockRejectedValueOnce(new Error("bridge temporarily unavailable"))
      .mockResolvedValue(
        "ws://savia.test/api/public/savia-flows/ws?ticket=fresh",
      );
    const client = connectWorkflowExecutionWS(
      "tenant:101",
      "workflow",
      "execution-7",
      vi.fn(),
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(requestSaviaFlowsSocketTicket).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(requestSaviaFlowsSocketTicket).toHaveBeenCalledTimes(2);
    expect(FakeSocket.instances).toHaveLength(1);
    client.disconnect();
  });

  it("subscribes after init and restores the execution subscription after reconnect", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.mocked(requestSaviaFlowsSocketTicket).mockResolvedValue(
      "ws://savia.test/api/public/savia-flows/ws?ticket=fresh",
    );
    const onExecutionUpdate = vi.fn();
    const client = connectWorkflowExecutionWS(
      "tenant:101",
      "workflow",
      "execution-7",
      onExecutionUpdate,
    );
    await vi.advanceTimersByTimeAsync(0);

    const init = {
      type: "init",
      state: { id: "workflow", nodes: [], edges: [], timestamp: 1 },
    };
    FakeSocket.instances[0].serverMessage(init);
    expect(JSON.parse(FakeSocket.instances[0].sent[0])).toEqual({
      type: "execute",
      executionId: "execution-7",
    });

    FakeSocket.instances[0].serverClose(1006, "network lost");
    await vi.advanceTimersByTimeAsync(1000);
    FakeSocket.instances[1].serverMessage(init);
    expect(JSON.parse(FakeSocket.instances[1].sent[0])).toEqual({
      type: "execute",
      executionId: "execution-7",
    });

    const update = {
      type: "execution_update",
      executionId: "execution-7",
      status: "completed",
      nodeExecutions: [],
    };
    FakeSocket.instances[1].serverMessage(update);
    expect(onExecutionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "execution-7", status: "completed" }),
    );
    client.disconnect();
  });
});
