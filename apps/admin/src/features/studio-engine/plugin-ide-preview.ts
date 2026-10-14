import type { PluginIdeFixtures } from "./plugin-ide-project";
import type { StoreJson } from "@savia/studio-shared/plugin-store";
import {
  sanitizePluginIdeTheme,
  type PluginIdeTheme,
} from "./plugin-ide-theme";

export function createPluginPreviewDocument(
  entryJs: string,
  fixtures: PluginIdeFixtures,
  store: StoreJson,
  session: string,
  locale: "es" | "en" | "pt",
  theme?: PluginIdeTheme,
): string {
  const previewFixtures = sanitizePreviewValue(fixtures);
  const previewTheme = sanitizePluginIdeTheme(theme);
  const previewNotice = {
    es: "Vista previa simulada · no se guardan datos",
    en: "Mock preview · no data is saved",
    pt: "Prévia simulada · nenhum dado é salvo",
  }[locale];
  const payload = JSON.stringify({
    entryJs,
    fixtures: previewFixtures,
    store,
    session,
    locale,
    theme: previewTheme,
  })
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Savia plugin preview</title>
  <style>html,body,#root{min-height:100%;margin:0}body{font-size:14px;color:#1b2430}.notice{padding:14px 18px;background:#f4f6f8;color:#526070;font-size:12px}#root{padding:12px}pre{white-space:pre-wrap;color:#a00020;padding:16px}</style>
</head>
<body>
  <div class="notice">${previewNotice}</div>
  <div id="root"></div>
  <script type="application/json" id="preview-payload">${payload}</script>
  <script type="module">
    const payload = JSON.parse(document.getElementById("preview-payload").textContent);
    const themeColorKeys = ["background", "foreground", "muted", "mutedForeground", "border", "primary"];
    function safeTheme(value) {
      if (!value || typeof value !== "object") return null;
      const theme = {};
      for (const key of themeColorKeys) {
        if (typeof value[key] !== "string" || !/^#[0-9a-f]{6}$/i.test(value[key])) return null;
        theme[key] = value[key];
      }
      if (typeof value.fontFamily !== "string" || value.fontFamily.length > 160 || !/^[\\w\\s,'"-]+$/.test(value.fontFamily)) return null;
      if (typeof value.isDark !== "boolean") return null;
      theme.fontFamily = value.fontFamily;
      theme.isDark = value.isDark;
      return theme;
    }
    function applyTheme(value) {
      const theme = safeTheme(value);
      if (!theme) return;
      const root = document.documentElement;
      root.style.setProperty("--background", theme.background);
      root.style.setProperty("--foreground", theme.foreground);
      root.style.setProperty("--muted", theme.muted);
      root.style.setProperty("--muted-foreground", theme.mutedForeground);
      root.style.setProperty("--border", theme.border);
      root.style.setProperty("--primary", theme.primary);
      root.style.colorScheme = theme.isDark ? "dark" : "light";
      document.body.style.backgroundColor = theme.background;
      document.body.style.color = theme.foreground;
      document.body.style.fontFamily = theme.fontFamily;
      const notice = document.querySelector(".notice");
      const background = theme.background.slice(1).match(/.{2}/g).map((channel) => parseInt(channel, 16));
      const foreground = theme.foreground.slice(1).match(/.{2}/g).map((channel) => parseInt(channel, 16));
      notice.style.backgroundColor = "#" + background.map((channel, index) => Math.round(channel * 0.94 + foreground[index] * 0.06).toString(16).padStart(2, "0")).join("");
      notice.style.color = theme.mutedForeground;
    }
    applyTheme(payload.theme);
    window.addEventListener("message", (event) => {
      if (event.source !== parent || event.data?.type !== "savia-plugin-ide-theme" || event.data?.session !== payload.session) return;
      applyTheme(event.data.theme);
    });
    let emittedLogs = 0;
    let emittedErrors = 0;
    let emittedReady = false;
    let initialRuntimeError = false;
    function emit(kind, message) {
      if (kind === "log") {
        if (emittedLogs >= 50) return;
        emittedLogs += 1;
      } else if (kind === "error") {
        if (emittedErrors >= 10) return;
        emittedErrors += 1;
      } else if (kind === "ready") {
        if (emittedReady) return;
        emittedReady = true;
      }
      const text = String(message ?? "").slice(0, 1200);
      parent.postMessage({ type: "savia-plugin-ide", session: payload.session, kind, message: text }, "*");
    }
    function safe(value) {
      if (Array.isArray(value)) return value.map(safe);
      if (!value || typeof value !== "object") return value;
      const result = Object.create(null);
      for (const [key, item] of Object.entries(value)) {
        if (["__proto__", "prototype", "constructor"].includes(key) || /(?:api[_-]?key|access[_-]?key|authorization|password|secret|token)/i.test(key)) continue;
        result[key] = safe(item);
      }
      return result;
    }
    function formatLogPart(part) {
      if (typeof part === "string") return part;
      try { return JSON.stringify(safe(part)); }
      catch { try { return String(part); } catch { return "[unprintable value]"; } }
    }
    const rowsByCollection = safe(payload.fixtures.collections || {});
    const settingsValue = safe({ ...(payload.store.settings?.defaults || {}), ...(payload.fixtures.settings || {}) });
    let settingsVersion = 1;
    let settingsUpdatedAt = null;
    const mockPanel = { dirty: false, busy: false };
    const definitions = (payload.store.collections || []).map((entry) => {
      const object = entry.object || {};
      return { name: object.name || object.id || "collection", label: object.label || object.name || "Collection", description: object.description || "", config: object.config || {} };
    });
    function mockCollection(name) {
      const rows = rowsByCollection[name] || (rowsByCollection[name] = []);
      function find(id) { return rows.find((row) => String(row.id) === String(id)); }
      return {
        async list(options = {}) {
          const page = Math.max(1, Number(options.page) || 1);
          const perPage = Math.min(500, Math.max(1, Number(options.perPage) || 25));
          let filtered = [...rows];
          if (options.q) {
            const fields = options.searchFields || [];
            filtered = filtered.filter((row) => fields.some((field) => String(row[field] ?? "").toLowerCase().includes(String(options.q).toLowerCase())));
          }
          if (options.filters?.conditions?.length) {
            const matches = (row, condition) => {
              const value = row[condition.field];
              switch (condition.op) {
                case "eq": return value === condition.value;
                case "ne": return value !== condition.value;
                case "gt": return value > condition.value;
                case "gte": return value >= condition.value;
                case "lt": return value < condition.value;
                case "lte": return value <= condition.value;
                case "contains": return String(value ?? "").includes(String(condition.value ?? ""));
                case "startsWith": return String(value ?? "").startsWith(String(condition.value ?? ""));
                case "endsWith": return String(value ?? "").endsWith(String(condition.value ?? ""));
                case "empty": return value === null || value === undefined || value === "";
                case "in": return Array.isArray(condition.value) && condition.value.includes(value);
                default: return true;
              }
            };
            const conditions = options.filters.conditions;
            filtered = filtered.filter((row) => options.filters.logic === "or" ? conditions.some((condition) => matches(row, condition)) : conditions.every((condition) => matches(row, condition)));
          }
          if (options.sort) {
            const direction = options.order === "ASC" ? 1 : -1;
            filtered.sort((left, right) => String(left[options.sort] ?? "").localeCompare(String(right[options.sort] ?? "")) * direction);
          }
          const total = filtered.length;
          return { data: filtered.slice((page - 1) * perPage, page * perPage).map((row) => ({ ...row })), total, page, perPage };
        },
        async get(id) { const row = find(id); if (!row) throw new Error("Record not found in preview: " + id); return { ...row }; },
        async create(input) {
          const row = { ...safe(input), id: (globalThis.crypto?.randomUUID?.() || "preview-" + Date.now() + "-" + rows.length), _version: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
          rows.push(row); return { ...row };
        },
        async update(id, input, options = {}) {
          const index = rows.findIndex((row) => String(row.id) === String(id));
          if (index < 0) throw new Error("Record not found in preview: " + id);
          if (options.version !== undefined && Number(rows[index]._version || 0) !== options.version) throw new Error("Record version conflict in preview.");
          rows[index] = { ...rows[index], ...safe(input), id: rows[index].id, _version: Number(rows[index]._version || 0) + 1, updated_at: new Date().toISOString() };
          return { ...rows[index] };
        },
        async remove(id, options = {}) { const index = rows.findIndex((row) => String(row.id) === String(id)); if (index < 0) throw new Error("Record not found in preview: " + id); if (options.version !== undefined && Number(rows[index]._version || 0) !== options.version) throw new Error("Record version conflict in preview."); rows.splice(index, 1); },
        async removeMany(records) {
          const result = records.map(({ id }) => ({ id, ok: find(id) !== undefined }));
          for (const { id } of records) { const index = rows.findIndex((row) => String(row.id) === String(id)); if (index >= 0) rows.splice(index, 1); }
          return result;
        },
        async describe() { return definitions.find((item) => item.name === name); }
      };
    }
    const savia = {
      collections: {
        async list() { return definitions; },
        collection(name) { return mockCollection(name); }
      },
      settings: {
        async get() { return { value: structuredClone(settingsValue), version: settingsVersion, updatedAt: settingsUpdatedAt }; },
        async replace(value, version) { if (version !== settingsVersion) throw new Error("Settings version conflict in preview."); Object.keys(settingsValue).forEach((key) => delete settingsValue[key]); Object.assign(settingsValue, safe(value)); settingsVersion += 1; settingsUpdatedAt = new Date().toISOString(); return { value: structuredClone(settingsValue), version: settingsVersion, updatedAt: settingsUpdatedAt }; }
      },
      i18n: { locale: payload.locale, translate(_catalog, key) { return String(key); }, error(error) { return { message: String(error?.message || error), detail: String(error?.stack || ""), code: error?.code, status: error?.status }; } },
      ui: {
        panel: null,
        preparePanel() {},
        async openPanel(request) { emit("log", "Panel preview: " + request.title); return { status: "cancelled" }; },
        setPanelState(state) { mockPanel.dirty = Boolean(state.dirty); mockPanel.busy = Boolean(state.busy); },
        requestClose() { mockPanel.dirty = false; mockPanel.busy = false; },
        completePanel(result) { emit("log", "Panel preview completed: " + result.status); }
      }
    };
    for (const method of ["log", "info", "warn", "error", "debug"]) {
      const original = console[method].bind(console);
      console[method] = (...args) => { original(...args); emit("log", args.map(formatLogPart).join(" ")); };
    }
    window.addEventListener("error", (event) => { initialRuntimeError = true; emit("error", event.message || "Plugin runtime error"); });
    window.addEventListener("unhandledrejection", (event) => { initialRuntimeError = true; emit("error", event.reason?.message || event.reason || "Unhandled plugin rejection"); });
    try {
      const sourceUrl = URL.createObjectURL(new Blob([payload.entryJs], { type: "text/javascript" }));
      const plugin = await import(sourceUrl);
      URL.revokeObjectURL(sourceUrl);
      if (typeof plugin.render !== "function") throw new Error("Export render(element, savia) from the plugin.");
      const cleanup = await plugin.render(document.getElementById("root"), savia);
      if (typeof cleanup === "function") window.addEventListener("pagehide", cleanup, { once: true });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (!initialRuntimeError) emit("ready", "Preview is ready.");
    } catch (error) {
      initialRuntimeError = true;
      document.getElementById("root").replaceChildren(Object.assign(document.createElement("pre"), { textContent: String(error?.stack || error) }));
      emit("error", error?.message || error);
    }
  </script>
</body>
</html>`;
}

function sanitizePreviewValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizePreviewValue);
  if (!value || typeof value !== "object") return value;
  const safe = Object.create(null) as Record<string, unknown>;
  for (const [key, nested] of Object.entries(value)) {
    if (
      ["__proto__", "prototype", "constructor"].includes(key) ||
      /(?:api[_-]?key|access[_-]?key|authorization|password|secret|token)/i.test(
        key,
      )
    )
      continue;
    safe[key] = sanitizePreviewValue(nested);
  }
  return safe;
}
