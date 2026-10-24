import { guardStorageEnvironment } from "../../packages/backup-gate/index.mjs";
import { runCleanup } from "./cleanup.mjs";

const MAX_BATCHES_PER_TARGET = 50;

export default {
  async fetch() {
    return new Response("Not Found", { status: 404 });
  },

  scheduled(_controller, env, context) {
    const requiredBindings = [
      "AGENCY_PRODUCTION",
      "AGENCY_PREVIEW",
      "AGENCY_BRANCH",
      "SECOP",
      "SECOP_VALIDATION",
      "PRODUCTION_BACKUP_GATE",
      "PREVIEW_BACKUP_GATE",
    ];
    const missingBindings = requiredBindings.filter(
      (name) => env[name] == null,
    );
    if (missingBindings.length > 0) {
      throw new Error(
        `Missing required bindings: ${missingBindings.join(", ")}`,
      );
    }

    const guardedDatabase = (gate, database) =>
      guardStorageEnvironment({
        BACKUP_GATE: gate,
        SAVIA_BACKUP_GATE_REQUIRED: "true",
        DB: database,
      }).DB;
    const productionGate = env.PRODUCTION_BACKUP_GATE;
    const previewGate = env.PREVIEW_BACKUP_GATE;

    context.waitUntil(
      runCleanup(
        {
          agencyProduction: guardedDatabase(
            productionGate,
            env.AGENCY_PRODUCTION,
          ),
          agencyPreview: guardedDatabase(previewGate, env.AGENCY_PREVIEW),
          agencyBranch: guardedDatabase(previewGate, env.AGENCY_BRANCH),
          secop: guardedDatabase(productionGate, env.SECOP),
          secopValidation: guardedDatabase(previewGate, env.SECOP_VALIDATION),
        },
        { maxBatches: MAX_BATCHES_PER_TARGET },
      ).then(
        (result) => {
          const summary = Object.fromEntries(
            Object.entries(result.targets).map(([target, tables]) => [
              target,
              Object.fromEntries(
                Object.entries(tables).map(([table, counts]) => [
                  table,
                  {
                    deleted: counts.deleted,
                    remaining: counts.remaining,
                    ...(counts.invalidVersionGroups === undefined
                      ? {}
                      : { invalidVersionGroups: counts.invalidVersionGroups }),
                  },
                ]),
              ),
            ]),
          );
          console.log("CLEANUP_SUMMARY", JSON.stringify(summary));
          const incomplete = Object.values(result.targets).some((tables) =>
            Object.values(tables).some(
              (counts) => counts.remaining || counts.invalidVersionGroups > 0,
            ),
          );
          if (incomplete) {
            throw new Error(
              "Cleanup has remaining rows or invalid plugin versions",
            );
          }
        },
        (error) => {
          console.error("CLEANUP_FAILED", error?.name ?? "Error");
          throw error;
        },
      ),
    );
  },
};
