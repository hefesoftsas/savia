import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../.github/workflows/deploy-cloudflare.yml", import.meta.url),
  "utf8",
);
assert.match(source, /workflow_dispatch:/);
assert.doesNotMatch(
  source,
  /workflow_run:|deploy_mode|reset_database|Reset Savia domain database|self-hosted/,
);
assert.match(source, /environment: production/);
assert.match(source, /needs: preview-check/);
assert.match(
  source,
  /deploy-preview\.yml\/runs\?head_sha=\$GITHUB_SHA&status=success/,
);
assert.match(source, /proof\.sha !== process\.env\.GITHUB_SHA/);
assert.match(
  source,
  /\.name == "Deploy preview" and \.conclusion == "success"/,
);
assert.match(source, /needs\.verify\.result == 'success'/);
console.log("Manual production promotion contract holds");
