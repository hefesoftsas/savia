import { createRoot } from "react-dom/client";
import { StoreContextProvider, memoryStore } from "ra-core";
import { ApiClient } from "@/api/api-client";
import { RecordingSessions } from "../../recording-sessions";
import "@/styles/globals.css";
const session = {
  id: "synthetic-session",
  name: "Planificación del próximo trimestre",
  createdAt: "2026-10-03T15:00:00Z",
  state: "ready",
  durationSeconds: 3600,
  chunks: [
    {
      source: "microphone",
      sequence: 0,
      startSeconds: 0,
      durationSeconds: 30,
      bytes: 4096,
    },
  ],
  job: {
    status: "complete",
    completedChunks: 120,
    totalChunks: 120,
    transcripts: {
      "microphone:0": {
        text: "Revisaremos la propuesta el viernes. El presupuesto está pendiente de aprobación.",
        source: "microphone",
        model: "synthetic",
        durationSeconds: 30,
      },
    },
    summary: {
      summary:
        "El equipo revisó las prioridades del próximo trimestre y acordó preparar una propuesta de alcance antes de aprobar el presupuesto.",
      decisions: ["Revisar la propuesta el viernes con todas las áreas."],
      actions: [
        {
          description: "Preparar la propuesta de alcance",
          owner: "Equipo de producto",
          dueDate: null,
        },
      ],
      openQuestions: ["¿Qué presupuesto estará disponible?"],
    },
  },
};
const api = new ApiClient({
  baseUrl: "https://synthetic.example",
  tokenSource: { getAccessToken: async () => null },
  fetcher: async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.includes("/chunks/")) return new Response("", { status: 404 });
    if (path.endsWith("/questions"))
      return Response.json({
        answer: "El presupuesto está pendiente de aprobación.",
        insufficientEvidence: false,
        partial: true,
        evidence: [
          {
            source: "microphone",
            sequence: 0,
            startSeconds: 0,
            durationSeconds: 30,
          },
        ],
      });
    return Response.json(
      path.endsWith("/synthetic-session")
        ? session
        : { sessions: [session], cursor: null },
    );
  },
});
createRoot(document.getElementById("root")!).render(
  <StoreContextProvider value={memoryStore({ locale: "es" })}>
    <div
      className="bg-background text-foreground"
      style={
        new URLSearchParams(location.search).has("narrow")
          ? { width: 390, maxWidth: "100%" }
          : undefined
      }
    >
      <p className="border-b px-6 py-2 text-sm text-muted-foreground">
        Datos sintéticos · Vista de diseño sin conexión a servicios
      </p>
      <RecordingSessions api={api} />
    </div>
  </StoreContextProvider>,
);
