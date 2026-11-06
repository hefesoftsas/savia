/**
 * Medición local de navegación Studio / Mi día / Savia Request.
 *
 * Recorridos:
 *  - Studio → Mi día → Studio
 *  - Studio → Savia Request → Studio
 *  - Savia Request → Mi día → Savia Request
 *
 * Por recorrido registra (primera visita y regreso por separado):
 *  - tiempo hasta contenido útil (medido DENTRO del navegador con
 *    Performance API, nunca con la duración de las llamadas de
 *    automatización),
 *  - peticiones por endpoint,
 *  - duración de API,
 *  - descarga/ejecución de módulos,
 *  - tareas largas del navegador.
 *
 * La primera visita de cada recorrido es una carga completa (goto) con un
 * contexto de navegador frío —incluye la descarga real de módulos— y los
 * pasos siguientes son navegación SPA (cambio de hash), que es lo que hace
 * la app al cambiar de pantallas. Cada recorrido usa un contexto frío
 * propio, con inicio de sesión previo fuera de la medición.
 *
 * Uso (código actual, ruta Studio = /studio):
 *   SAVIA_PERF_EMAIL=... SAVIA_PERF_PASSWORD=... \
 *   SAVIA_PERF_TOTP_SECRET=... SAVIA_PLAYWRIGHT_PATH=/tmp/nav-perf/node_modules/playwright \
 *   node scripts/navigation-perf/measure-navigation.mjs \
 *     --base http://127.0.0.1:5173 --out scripts/navigation-perf/after.json
 *
 * Baseline sobre el checkout `dev` (Studio aún vive en /crm):
 *   ... --route-studio /crm --out scripts/navigation-perf/baseline.json
 *
 * Credenciales solo por variables de entorno (nunca en archivos): sin
 * SAVIA_PERF_EMAIL/PASSWORD el script imprime los pasos manuales y sale
 * con código 2. Sin `playwright` resoluble, apunta SAVIA_PLAYWRIGHT_PATH
 * al directorio del paquete (p. ej. tras `npm i playwright` en /tmp).
 */

import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const JOURNEY_DEFS = [
  { name: "studio-myday-studio", steps: ["studio", "myDay", "studio"] },
  {
    name: "studio-request-studio",
    steps: ["studio", "saviaRequest", "studio"],
  },
  {
    name: "request-myday-request",
    steps: ["saviaRequest", "myDay", "saviaRequest"],
  },
];

function parseArgs(argv) {
  const out = {
    base: "http://127.0.0.1:5173",
    out: "scripts/navigation-perf/after.json",
    headed: false,
    routeStudio: "/studio",
    routeMyDay: "/my-day",
    routeSaviaRequest: "/savia-request",
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--base") out.base = argv[++i];
    else if (argv[i] === "--out") out.out = argv[++i];
    else if (argv[i] === "--headed") out.headed = true;
    else if (argv[i] === "--route-studio") out.routeStudio = argv[++i];
    else if (argv[i] === "--route-myday") out.routeMyDay = argv[++i];
    else if (argv[i] === "--route-request") out.routeSaviaRequest = argv[++i];
  }
  return out;
}

export function summarizeRequests(requests) {
  const byEndpoint = {};
  let apiMs = 0;
  for (const r of requests) {
    const key = `${r.method} ${new URL(r.url).pathname}`;
    byEndpoint[key] = (byEndpoint[key] ?? 0) + 1;
    if (r.url.includes("/api/") || r.url.includes("/v1/"))
      apiMs += r.durationMs ?? 0;
  }
  return { byEndpoint, apiMs: Math.round(apiMs) };
}

