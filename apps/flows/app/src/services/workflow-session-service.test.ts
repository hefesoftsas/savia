import { afterEach, describe, expect, it, vi } from "vitest";
import { requestSaviaFlowsSocketTicket } from "@/savia/transport";
import { WorkflowWebSocket } from "./workflow-session-service";

vi.mock("@/savia/transport", () => ({
  requestSaviaFlowsSocketTicket: vi.fn(),
}));

class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.OPEN;
  onopen?: () => void;
  onclose?: (event: CloseEvent) => void;
  onmessage?: (event: MessageEvent) => void;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
  }
  serverClose(code: number, reason: string) {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code, reason, wasClean: true } as CloseEvent);
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
