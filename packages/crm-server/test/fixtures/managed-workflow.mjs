import { WorkflowEntrypoint } from "cloudflare:workers";
export class ManagedProbe extends WorkflowEntrypoint {
  async run(event, step) {
    await step.do(
      "native-write",
      { retries: { limit: 1, delay: "1 second" } },
      async () => {
        await this.env.DB.prepare("UPDATE probe SET writes=writes+1").run();
        const row = await this.env.DB.prepare(
          "SELECT writes FROM probe",
        ).first();
        if (row.writes === 1)
          throw new Error(
            "Interruption after committed write, before step receipt",
          );
        return row.writes;
      },
    );
    await step.waitForEvent("resume", { type: "resume", timeout: "1 minute" });
    return "resumed";
  }
}
export default {
  fetch() {
    return new Response("probe");
  },
};