export function summarizePerfEntries(entries) {
  let jsBytes = 0;
  let jsMs = 0;
  for (const e of entries) {
    const name = e.name ?? "";
    const isScript =
      e.initiatorType === "script" ||
      /\.(js|mjs|cjs|ts|tsx|jsx)(\?|#|$)/.test(name);
    if (e.entryType === "resource" && isScript) {
      jsBytes += e.transferSize ?? e.decodedBodySize ?? 0;
      jsMs += e.duration ?? 0;
    }
  }
  return { jsBytes: Math.round(jsBytes), jsMs: Math.round(jsMs) };
}

/** TOTP RFC 6238 (SHA-1, 30 s, 6 dígitos) con la clave como bytes UTF-8. */
export function totpNow(secret, at = Date.now()) {
  const counter = Math.floor(at / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", Buffer.from(secret, "utf8"))
    .update(msg)
    .digest();
  const o = h[h.length - 1] & 0xf;
  const v =
    ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(v % 10 ** 6).padStart(6, "0");
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const fromPath = process.env.SAVIA_PLAYWRIGHT_PATH;
    if (fromPath) {
      return await import(pathToFileURL(fromPath + "/index.mjs").href);
    }
    throw new Error("no-playwright");
  }
}

/** Inicia sesión OAuth (email+password+TOTP opcional) fuera de la medición. */
async function login(page, base, email, password, totpSecret) {
  const onApp = (url) => url.startsWith(base + "/#") || url === base + "/";
  await page.goto(base + "/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  try {
    await page.waitForURL((url) => !onApp(url.href), { timeout: 10000 });
  } catch {
    return;
  }
  await page.waitForURL(/\/api\/auth\/login/, { timeout: 20000 });
  await page
    .locator("#email, input[name=email], input[type=email]")
    .first()
    .fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /continuar/i }).click();
  if (totpSecret) {
    const codeInput = page
      .locator("input[name=code], input[inputmode=numeric]")
      .first();
    try {
      await codeInput.waitFor({ timeout: 8000 });
      // El código rota cada 30 s: si el envío cruza el cambio de ventana el
      // servidor lo rechaza; reintenta una vez con un código fresco.
      for (let attempt = 0; attempt < 2; attempt++) {
        await codeInput.fill(totpNow(totpSecret));
        await page.getByRole("button", { name: /verificar/i }).click();
        try {
          await page.waitForURL((url) => onApp(url.href), { timeout: 15000 });
          break;
        } catch {
          if (attempt === 1) throw new Error("MFA rechazado dos veces");
        }
      }
    } catch (error) {
      if (String(error?.message ?? error).includes("MFA rechazado"))
        throw error;
      // Sin paso de MFA visible: continúa.
    }
  }
  // Espera a volver a la app (127.0.0.1 también casa con el login).
  await page.waitForURL((url) => onApp(url.href), { timeout: 60000 });
  await page.waitForSelector("main h1", { timeout: 60000 });
}

function beginStepCapture(page, requests) {
  const onFinished = (req) => {
    try {
      // timing.responseEnd ya es relativo al inicio de la petición.
      const timing = req.timing?.();
      const durationMs =
        timing &&
        typeof timing.responseEnd === "number" &&
        timing.responseEnd >= 0
          ? timing.responseEnd
          : 0;
      requests.push({ method: req.method(), url: req.url(), durationMs });
    } catch {
      requests.push({ method: req.method(), url: req.url() });
    }
  };
  const onFailed = (req) =>
    requests.push({ method: req.method(), url: req.url(), failed: true });
  page.on("requestfinished", onFinished);
  page.on("requestfailed", onFailed);
  return () => {
    page.off("requestfinished", onFinished);
    page.off("requestfailed", onFailed);
  };
}

async function armInPageMeasurement(page, clear) {
  await page.evaluate((shouldClear) => {
    window.__saviaPerf = { longTasks: 0, longTaskMs: 0 };
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__saviaPerf.longTasks += 1;
          window.__saviaPerf.longTaskMs += entry.duration;
        }
      });
      obs.observe({ entryTypes: ["longtask"] });
      window.__saviaPerfObserver = obs;
    } catch {
      // PerformanceObserver/longtask no disponible: se reporta en cero.
    }
    if (shouldClear) {
      try {
        performance.clearResourceTimings();
      } catch {
        // ignore
      }
    }
    performance.mark("savia-nav-start");
  }, clear);
}

async function readInPageMeasurement(page, fromNavStart, cachedMs) {
  const measured = await page.evaluate((fromStart) => {
    let timeToUsefulMs = null;
    try {
      if (fromStart) {
        // Recarga completa: performance.now() cubre desde el inicio del
        // documento (las marcas previas se pierden con la navegación).
        timeToUsefulMs = performance.now();
      } else {
        performance.mark("savia-useful-content");
        performance.measure(
          "savia-time-to-useful",
          "savia-nav-start",
          "savia-useful-content",
        );
        timeToUsefulMs =
          performance.getEntriesByName("savia-time-to-useful").at(-1)
            ?.duration ?? null;
      }
    } catch {
      // ignore
    }
    const resources = performance.getEntriesByType("resource").map((r) => ({
      entryType: "resource",
      initiatorType: r.initiatorType,
      name: r.name,
      duration: r.duration,
      transferSize: r.transferSize,
      decodedBodySize: r.decodedBodySize,
    }));
    try {
      window.__saviaPerfObserver?.disconnect();
    } catch {
      // ignore
    }
    return {
      timeToUsefulMs:
        timeToUsefulMs == null ? null : Math.round(timeToUsefulMs),
      resources,
      longTasks: window.__saviaPerf ?? { longTasks: 0, longTaskMs: 0 },
    };
  }, fromNavStart);
  measured.timeToCachedMs = cachedMs;
  return measured;
}

