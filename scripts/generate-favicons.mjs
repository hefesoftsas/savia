import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(rootDir, "apps/admin/public");
const source = readFileSync(
  join(rootDir, "assets/brand/savia-mark.svg"),
  "utf8",
);
const mark = source.replace(/<svg[^>]*>/, "").replace("</svg>", "");

// Normal icons use almost the entire canvas. Maskable icons reserve the
// central 80%-diameter safe circle; the OS supplies the outer silhouette.
function iconSvg(maskable = false) {
  const scale = maskable ? 0.6 : 0.96;
  const inset = (64 - 64 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g transform="translate(${inset} ${inset}) scale(${scale})">${mark}</g></svg>`;
}

function createIco(pngBuffers) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // 1 = ICO type
  header.writeUInt16LE(count, 4); // Number of images

  let offset = 6 + count * 16;
  const dirEntries = [];
  for (const img of pngBuffers) {
    const dir = Buffer.alloc(16);
    dir.writeUInt8(img.width >= 256 ? 0 : img.width, 0);
    dir.writeUInt8(img.height >= 256 ? 0 : img.height, 1);
    dir.writeUInt8(0, 2); // Color palette count
    dir.writeUInt8(0, 3); // Reserved
    dir.writeUInt16LE(1, 4); // Color planes
    dir.writeUInt16LE(32, 6); // Bits per pixel
    dir.writeUInt32LE(img.buffer.length, 8); // Size of image data
    dir.writeUInt32LE(offset, 12); // Offset in file
    dirEntries.push(dir);
    offset += img.buffer.length;
  }

  return Buffer.concat([
    header,
    ...dirEntries,
    ...pngBuffers.map((b) => b.buffer),
  ]);
}

export async function generateFavicons() {
  const targets = [
    ["favicon-16-v3.png", 16, false],
    ["favicon-32-v3.png", 32, false],
    ["favicon-48-v3.png", 48, false],
    ["apple-touch-icon-v3.png", 180, false],
    ["savia-icon-192-v3.png", 192, false],
    ["savia-icon-512-v3.png", 512, false],
    ["savia-maskable-192-v3.png", 192, true],
    ["savia-maskable-512-v3.png", 512, true],
  ];
  for (const [name, size, maskable] of targets) {
    await sharp(Buffer.from(iconSvg(maskable)), { density: 384 })
      .resize(size, size)
      .png()
      .toFile(join(publicDir, name));
    console.log(`Generated ${name}`);
  }
  writeFileSync(join(publicDir, "favicon.svg"), iconSvg() + "\n");
  const ico = createIco(
    [16, 32, 48].map((size) => ({
      width: size,
      height: size,
      buffer: readFileSync(join(publicDir, `favicon-${size}-v3.png`)),
    })),
  );
  writeFileSync(join(publicDir, "favicon.ico"), ico);
  // The manifest is authored separately: generating icons must not erase
  // installed-app identity, shortcuts, scope, or display settings.
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await generateFavicons();
}
