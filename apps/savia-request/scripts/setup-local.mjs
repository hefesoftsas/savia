import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const path = new URL('../.dev.vars', import.meta.url);
try {
  await writeFile(path, `ENCRYPTION_KEY=${randomBytes(32).toString('base64')}\n`, {flag:'wx',mode:0o600});
  console.log('Configuración local de Savia request creada.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