function finishStep(label, route, navigationKind, requests, measured, hash) {
  const { byEndpoint, apiMs } = summarizeRequests(requests);
  const { jsBytes, jsMs } = summarizePerfEntries(measured.resources);
  return {
    label,
    route,
    hash,
    navigationKind,
    timeToCachedMs: measured.timeToCachedMs,
    timeToUsefulMs: measured.timeToUsefulMs,
    requestCount: requests.length,
    requestsByEndpoint: byEndpoint,
    apiDurationMs: apiMs,
    moduleJsBytes: jsBytes,
    moduleJsMs: Math.round(jsMs),
    longTasks: measured.longTasks.longTasks,
    longTaskMs: Math.round(measured.longTasks.longTaskMs ?? 0),
  };
}

// Primer pintado con datos NUEVOS de la ruta (vale contenido conservado
// sin sincronizar, pero no el stale de la pantalla anterior ni estados
// vacíos como "Savia request" sin flows).
async function waitCached(page, route, previousH1) {
  await page.waitForFunction(
    ({ current, previous }) => {
      const h1 = (document.querySelector("main h1")?.textContent ?? "").trim();
      if (h1.length <= 3 || h1.startsWith("Cargando") || h1 === previous)
        return false;
      if (current.includes("savia-request")) {
        return (
          location.hash.includes("savia-request") && h1 !== "Savia request"
        );
      }
      if (current.includes("my-day")) {
        return location.hash.includes("my-day");
      }
      return location.hash.includes("studio") || location.hash.includes("crm");
    },
    { current: route, previous: previousH1 },
    { timeout: 60000, polling: 250 },
  );
}

// Reloj leído dentro del navegador (nunca duraciones de automatización).
async function readClock(page, fromStart, mark) {
  return page.evaluate(
    ({ fromNavStart, markName }) => {
      try {
        if (fromNavStart) return Math.round(performance.now());
        performance.mark(markName);
        performance.measure(markName + "-m", "savia-nav-start", markName);
        const duration = performance
          .getEntriesByName(markName + "-m")
          .at(-1)?.duration;
        return duration == null ? null : Math.round(duration);
      } catch {
        return null;
      }
    },
    { fromNavStart: fromStart, mark },
  );
}
// Contenido sincronizado por ruta: primer contenido con datos, sin contar
// spinners ni pantallas de carga. Se evalúa dentro del navegador.
async function waitUseful(page, route) {
  await page.waitForFunction(
    (current) => {
      const h1 = (document.querySelector("main h1")?.textContent ?? "").trim();
      if (current.includes("savia-request")) {
        return (
          location.hash.includes("savia-request") &&
          location.hash.includes("flow=") &&
          h1.length > 3 &&
          h1 !== "Savia request"
        );
      }
      if (current.includes("my-day")) {
        return location.hash.includes("my-day") && h1.includes("Mi día");
      }
      return (
        (location.hash.includes("studio") || location.hash.includes("crm")) &&
        !h1.startsWith("Cargando") &&
        (h1.length > 3 ||
          document.querySelector("main table, main [role=grid]") != null)
      );
    },
    route,
    { timeout: 60000, polling: 250 },
  );
}

