/** Monotonic identity for one asynchronous workflow execution attempt. */
export class ExecutionAttemptGuard {
  private generation = 0;

  begin(): number {
    this.generation++;
    return this.generation;
  }

  invalidate(): void {
    this.generation++;
  }

  isCurrent(attempt: number): boolean {
    return this.generation === attempt;
  }
}

/** Apply a request result only while the attempt that started it is current. */
export async function settleExecutionAttempt<T>(
  guard: ExecutionAttemptGuard,
  attempt: number,
  operation: Promise<T>,
  onSuccess: (value: T) => void,
  onFailure: (error: unknown) => void,
): Promise<void> {
  try {
    const value = await operation;
    if (guard.isCurrent(attempt)) onSuccess(value);
  } catch (error) {
    if (guard.isCurrent(attempt)) onFailure(error);
  }
}
