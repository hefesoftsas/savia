import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
const MAGIC = Buffer.from("SAVIAFB1");
export async function encryptBackup(input, output, keyHex, decrypt = false) {
  if (!/^[a-f0-9]{64}$/i.test(keyHex ?? ""))
    throw new Error("SAVIA_FLOWS_BACKUP_KEY must be a 256-bit hex key");
  if (input === output) throw new Error("Backup input and output must differ");
  const key = Buffer.from(keyHex, "hex");
  const destination = await open(output, "wx", 0o600);
  try {
    if (!decrypt) {
      const iv = randomBytes(12);
      await destination.write(Buffer.concat([MAGIC, iv]));
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      await pipeline(
        createReadStream(input),
        cipher,
        createWriteStream(output, {
          fd: destination.fd,
          start: 20,
          autoClose: false,
        }),
      );
      await destination.write(
        cipher.getAuthTag(),
        0,
        16,
        (await destination.stat()).size,
      );
    } else {
      const source = await open(input, "r");
      try {
        const size = (await stat(input)).size;
        if (size < 36) throw new Error("Invalid encrypted backup");
        const header = Buffer.alloc(20),
          tag = Buffer.alloc(16);
        await source.read(header, 0, 20, 0);
        await source.read(tag, 0, 16, size - 16);
        if (!header.subarray(0, 8).equals(MAGIC))
          throw new Error("Invalid encrypted backup header");
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          header.subarray(8),
        );
        decipher.setAuthTag(tag);
        await pipeline(
          createReadStream(input, { start: 20, end: size - 17 }),
          decipher,
          createWriteStream(output, { fd: destination.fd, autoClose: false }),
        );
      } finally {
        await source.close();
      }
    }
  } catch (error) {
    await destination.close().catch(() => {});
    await unlink(output).catch(() => {});
    throw error;
  }
  await destination.close();
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const value = (flag) => process.argv[process.argv.indexOf(flag) + 1];
  const action = value("--action");
  if (
    !process.argv.includes("--input") ||
    !process.argv.includes("--output") ||
    !["encrypt", "decrypt"].includes(action)
  )
    throw new Error(
      "Use --action encrypt|decrypt --input <archive> --output <file>",
    );
  encryptBackup(
    value("--input"),
    value("--output"),
    process.env.SAVIA_FLOWS_BACKUP_KEY,
    action === "decrypt",
  ).catch(() => {
    console.error("Backup encryption or integrity verification failed");
    process.exitCode = 1;
  });
}
