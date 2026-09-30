import { describe, expect, it, vi } from "vitest";
import {
  deliverSmtpEmail,
  sendSmtpEmail,
  type SMTPConnection,
  type SMTPSettings,
} from "../src/smtp";

const settings: SMTPSettings = {
  host: "mail.hefesoft.com",
  port: 465,
  username: "no-reply@hefesoft.com",
  password: "test-only-password",
  from: "no-reply@hefesoft.com",
};

class RecordedConnection implements SMTPConnection {
  readonly commands: string[] = [];
  closed = false;
  private responses = [
    "220 mail.hefesoft.com ESMTP ready\r\n",
    "250-mail.hefesoft.com\r\n250 AUTH PLAIN\r\n",
    "235 Authentication succeeded\r\n",
    "250 Sender accepted\r\n",
    "250 Recipient accepted\r\n",
    "354 End data with <CR><LF>.<CR><LF>\r\n",
    "250 Message accepted\r\n",
    "221 Closing connection\r\n",
  ];

  async read(): Promise<string> {
    const response = this.responses.shift();
    if (!response) throw new Error("Unexpected SMTP read");
    return response;
  }

  async write(value: string): Promise<void> {
    this.commands.push(value);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

describe("SMTP delivery", () => {
  it("authenticates and sends a reset message without exposing a Bcc header", async () => {
    const connection = new RecordedConnection();

    await sendSmtpEmail(
      settings,
      {
        to: "person@example.test",
        subject: "Reset your Savia password",
        text: "Use this link:\nhttps://api.example.test/reset?token=opaque",
      },
      connection,
    );

    expect(connection.commands).toEqual([
      "EHLO savia-auth\r\n",
      `AUTH PLAIN ${btoa("\u0000no-reply@hefesoft.com\u0000test-only-password")}\r\n`,
      "MAIL FROM:<no-reply@hefesoft.com>\r\n",
      "RCPT TO:<person@example.test>\r\n",
      "DATA\r\n",
      expect.stringContaining(
        "From: Savia <no-reply@hefesoft.com>\r\nTo: person@example.test\r\n",
      ),
      "QUIT\r\n",
    ]);
    expect(connection.commands[5]).toContain(
      "https://api.example.test/reset?token=opaque\r\n.\r\n",
    );
    expect(connection.commands[5]).not.toContain("Bcc:");
  });

  it("rejects a recipient that attempts header injection", async () => {
    const connection = new RecordedConnection();

    await expect(
      sendSmtpEmail(
        settings,
        {
          to: "person@example.test\r\nBcc: attacker@example.test",
          subject: "Reset your Savia password",
          text: "Use this link",
        },
        connection,
      ),
    ).rejects.toThrow("Invalid SMTP recipient");
    expect(connection.commands).toEqual([]);
    expect(connection.closed).toBe(true);
  });

  it("allows unauthenticated delivery only when both credentials are empty", async () => {
    const connection = new RecordedConnection();
    connection["responses"] = [
      "220 mail.hefesoft.com ESMTP ready\r\n",
      "250 mail.hefesoft.com\r\n",
      "250 Sender accepted\r\n",
      "250 Recipient accepted\r\n",
      "354 End data\r\n",
      "250 Message accepted\r\n",
      "221 Closing connection\r\n",
    ];
    await sendSmtpEmail(
      { ...settings, username: "", password: "" },
      { to: "person@example.test", subject: "Hello", text: "Test" },
      connection,
    );
    expect(
      connection.commands.some((command) => command.startsWith("AUTH ")),
    ).toBe(false);
  });

  it("upgrades the connection before sending credentials with STARTTLS", async () => {
    const connection = new RecordedConnection();
    connection["responses"] = [
      "220 mail.hefesoft.com ESMTP ready\r\n",
      "250 mail.hefesoft.com\r\n",
      "220 Ready to start TLS\r\n",
      "250 mail.hefesoft.com\r\n",
      "235 Authentication succeeded\r\n",
      "250 Sender accepted\r\n",
      "250 Recipient accepted\r\n",
      "354 End data\r\n",
      "250 Message accepted\r\n",
      "221 Closing connection\r\n",
    ];
    let upgraded = false;
    connection.startTls = async () => {
      upgraded = true;
    };
    await sendSmtpEmail(
      { ...settings, security: "starttls" },
      { to: "person@example.test", subject: "Hello", text: "Test" },
      connection,
    );
    expect(upgraded).toBe(true);
    expect(connection.commands.indexOf("STARTTLS\r\n")).toBeLessThan(
      connection.commands.findIndex((command) => command.startsWith("AUTH ")),
    );
  });

  it("rejects unencrypted delivery unless it is explicitly enabled for local development", async () => {
    await expect(
      sendSmtpEmail(
        { ...settings, security: "plain" },
        { to: "person@example.test", subject: "Hello", text: "Test" },
        new RecordedConnection(),
      ),
    ).rejects.toThrow("only allowed for local development");
  });

  it("selects STARTTLS transport mode and closes the socket after handshake failure", async () => {
    const close = vi.fn(async () => undefined);
    const socket = {
      readable: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("500 unexpected\r\n"));
          controller.close();
        },
      }),
      writable: new WritableStream<Uint8Array>(),
      opened: Promise.resolve({}),
      close,
      startTls: vi.fn(),
    } as unknown as Socket;
    let transport: unknown;
    await expect(
      deliverSmtpEmail(
        { ...settings, security: "starttls" },
        { to: "person@example.test", subject: "Hello", text: "Test" },
        (_address, options) => {
          transport = options.secureTransport;
          return socket;
        },
      ),
    ).rejects.toThrow("SMTP server rejected the message");
    expect(transport).toBe("starttls");
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes a socket when its SMTP greeting exceeds the timeout", async () => {
    const close = vi.fn(async () => undefined);
    const socket = {
      readable: new ReadableStream<Uint8Array>(),
      writable: new WritableStream<Uint8Array>(),
      opened: Promise.resolve({}),
      close,
    } as unknown as Socket;
    await expect(
      deliverSmtpEmail(
        { ...settings, timeoutMs: 1_000 },
        { to: "person@example.test", subject: "Hello", text: "Test" },
        () => socket,
      ),
    ).rejects.toThrow("SMTP connection timed out");
    expect(close).toHaveBeenCalledOnce();
  });
});
