import { makeConfig, stageOptions, type CrmObject } from "./metadata";
const name = { type: "Textbox", label: "Nombre", required: true };
const relation = (label: string, object: string) => ({
  type: "Dropdown",
  label,
  options: [],
  config: { relation: object },
});
export const seedObjects: CrmObject[] = [
  {
    name: "account",
    label: "Empresas",
    description: "Las organizaciones con las que creces.",
    config: makeConfig({
      name,
      industry: {
        type: "Dropdown",
        label: "Sector",
        options: ["Tecnología", "Energía", "Servicios", "Retail", "Salud"].map(
          (value) => ({ value, label: value }),
        ),
      },
      email: { type: "Textbox", label: "Correo", config: { format: "email" } },
      city: { type: "Textbox", label: "Ciudad" },
    }),
  },
  {
    name: "contact",
    label: "Contactos",
    description: "Cada relación empieza con una conversación.",
    config: makeConfig({
      name,
      email: {
        type: "Textbox",
        label: "Correo",
        required: true,
        config: { format: "email" },
      },
      account: relation("Empresa", "account"),
      phone: { type: "Textbox", label: "Teléfono" },
      role: { type: "Textbox", label: "Cargo" },
    }),
  },
  {
    name: "opportunity",
    label: "Oportunidades",
    description: "Convierte las buenas conversaciones en nuevos negocios.",
    config: makeConfig({
      name,
      account: relation("Empresa", "account"),
      amount: {
        type: "Number",
        label: "Valor estimado",
        required: true,
        config: { format: "currency" },
      },
      stage: {
        type: "Dropdown",
        label: "Etapa",
        required: true,
        options: stageOptions,
      },
      close_date: { type: "DateControl", label: "Cierre estimado" },
      owner: { type: "Textbox", label: "Responsable" },
      notes: { type: "Textarea", label: "Notas" },
    }),
  },
  {
    name: "task",
    label: "Tareas",
    description: "El siguiente paso, siempre claro.",
    config: makeConfig({
      name,
      due_date: { type: "DateControl", label: "Fecha límite" },
      done: { type: "Toggle", label: "Completada" },
      opportunity: relation("Oportunidad", "opportunity"),
      notes: { type: "Textarea", label: "Notas" },
    }),
  },
  {
    name: "activity",
    label: "Actividades",
    description: "El historial de tus conversaciones.",
    config: makeConfig({
      name,
      type: {
        type: "Dropdown",
        label: "Tipo",
        options: ["Llamada", "Reunión", "Nota", "Correo"].map((value) => ({
          value,
          label: value,
        })),
      },
      contact: relation("Contacto", "contact"),
      date: { type: "DateControl", label: "Fecha" },
      notes: { type: "Textarea", label: "Detalle" },
    }),
  },
];
export const seedRecords: {
  id: string;
  object: string;
  data: Record<string, unknown>;
}[] = [
  ...[
    ["a1", "Helios Energy", "Energía", "Bogotá"],
    ["a2", "Nómada Studio", "Tecnología", "Medellín"],
    ["a3", "Clínica Horizonte", "Salud", "Cali"],
    ["a4", "Origen Foods", "Retail", "Bogotá"],
    ["a5", "Vértice Digital", "Tecnología", "Barranquilla"],
    ["a6", "Casa Botánica", "Retail", "Medellín"],
  ].map(([id, name, industry, city]) => ({
    id,
    object: "account",
    data: { name, industry, city },
  })),
  ...[
    [
      "c1",
      "Valentina Ríos",
      "valentina@example.com",
      "a1",
      "Directora comercial",
    ],
    ["c2", "Santiago Mora", "santiago@example.com", "a2", "Fundador"],
    [
      "c3",
      "Isabela Torres",
      "isabela@example.com",
      "a3",
      "Gerente de operaciones",
    ],
  ].map(([id, name, email, account, role]) => ({
    id,
    object: "contact",
    data: { name, email, account, role },
  })),
  ...[
    [
      "o1",
      "Expansión solar · fase II",
      "a1",
      48000000,
      "Propuesta",
      "2026-09-25",
      "Valentina Ríos",
    ],
    [
      "o2",
      "Plataforma de clientes",
      "a2",
      24500000,
      "Negociación",
      "2026-09-18",
      "Santiago Mora",
    ],
    [
      "o3",
      "Renovación de cobertura",
      "a3",
      32000000,
      "Calificado",
      "2026-10-02",
      "Isabela Torres",
    ],
    [
      "o4",
      "Operación regional",
      "a4",
      18500000,
      "Prospecto",
      "2026-10-12",
      "Valentina Ríos",
    ],
    [
      "o5",
      "Equipo de crecimiento",
      "a5",
      42000000,
      "Propuesta",
      "2026-09-28",
      "Santiago Mora",
    ],
    [
      "o6",
      "Nueva línea de negocio",
      "a6",
      12000000,
      "Prospecto",
      "2026-10-20",
      "Isabela Torres",
    ],
    [
      "o7",
      "Consultoría de procesos",
      "a2",
      15000000,
      "Ganada",
      "2026-09-03",
      "Valentina Ríos",
    ],
    [
      "o8",
      "Plan de bienestar",
      "a3",
      27000000,
      "Negociación",
      "2026-09-21",
      "Isabela Torres",
    ],
  ].map(([id, name, account, amount, stage, close_date, owner]) => ({
    id: String(id),
    object: "opportunity",
    data: { name, account, amount, stage, close_date, owner },
  })),
  {
    id: "t1",
    object: "task",
    data: {
      name: "Enviar propuesta a Helios",
      due_date: "2026-09-10",
      done: false,
      opportunity: "o1",
    },
  },
  {
    id: "t2",
    object: "task",
    data: {
      name: "Agendar demo con Nómada",
      due_date: "2026-09-12",
      done: false,
      opportunity: "o2",
    },
  },
  {
    id: "act1",
    object: "activity",
    data: {
      name: "Reunión de descubrimiento",
      type: "Reunión",
      contact: "c1",
      date: "2026-09-06",
      notes: "Interés en ampliar la operación durante el próximo trimestre.",
    },
  },
];
export const exampleOpenApi = {
  openapi: "3.1.0",
  info: { title: "Cotizador de proyectos · demo", version: "1.0.0" },
  paths: {
    "/demo/quotes": {
      post: {
        operationId: "createQuote",
        summary: "Calcular cotización de demostración",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Quote" },
            },
          },
        },
        responses: { "200": { description: "Cotización calculada" } },
      },
    },
  },
  components: {
    schemas: {
      Quote: {
        type: "object",
        title: "Cotizaciones",
        required: ["name", "seats"],
        properties: {
          name: { type: "string", title: "Nombre del proyecto" },
          email: {
            type: "string",
            format: "email",
            title: "Correo de contacto",
          },
          seats: { type: "number", title: "Número de licencias" },
          plan: {
            type: "string",
            title: "Plan",
            enum: ["Esencial", "Profesional"],
          },
        },
      },
    },
  },
};
