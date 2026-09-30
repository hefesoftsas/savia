export type SMTPSettings = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  from: string;
  security?: "tls" | "starttls" | "plain";
  allowInsecure?: boolean;
  timeoutMs?: number;
};

export type SMTPEmail = {
  to: string;
  subject: string;
  text: string;
};

export type SMTPConnection = {
  read(): Promise<string>;
  write(value: string): Promise<void>;
  close(): Promise<void>;
  startTls?(): Promise<void>;
};

function validAddress(value: string): boolean {
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
}

function requireAddress(value: string, name: string): string {
  if (!validAddress(value) || /[\r\n]/.test(value))
    throw new Error(`Invalid SMTP ${name}`);
  return value;
}

function requireSingleLine(value: string, name: string): string {
  if (!value || /[\r\n]/.test(value)) throw new Error(`Invalid SMTP ${name}`);
  return value;
}

function base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function smtpData(settings: SMTPSettings, email: SMTPEmail): string {
  const from = requireAddress(settings.from, "sender");
  const to = requireAddress(email.to, "recipient");
  const subject = requireSingleLine(email.subject, "subject");
  const text = email.text.replace(/\r\n|\r|\n/g, "\r\n").replace(/^\./gm, "..");
  return [
    `From: Savia <${from}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${base64(subject)}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    ".",
    "",
  ].join("\r\n");
}

function responseCode(response: string): number | undefined {
  const match = response.match(/^(\d{3})[ -]/m);
  return match ? Number(match[1]) : undefined;
}

async function expectResponse(
  connection: SMTPConnection,
  expected: number[],
): Promise<void> {
  const response = await connection.read();
  if (!expected.includes(responseCode(response) ?? 0))
    throw new Error("SMTP server rejected the message");
}

export async function sendSmtpEmail(
  settings: SMTPSettings,
  email: SMTPEmail,
  connection: SMTPConnection,
): Promise<void> {
  try {
    const from = requireAddress(settings.from, "sender");
    const to = requireAddress(email.to, "recipient");
    const username = settings.username ?? "";
    const password = settings.password ?? "";
    if ((username.length === 0) !== (password.length === 0))
      throw new Error("Invalid SMTP credentials");
    if (settings.security === "plain" && settings.allowInsecure !== true)
      throw new Error("Unencrypted SMTP is only allowed for local development");
    if (/\r|\n/.test(username) || /\r|\n/.test(password))
      throw new Error("Invalid SMTP credentials");
    const data = smtpData(settings, email);
    await expectResponse(connection, [220]);
    await connection.write("EHLO savia-auth\r\n");
    await expectResponse(connection, [250]);
    if (settings.security === "starttls") {
      await connection.write("STARTTLS\r\n");
      await expectResponse(connection, [220]);
      if (!connection.startTls)
        throw new Error("SMTP connection cannot upgrade to TLS");
      await connection.startTls();
      await connection.write("EHLO savia-auth\r\n");
      await expectResponse(connection, [250]);
    }
    if (username) {
      const safeUsername = requireSingleLine(username, "username");
      const safePassword = requireSingleLine(password, "password");
      await connection.write(
        `AUTH PLAIN ${base64(`\u0000${safeUsername}\u0000${safePassword}`)}\r\n`,
      );
      await expectResponse(connection, [235]);
    }
    await connection.write(`MAIL FROM:<${from}>\r\n`);
    await expectResponse(connection, [250]);
    await connection.write(`RCPT TO:<${to}>\r\n`);
    await expectResponse(connection, [250, 251]);
    await connection.write("DATA\r\n");
    await expectResponse(connection, [354]);
    await connection.write(data);
    await expectResponse(connection, [250]);
    await connection.write("QUIT\r\n");
    await expectResponse(connection, [221]);
  } finally {
    await connection.close();
  }
}

class SocketConnection implements SMTPConnection {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private readonly encoder = new TextEncoder();
  private buffer = "";
  private closed = false;

  constructor(private socket: Socket) {
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  async startTls(): Promise<void> {
    this.reader.releaseLock();
    this.writer.releaseLock();
    const upgraded = this.socket.startTls();
    this.socket = upgraded;
    await upgraded.opened;
    this.reader = upgraded.readable.getReader();
    this.writer = upgraded.writable.getWriter();
    this.buffer = "";
  }

  async read(): Promise<string> {
    const lines: string[] = [];
    let code: string | undefined;
    for (;;) {
      const line = await this.readLine();
      lines.push(line);
      const match = line.match(/^(\d{3})([ -])/);
      if (!match) continue;
      code ??= match[1];
      if (match[1] === code && match[2] === " ") return lines.join("\r\n");
    }
  }

  async write(value: string): Promise<void> {
    await this.writer.write(this.encoder.encode(value));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.reader.releaseLock();
    } catch {}
    try {
      this.writer.releaseLock();
    } catch {}
    await this.socket.close();
  }

  private async readLine(): Promise<string> {
    for (;;) {
      const separator = this.buffer.indexOf("\r\n");
      if (separator >= 0) {
        const line = this.buffer.slice(0, separator);
        this.buffer = this.buffer.slice(separator + 2);
        return line;
      }
      const { value, done } = await this.reader.read();
      if (done) throw new Error("SMTP server closed the connection");
      this.buffer += this.decoder.decode(value, { stream: true });
    }
  }
}

type SocketConnector = (
  address: { hostname: string; port: number },
  options: { secureTransport: "on" | "off" | "starttls"; allowHalfOpen: false },
) => Socket;

export async function deliverSmtpEmail(
  settings: SMTPSettings,
  email: SMTPEmail,
  connector?: SocketConnector,
): Promise<void> {
  const security = settings.security ?? "tls";
  const connectSocket =
    connector ??
    ((await import("cloudflare:sockets")).connect as SocketConnector);
  const socket = connectSocket(
    { hostname: settings.host, port: settings.port },
    {
      secureTransport:
        security === "tls"
          ? "on"
          : security === "starttls"
            ? "starttls"
            : "off",
      allowHalfOpen: false,
    },
  );
  const connection = new SocketConnection(socket);
  const timeoutMs = Math.min(
    Math.max(settings.timeoutMs ?? 15_000, 1_000),
    60_000,
  );
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    await Promise.race([
      socket.opened.then(() => {
        if (timedOut) throw new Error("SMTP connection timed out");
        return sendSmtpEmail(settings, email, connection);
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          timedOut = true;
          reject(new Error("SMTP connection timed out"));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    await connection.close().catch(() => undefined);
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
