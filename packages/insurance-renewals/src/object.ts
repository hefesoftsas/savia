import type { ExtensionObjectRequirement } from "@savia/crm-shared/extension-package";
export const requirement = {
  id: "insurance.renewals",
  object: {
    name: "insurance_renewals",
    label: "Renovaciones",
    description:
      "Vencimientos, negociación y cierre de renovaciones de pólizas.",
    config: {
      version: 2,
      fields: {
        name: {
          type: "Textbox",
          label: "Referencia",
          labels: {},
          required: true,
          config: {
            maxLength: 120,
          },
        },
        customer: {
          type: "Textbox",
          label: "Cliente",
          labels: {},
          required: true,
          config: {
            maxLength: 200,
          },
        },
        policy_reference: {
          type: "Textbox",
          label: "Póliza actual",
          labels: {},
          required: true,
          config: {
            maxLength: 120,
          },
        },
        insurer: {
          type: "Textbox",
          label: "Aseguradora",
          labels: {},
          config: {
            maxLength: 200,
          },
        },
        owner: {
          type: "Textbox",
          label: "Responsable",
          labels: {},
          config: {
            maxLength: 120,
          },
        },
        expiry_date: {
          type: "DateControl",
          label: "Vencimiento",
          labels: {},
          required: true,
        },
        premium: {
          type: "Number",
          label: "Prima",
          labels: {},
          required: true,
          config: {
            minimum: 0,
            maximum: 90000000000,
          },
        },
        stage: {
          type: "Dropdown",
          label: "Etapa",
          labels: {},
          required: true,
          options: [
            {
              value: "pending",
              label: "Por contactar",
            },
            {
              value: "contacted",
              label: "Contactado",
            },
            {
              value: "negotiation",
              label: "En negociación",
            },
            {
              value: "documents",
              label: "Documentación",
            },
            {
              value: "issuance",
              label: "En expedición",
            },
            {
              value: "renewed",
              label: "Renovada",
            },
            {
              value: "lost",
              label: "No renovada",
            },
          ],
        },
        next_follow_up: {
          type: "DateControl",
          label: "Próximo seguimiento",
          labels: {},
        },
        outcome: {
          type: "Textbox",
          label: "Nueva póliza o motivo de cierre",
          labels: {},
          config: {
            maxLength: 500,
            requiredWhen: {
              field: "stage",
              op: "in",
              value: ["renewed", "lost"],
            },
          },
        },
        notes: {
          type: "Textarea",
          label: "Notas de gestión",
          labels: {},
          config: {
            maxLength: 10000,
          },
        },
      },
      fieldOrder: [
        "name",
        "customer",
        "policy_reference",
        "insurer",
        "owner",
        "expiry_date",
        "premium",
        "stage",
        "next_follow_up",
        "outcome",
        "notes",
      ],
    },
  },
  requiredFields: {
    name: {
      types: ["Textbox"],
      required: true,
    },
    customer: {
      types: ["Textbox"],
      required: true,
    },
    policy_reference: {
      types: ["Textbox"],
      required: true,
    },
    insurer: {
      types: ["Textbox"],
    },
    owner: {
      types: ["Textbox"],
    },
    expiry_date: {
      types: ["DateControl"],
      required: true,
    },
    premium: {
      types: ["Number"],
      required: true,
    },
    stage: {
      types: ["Dropdown"],
      required: true,
      optionValues: [
        "pending",
        "contacted",
        "negotiation",
        "documents",
        "issuance",
        "renewed",
        "lost",
      ],
    },
    next_follow_up: {
      types: ["DateControl"],
    },
    outcome: {
      types: ["Textbox"],
    },
    notes: {
      types: ["Textarea"],
    },
  },
} satisfies ExtensionObjectRequirement;
