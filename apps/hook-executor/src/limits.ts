// Cloudflare enforces CPU time; the guest counters are supplementary safeguards.
export const CPU_LIMIT_MS = 30_000;
export const MAX_INPUT_BYTES = 16 * 1024 * 1024;
export const MAX_CODE_BYTES = 256 * 1024;
export const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
export const GUEST_MEMORY_BYTES = 16 * 1024 * 1024;
export const GUEST_STACK_BYTES = 256 * 1024;
export const MAX_INTERRUPTS = 1_000_000;
export const MAX_PENDING_JOBS = 1_000_000;
