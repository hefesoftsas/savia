export type SMTPSettings = {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
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
    const username = requireSingleLine(settings.username, "username");
    const password = requireSingleLine(settings.password, "password");
    const data = smtpData(settings, email);
    await expectResponse(connection, [220]);
    await connection.write("EHLO savia-auth\r\n");
    await expectResponse(connection, [250]);
    await connection.write(
      `AUTH PLAIN ${base64(`\u0000${username}\u0000${password}`)}\r\n`,
    );
    await expectResponse(connection, [235]);
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
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private readonly encoder = new TextEncoder();
  private buffer = "";

  constructor(private readonly socket: Socket) {
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
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
    try {
      await this.writer.close();
    } finally {
      this.reader.releaseLock();
      this.writer.releaseLock();
      await this.socket.close();
    }
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

export async function deliverSmtpEmail(
  settings: SMTPSettings,
  email: SMTPEmail,
): Promise<void> {
  const { connect } = await import("cloudflare:sockets");
  const socket = connect(
    { hostname: settings.host, port: settings.port },
    { secureTransport: "on", allowHalfOpen: false },
  );
  await socket.opened;
  await sendSmtpEmail(settings, email, new SocketConnection(socket));
}
