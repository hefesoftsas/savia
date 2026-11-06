import type { QuickJSWASMModule } from "quickjs-emscripten-core";
import {
  GUEST_MEMORY_BYTES,
  GUEST_STACK_BYTES,
  MAX_INTERRUPTS,
} from "./limits";

/** Only the Wasm engine may be reused. Each caller owns a fresh guest heap. */
export function createGuest(
  engine: QuickJSWASMModule,
  options: { maxInterrupts?: number; interrupted?: () => boolean } = {},
) {
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(GUEST_MEMORY_BYTES);
  runtime.setMaxStackSize(GUEST_STACK_BYTES);
  let interrupts = 0;
  runtime.setInterruptHandler(
    () =>
      ++interrupts > (options.maxInterrupts ?? MAX_INTERRUPTS) ||
      !!options.interrupted?.(),
  );
  return { runtime, context: runtime.newContext() };
}
