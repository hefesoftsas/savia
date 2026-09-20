import type { PluginMessages } from "@savia/crm-shared/plugin-localization";
export const integrationMessages = {
  "Importa recaudos, revisa coincidencias y asigna importes parciales. Cada diferencia conserva su trazabilidad.": [
    "Importa recaudos, revisa coincidencias y asigna importes parciales. Cada diferencia conserva su trazabilidad.",
    "Import receipts, review matches and allocate partial amounts. Every difference remains traceable.",
    "Importe recebimentos, revise correspondências e aloque valores parciais. Cada diferença mantém sua rastreabilidade."
  ],
  "Actualizar datos": [
    "Actualizar datos",
    "Refresh data",
    "Atualizar dados"
  ],
  "Acceso de administración. Las asignaciones se guardan en un registro conjunto con control de versión; no modifican el saldo de origen ni ejecutan pagos bancarios.": [
    "Acceso de administración. Las asignaciones se guardan en un registro conjunto con control de versión; no modifican el saldo de origen ni ejecutan pagos bancarios.",
    "Administrator access. Allocations are saved in a shared version-controlled record; they do not change the source balance or execute bank payments.",
    "Acesso administrativo. As alocações são salvas em um registro conjunto com controle de versão; não alteram o saldo de origem nem executam pagamentos bancários."
  ],
  "Procesando…": [
    "Procesando…",
    "Processing…",
    "Processando…"
  ],
  "Importar extracto": [
    "Importar extracto",
    "Import statement",
    "Importar extrato"
  ],
  "CSV de recaudos positivos: id,date,reference,amount. Fecha AAAA-MM-DD, punto decimal y un identificador bancario estable por movimiento. Máximo 200 movimientos acumulados.": [
    "CSV de recaudos positivos: id,date,reference,amount. Fecha AAAA-MM-DD, punto decimal y un identificador bancario estable por movimiento. Máximo 200 movimientos acumulados.",
    "CSV of positive receipts: id,date,reference,amount. Date YYYY-MM-DD, decimal point and a stable bank identifier per transaction. Maximum 200 accumulated transactions.",
    "CSV de recebimentos positivos: id,date,reference,amount. Data AAAA-MM-DD, ponto decimal e um identificador bancário estável por movimento. Máximo de 200 movimentos acumulados."
  ],
  "Cuenta bancaria": [
    "Cuenta bancaria",
    "Bank account",
    "Conta bancária"
  ],
  "Archivo CSV": [
    "Archivo CSV",
    "CSV file",
    "Arquivo CSV"
  ],
  "Contenido del extracto": [
    "Contenido del extracto",
    "Statement content",
    "Conteúdo do extrato"
  ],
  "Validar y previsualizar": [
    "Validar y previsualizar",
    "Validate and preview",
    "Validar e pré-visualizar"
  ],
  "Movimiento": [
    "Movimiento",
    "Transaction",
    "Movimento"
  ],
  "Fecha": [
    "Fecha",
    "Date",
    "Data"
  ],
  "Referencia": [
    "Referencia",
    "Reference",
    "Referência"
  ],
  "Recaudo": [
    "Recaudo",
    "Receipt",
    "Recebimento"
  ],
  "Confirmar": [
    "Confirmar",
    "Confirm",
    "Confirmar"
  ],
  "movimientos": [
    "movimientos",
    "transactions",
    "movimentos"
  ],
  "Asignar recaudo": [
    "Asignar recaudo",
    "Allocate receipt",
    "Alocar recebimento"
  ],
  "Selecciona un movimiento": [
    "Selecciona un movimiento",
    "Select a transaction",
    "Selecione um movimento"
  ],
  "Obligación": [
    "Obligación",
    "Obligation",
    "Obrigação"
  ],
  "Selecciona una obligación": [
    "Selecciona una obligación",
    "Select an obligation",
    "Selecione uma obrigação"
  ],
  "· Coincide referencia": [
    "· Coincide referencia",
    "· Reference match",
    "· Referência correspondente"
  ],
  "Importe (COP)": [
    "Importe (COP)",
    "Amount (COP)",
    "Valor (COP)"
  ],
  "Guardar asignación": [
    "Guardar asignación",
    "Save allocation",
    "Salvar alocação"
  ],
  "Las coincidencias de referencia son sugerencias. El límite usa el saldo de origen actual menos todas las asignaciones locales.": [
    "Las coincidencias de referencia son sugerencias. El límite usa el saldo de origen actual menos todas las asignaciones locales.",
    "Reference matches are suggestions. The limit uses the current source balance minus all local allocations.",
    "As correspondências de referência são sugestões. O limite usa o saldo atual de origem menos todas as alocações locais."
  ],
  "Movimientos y diferencias": [
    "Movimientos y diferencias",
    "Transactions and differences",
    "Movimentos e diferenças"
  ],
  "Aún no hay movimientos. Importa un extracto para comenzar.": [
    "Aún no hay movimientos. Importa un extracto para comenzar.",
    "No transactions yet. Import a statement to get started.",
    "Ainda não há movimentos. Importe um extrato para começar."
  ],
  "Exportar conciliación": [
    "Exportar conciliación",
    "Export reconciliation",
    "Exportar conciliação"
  ],
  "Sin asignar": [
    "Sin asignar",
    "Unassigned",
    "Não atribuído"
  ],
  "Asignaciones": [
    "Asignaciones",
    "Allocations",
    "Alocações"
  ]
} as const satisfies PluginMessages;
