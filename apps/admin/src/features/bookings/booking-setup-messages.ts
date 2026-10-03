import type { MessageCatalog } from "@/i18n/core";
export const bookingSetupMessages = {
  Details: ["Datos de la agenda", "Details", "Dados da agenda"],
  Team: ["Equipo", "Team", "Equipe"],
  Hours: ["Horarios", "Hours", "Horários"],
  "Review and publish": [
    "Revisar y publicar",
    "Review and publish",
    "Revisar e publicar",
  ],
  "Step %{current} of %{total}": [
    "Paso %{current} de %{total}",
    "Step %{current} of %{total}",
    "Etapa %{current} de %{total}",
  ],
  "Introduce your booking page.": [
    "Así verán tus clientes la agenda. Puedes cambiar estos datos después.",
    "Introduce your booking page. You can change these details later.",
    "Apresente sua agenda. Você pode alterar estes dados depois.",
  ],
  "Choose who takes appointments.": [
    "Elige quién atiende las citas. Cada persona tendrá su propio horario.",
    "Choose who takes appointments. Each person has their own schedule.",
    "Escolha quem atende. Cada pessoa tem seu próprio horário.",
  ],
  "Define what your customers can book.": [
    "Define qué pueden reservar tus clientes y quién puede atender cada servicio.",
    "Define what your customers can book and who delivers each service.",
    "Defina o que seus clientes podem agendar e quem atende cada serviço.",
  ],
  "Set the team's weekly schedule.": [
    "Configura el horario semanal de cada profesional en la zona horaria de la agenda.",
    "Set each professional's weekly schedule in the booking time zone.",
    "Configure os horários semanais de cada profissional no fuso da agenda.",
  ],
  "Check your setup before sharing it.": [
    "Revisa tu configuración antes de compartir la agenda con tus clientes.",
    "Check your setup before sharing it with customers.",
    "Revise sua configuração antes de compartilhar com clientes.",
  ],
  Continue: ["Continuar", "Continue", "Continuar"],
  Back: ["Atrás", "Back", "Voltar"],
  "Save draft": ["Guardar borrador", "Save draft", "Salvar rascunho"],
  "Discard changes": [
    "Descartar cambios",
    "Discard changes",
    "Descartar alterações",
  ],
  "Remove service": ["Eliminar servicio", "Remove service", "Remover serviço"],
  "Remove professional": [
    "Quitar profesional",
    "Remove professional",
    "Remover profissional",
  ],
  "Changes take effect when saved. Existing reservations keep their history.": [
    "Los cambios se aplican al guardar. Las reservas existentes conservan su historial.",
    "Changes take effect when saved. Existing reservations keep their history.",
    "As alterações são aplicadas ao salvar. Reservas existentes mantêm o histórico.",
  ],
  "No professionals yet.": [
    "Todavía no hay profesionales. Añade una persona de tu organización para empezar.",
    "No professionals yet. Add someone from your organization to start.",
    "Ainda não há profissionais. Adicione alguém da organização para começar.",
  ],
  "No eligible members. Add an active user to this organization first.": [
    "No hay usuarios disponibles. Primero añade un usuario activo a esta organización.",
    "No eligible members. Add an active user to this organization first.",
    "Não há usuários disponíveis. Adicione um usuário ativo à organização primeiro.",
  ],
  "No services yet.": [
    "Todavía no hay servicios. Añade el primero para que tus clientes puedan reservar.",
    "No services yet. Add your first service so customers can book.",
    "Ainda não há serviços. Adicione o primeiro para que clientes possam agendar.",
  ],
  "Add your team before assigning services.": [
    "Añade tu equipo antes de asignar servicios.",
    "Add your team before assigning services.",
    "Adicione sua equipe antes de atribuir serviços.",
  ],
  "Booking rules": [
    "Reglas de reserva",
    "Booking rules",
    "Regras de agendamento",
  ],
  "Enter a public title.": [
    "Escribe un título para tu agenda.",
    "Enter a public title.",
    "Digite um título para sua agenda.",
  ],
  "Enter valid booking rules.": [
    "Revisa las reglas: el plazo máximo debe ser de 1 a 180 días y los minutos de 0 a 43200.",
    "Enter valid booking rules: horizon 1–180 days, other timings 0–43200 minutes.",
    "Revise as regras: horizonte de 1 a 180 dias, demais tempos de 0 a 43200 minutos.",
  ],
  "Select a member for each professional.": [
    "Selecciona un usuario de la organización para cada profesional.",
    "Select a member for each professional.",
    "Selecione um usuário da organização para cada profissional.",
  ],
  "Name each service and use valid durations.": [
    "Pon nombre a cada servicio. La duración debe ser de 5 a 480 minutos y la pausa de 0 a 120, en intervalos de 5 minutos.",
    "Name each service. Duration must be 5–480 minutes and buffer 0–120, in five-minute increments.",
    "Nomeie cada serviço. Duração de 5 a 480 minutos e intervalo de 0 a 120, em incrementos de cinco minutos.",
  ],
  "Check weekly hours. Use five-minute increments and non-overlapping periods.":
    [
      "Revisa los horarios. Usa intervalos de cinco minutos, con el fin después del inicio y sin superposiciones.",
      "Check weekly hours. Use five-minute increments, end after start, and non-overlapping periods.",
      "Revise os horários. Use incrementos de cinco minutos, término após início e períodos sem sobreposição.",
    ],
  Closed: ["Sin atención", "Closed", "Fechado"],
  Edit: ["Editar", "Edit", "Editar"],
  "Publishing makes your booking link available to customers.": [
    "Al publicar, tus clientes podrán reservar desde el enlace público. Guardar borrador despublica la agenda.",
    "Publishing makes your booking link available to customers. Saving a draft unpublishes it.",
    "Publicar disponibiliza o link aos clientes. Salvar um rascunho retira a publicação.",
  ],
  "Save and publish": [
    "Guardar y publicar",
    "Save and publish",
    "Salvar e publicar",
  ],
  Unpublished: ["Sin publicar", "Unpublished", "Não publicado"],
  "Date exceptions can be managed in Availability after saving.": [
    "Puedes gestionar vacaciones y excepciones por fecha en Disponibilidad después de guardar.",
    "Date exceptions can be managed in Availability after saving.",
    "Você pode gerenciar férias e exceções por data em Disponibilidade após salvar.",
  ],
  "No weekly hours": [
    "Sin horario semanal",
    "No weekly hours",
    "Sem horário semanal",
  ],
} as const satisfies MessageCatalog;