async function measureFullLoad(page, base, route, label) {
  const requests = [];
  const stop = beginStepCapture(page, requests);
  // El query `cold` fuerza una recarga completa del documento: solo con el
  // hash el navegador no recargaría y la "primera visita" sería ficticia.
  await page.goto(`${base}/?cold=${encodeURIComponent(label)}#${route}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  // Se arma DESPUÉS de navegar: el documento nuevo pierde marcas,
  // observadores y timings previos. No se limpia el buffer para conservar
  // las descargas desde el inicio del documento.
  await armInPageMeasurement(page, false);
  await waitCached(page, route, "");
  const cachedMs = await readClock(page, true);
  await waitUseful(page, route);
  const measured = await readInPageMeasurement(page, true, cachedMs);
  // Margen para normalización de URL (p. ej. Studio añade ?domain=...):
  // el regreso debe volver a la URL exacta ya normalizada.
  await page.waitForTimeout(1500);
  const hash = await page.evaluate(() => location.hash);
  stop();
  return finishStep(label, route, "full-load", requests, measured, hash);
}

async function measureSpaNav(page, target, label) {
  const requests = [];
  const stop = beginStepCapture(page, requests);
  const previousH1 = await page
    .$eval("main h1", (el) => (el.textContent ?? "").trim())
    .catch(() => "");
  // Mismo documento: se limpia el buffer para atribuir descargas al paso.
  await armInPageMeasurement(page, true);
  // El regreso vuelve a la URL exacta de la primera visita (los enlaces
  // reales conservan dominio y vista); la intermedia usa la ruta base.
  await page.evaluate((hash) => {
    if (hash.startsWith("#")) window.location.hash = hash;
    else window.location.hash = "#" + hash;
  }, target);
  const route = target.startsWith("#") ? target.slice(1) : target;
  await waitCached(page, route, previousH1);
  const cachedMs = await readClock(page, false, "savia-cached-content");
  await waitUseful(page, route);
  // Deja un margen para peticiones de revalidación en segundo plano.
  await page.waitForTimeout(1500);
  const measured = await readInPageMeasurement(page, false, cachedMs);
  const hash = await page.evaluate(() => location.hash);
  stop();
  return finishStep(label, route, "spa", requests, measured, hash);
}

async function main() {
  const opts = parseArgs(process.argv);
  const email = process.env.SAVIA_PERF_EMAIL;
  const password = process.env.SAVIA_PERF_PASSWORD;
  const totpSecret = process.env.SAVIA_PERF_TOTP_SECRET;
  let playwright;
  try {
    playwright = await loadPlaywright();
  } catch {
    playwright = null;
  }
  if (!playwright || !email || !password) {
    console.error(
      "[navigation-perf] Medición automática no disponible.\n" +
        "Pasos manuales: inicia sesión en el stack local, abre DevTools → Performance,\n" +
        "recorre Studio → Mi día → Studio, Studio → Savia Request → Studio y\n" +
        "Savia Request → Mi día → Savia Request (primera visita y regreso),\n" +
        "y anota time-to-useful, peticiones por endpoint, duración API,\n" +
        "descarga de módulos y long tasks en scripts/navigation-perf/baseline.json.\n" +
        "Automático: instala playwright (p. ej. `npm i playwright` en /tmp y exporta\n" +
        "SAVIA_PLAYWRIGHT_PATH) y exporta SAVIA_PERF_EMAIL/PASSWORD (+TOTP si hay MFA).",
    );
    process.exit(2);
  }
  const routes = {
    studio: opts.routeStudio,
    myDay: opts.routeMyDay,
    saviaRequest: opts.routeSaviaRequest,
  };
  const browser = await playwright.chromium.launch({ headless: !opts.headed });
  const results = {
    base: opts.base,
    routes,
    startedAt: new Date().toISOString(),
    journeys: [],
  };
  try {
    for (const journey of JOURNEY_DEFS) {
      // Reintento único de login+recorrido ante authorize colgado o
      // ventana TOTP límite; cada intento usa un contexto frío propio.
      let done = false;
      for (let attempt = 0; attempt < 2 && !done; attempt++) {
        const context = await browser.newContext();
        const page = await context.newPage();
        const steps = [];
        try {
          await login(page, opts.base, email, password, totpSecret);
          for (let i = 0; i < journey.steps.length; i++) {
            const route = routes[journey.steps[i]];
            const visit =
              i === 0
                ? "primera-visita"
                : i === journey.steps.length - 1
                  ? "regreso"
                  : "intermedia";
            const label = `${journey.name}:${visit}`;
            // El regreso vuelve a la URL exacta de la primera visita.
            const target =
              visit === "regreso" && steps[0]?.hash ? steps[0].hash : route;
            steps.push(
              i === 0
                ? await measureFullLoad(page, opts.base, route, label)
                : await measureSpaNav(page, target, label),
            );
          }
          results.journeys.push({ name: journey.name, steps });
          done = true;
        } catch (error) {
          if (attempt === 1) {
            results.journeys.push({
              name: journey.name,
              error:
                error instanceof Error
                  ? error.message.slice(0, 300)
                  : String(error),
              steps,
            });
          }
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  results.finishedAt = new Date().toISOString();
  writeFileSync(opts.out, JSON.stringify(results, null, 2) + "\n");
  console.log(`[navigation-perf] Resultados en ${opts.out}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
