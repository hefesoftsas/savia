import { start, call } from "./runtime.mjs";
// Intentionally isolated process; watchdog.mjs kills the entire process group.
const mf = await start("quickjs");
console.log("ready");
try {
  console.log(
    JSON.stringify(
      await call(mf, {
        code: '/^(a+)+$/.test("a".repeat(32)+"!")',
        payload: { body: "", values: {} },
      }),
    ),
  );
} finally {
  await mf.dispose();
}
