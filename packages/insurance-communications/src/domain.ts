export function renderTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, key: string) => {
    if (!(key in variables)) throw new Error(`Falta la variable ${key}.`);
    return variables[key];
  });
}
export const stateLabels: Record<string, string> = {
  accepted: "Aceptado por el proveedor; entrega pendiente",
  delivered: "Entrega confirmada",
  failed: "Entrega fallida",
  pending: "Pendiente de confirmación",
};
export function newMessage() {
  return {
    recipient: "",
    name: "",
    template: "Hola {{nombre}}, te contactamos sobre tu solicitud.",
    consent: false,
    suppressed: false,
    metadata: {} as Record<string, unknown>,
  };
}
