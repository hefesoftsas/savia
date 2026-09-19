import type { ExtensionObjectRequirement } from "@savia/crm-shared/extension-package";
export const requirement = {
  id: "insurance.collections",
  object: {
    name: "insurance_receivables",
    label: "Cartera",
    description: "Cobros, saldos y seguimiento de cuentas por cobrar.",
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
          label: "Póliza",
          labels: {},
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
        due_date: {
          type: "DateControl",
          label: "Vencimiento",
          labels: {},
          required: true,
        },
        amount: {
          type: "Number",
          label: "Valor de la cuenta",
          labels: {},
          required: true,
          config: {
            minimum: 0.01,
            maximum: 90000000000,
          },
        },
        paid: {
          type: "Number",
          label: "Acumulado pagado",
          labels: {},
          required: true,
          config: {
            minimum: 0,
            maximum: 90000000000,
          },
        },
        last_payment_date: {
          type: "DateControl",
          label: "Último pago",
          labels: {},
        },
        stage: {
          type: "Dropdown",
          label: "Etapa",
          labels: {},
          required: true,
          options: [
            {
              value: "pending",
              label: "Por gestionar",
            },
            {
              value: "contacted",
              label: "Contactado",
            },
            {
              value: "promise",
              label: "Promesa de pago",
            },
            {
              value: "disputed",
              label: "En revisión",
            },
          ],
        },
        next_follow_up: {
          type: "DateControl",
          label: "Próximo seguimiento",
          labels: {},
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
        "due_date",
        "amount",
        "paid",
        "last_payment_date",
        "stage",
        "next_follow_up",
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
    },
    insurer: {
      types: ["Textbox"],
    },
    owner: {
      types: ["Textbox"],
    },
    due_date: {
      types: ["DateControl"],
      required: true,
    },
    amount: {
      types: ["Number"],
      required: true,
    },
    paid: {
      types: ["Number"],
      required: true,
    },
    last_payment_date: {
      types: ["DateControl"],
    },
    stage: {
      types: ["Dropdown"],
      required: true,
      optionValues: ["pending", "contacted", "promise", "disputed"],
    },
    next_follow_up: {
      types: ["DateControl"],
    },
    notes: {
      types: ["Textarea"],
    },
  },
} satisfies ExtensionObjectRequirement;
