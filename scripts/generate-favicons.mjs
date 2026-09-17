import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const publicDir = resolve(rootDir, "apps/admin/public");
const defaultSourceImage = resolve(rootDir, "apps/admin/public/savia-logo-source.png");

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function resizeWithSips(source, target, size) {
  execFileSync("/usr/bin/sips", [
    "-z",
    String(size),
    String(size),
    source,
    "--out",
    target,
  ]);
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

export function generateFavicons(sourcePath = defaultSourceImage) {
  if (!existsSync(sourcePath)) {
    throw new Error(`Source image not found: ${sourcePath}`);
  }

  ensureDir(publicDir);

  const targets = [
    { name: "favicon-16x16.png", size: 16 },
    { name: "favicon-32x32.png", size: 32 },
    { name: "favicon-48x48.png", size: 48 },
    { name: "apple-touch-icon.png", size: 180 },
    { name: "android-chrome-192x192.png", size: 192 },
    { name: "android-chrome-512x512.png", size: 512 },
  ];

  console.log(`Generating icons from ${sourcePath} into ${publicDir}...`);

  for (const { name, size } of targets) {
    const dest = join(publicDir, name);
    resizeWithSips(sourcePath, dest, size);
    console.log(`✓ Generated ${name} (${size}x${size})`);
  }

  // Generate multi-resolution favicon.ico
  const icoBuffers = [16, 32, 48].map((size) => ({
    width: size,
    height: size,
    buffer: readFileSync(join(publicDir, `favicon-${size}x${size}.png`)),
  }));

  const icoPath = join(publicDir, "favicon.ico");
  writeFileSync(icoPath, createIco(icoBuffers));
  console.log(`✓ Generated favicon.ico (16, 32, 48 multi-size)`);

  // Copy full resolution logo.png
  copyFileSync(sourcePath, join(publicDir, "logo.png"));
  console.log(`✓ Copied full-res logo.png`);

  // Write site.webmanifest
  const manifest = {
    name: "Savia",
    short_name: "Savia",
    description: "Plataforma low-code multi-inquilino de seguros",
    icons: [
      {
        src: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    theme_color: "#0d9488",
    background_color: "#ffffff",
    display: "standalone",
    start_url: "/",
  };

  writeFileSync(
    join(publicDir, "site.webmanifest"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(`✓ Generated site.webmanifest`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const customSource = process.argv[2] || defaultSourceImage;
  generateFavicons(customSource);
}
