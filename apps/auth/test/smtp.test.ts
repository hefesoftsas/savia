import { describe, expect, it } from "vitest";
import {
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
  private readonly responses = [
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
});
