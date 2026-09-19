// Isolated, loopback-only browser verification fixture. Never a production entrypoint.
import { createCrmApp } from "../../src/index";
import { makeConfig } from "@savia/crm-shared/metadata";
import { processWorkflows } from "../../src/workflows/runtime";
const app = createCrmApp("domain:workflow-preview", {
  principalId: "preview-user",
  seedObjects: [],
  authorizeWorkflow: async () => true,
});
export default {
  async fetch(request: Request, env: any) {
    if (new URL(request.url).hostname !== "127.0.0.1")
      return new Response("Loopback only", { status: 403 });
    let response: Response;
    if (request.method === "OPTIONS")
      response = new Response(null, { status: 204 });
    else if (new URL(request.url).pathname === "/preview/setup") {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO crm_objects(tenant_id,name,label,config) VALUES (?,?,?,?)",
      )
        .bind(
          "domain:workflow-preview",
          "requests",
          "Solicitudes",
          JSON.stringify(
            makeConfig({
              title: { type: "Textbox", label: "Título" },
              amount: { type: "Number", label: "Importe" },
              status: { type: "Textbox", label: "Estado" },
            }),
          ),
        )
        .run();
      response = Response.json({ ready: true });
    } else if (new URL(request.url).pathname === "/preview/tick") {
      await processWorkflows(env.DB, async () => true);
      response = Response.json({ ready: true });
    } else response = await app.fetch(request, env);
    const result = new Response(response.body, response);
    result.headers.set("Access-Control-Allow-Origin", "http://127.0.0.1:5189");
    result.headers.set("Access-Control-Allow-Headers", "Content-Type");
    result.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
    return result;
  },
};
