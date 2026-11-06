export function interpolate(
  template: string,
  variables: Record<string, string>,
): string {
  if (template.length > 10000)
    throw Error("La plantilla supera 10.000 caracteres.");
  return template.replace(
    /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
    (_, key: string) => {
      if (
        ["__proto__", "constructor", "prototype"].includes(key) ||
        !Object.hasOwn(variables, key)
      )
        throw Error(`Completa la variable ${key}.`);
      return variables[key];
    },
  );
}
export function templateVariables(template: string): string[] {
  return [
    ...new Set(
      [...template.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)].map(
        (match) => match[1],
      ),
    ),
  ];
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function renderDocument(
  title: string,
  template: string,
  variables: Record<string, string>,
): string {
  const body = interpolate(template, variables);
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>body{font:16px/1.6 system-ui;color:#172624;max-width:760px;margin:48px auto;padding:24px}h1{font-size:28px}main{white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{margin:0}}</style><h1>${escape(title)}</h1><main>${escape(body)}</main></html>`;
}
