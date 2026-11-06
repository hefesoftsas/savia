import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

let hasCompose = false;
try {
  execFileSync("docker", ["compose", "version"], { stdio: "ignore" });
  hasCompose = true;
} catch {}

describe.skipIf(!hasCompose)("local Pages search Compose override", () => {
  it.each([false, true])(
    "merges local services without dropping existing storage dependencies (PostgreSQL=%s)",
    (postgres) => {
      const files = [
        "docker-compose.self-hosted.yml",
        ...(postgres ? ["docker-compose.self-hosted.postgres.yml"] : []),
        "docker-compose.self-hosted.search.yml",
      ];
      const output = execFileSync(
        "docker",
        [
          "compose",
          "--env-file",
          "/dev/null",
          ...files.flatMap((file) => ["-f", file]),
          "config",
          "--format",
          "json",
        ],
        {
          cwd: resolve(import.meta.dirname, "../../.."),
          env: {
            ...process.env,
            SAVIA_ENV_FILE: "/dev/null",
            POSTGRES_PASSWORD: "compose-fixture-password",
          },
          encoding: "utf8",
        },
      );
      const { services, volumes } = JSON.parse(output);
      expect(services.savia.environment).toMatchObject({
        SAVIA_PAGES_SEARCH_ENABLED: "true",
        SAVIA_PAGES_OLLAMA_URL: "http://ollama:11434",
        SAVIA_PAGES_QDRANT_URL: "http://qdrant:6333",
      });
      expect(services.savia.depends_on).toMatchObject({
        "storage-init": { condition: "service_completed_successfully" },
        "pages-model-init": { condition: "service_completed_successfully" },
        qdrant: { condition: "service_started" },
      });
      expect(services.ollama.ports).toBeUndefined();
      expect(services.qdrant.ports).toBeUndefined();
      expect(services["pages-model-init"].command).toEqual(["pull", "bge-m3"]);
      expect(volumes).toHaveProperty("pages-models");
      expect(volumes).toHaveProperty("pages-vectors");
      if (postgres) {
        expect(services.savia.environment.SAVIA_DATABASE_DRIVER).toBe(
          "postgres",
        );
        expect(services.savia.depends_on.postgres.condition).toBe(
          "service_healthy",
        );
      }
    },
  );
});
