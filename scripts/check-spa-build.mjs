import { measureSpaBuild } from "./measure-spa-build.mjs";

const report = await measureSpaBuild(process.argv[2] ?? "apps/admin/dist");
// Downloadable installers are independently packaged artifacts, not SPA code.
const installerBytes = report.installers.bytes;
const checks = [
  ["SPA originals", report.originals.bytes - installerBytes, 85_000_000],
  [
    "My Day dependency payload (gzip)",
    report.authenticatedMyDay.gzipBytes,
    2_000_000,
  ],
  ["Boot dependency payload (gzip)", report.boot.gzipBytes, 1_500_000],
  ["Unused compression sidecars", report.sidecars.bytes, 0],
];
for (const [name, actual, maximum] of checks) {
  console.log(`${name}: ${actual} bytes (maximum ${maximum})`);
  if (actual > maximum) throw new Error(`${name} exceeds the build budget`);
}
if (
  report.authenticatedMyDay.assets.some((x) =>
    /plugin-editor-vendor.*\.js$|flows-ui\//.test(x.name),
  )
) {
  throw new Error("Optional editor/Flows code leaked into My Day startup");
}
