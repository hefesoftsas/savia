import { describe, expect, it, vi } from "vitest";
import {
  ExecutionAttemptGuard,
  settleExecutionAttempt,
} from "./execution-attempt";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("execution attempt guard", () => {
  it("ignores an older request result after a newer execution starts", async () => {
    const guard = new ExecutionAttemptGuard();
    const oldRequest = deferred<string>();
    const oldSuccess = vi.fn();
    const oldFailure = vi.fn();
    const oldAttempt = guard.begin();
    const oldSettlement = settleExecutionAttempt(
      guard,
      oldAttempt,
      oldRequest.promise,
      oldSuccess,
      oldFailure,
    );

    guard.begin();
    oldRequest.resolve("old execution");
    await oldSettlement;

    expect(oldSuccess).not.toHaveBeenCalled();
    expect(oldFailure).not.toHaveBeenCalled();
  });

  it("ignores an older request error after a newer execution starts", async () => {
    const guard = new ExecutionAttemptGuard();
    const oldRequest = deferred<string>();
    const oldSuccess = vi.fn();
    const oldFailure = vi.fn();
    const oldAttempt = guard.begin();
    const oldSettlement = settleExecutionAttempt(
      guard,
      oldAttempt,
      oldRequest.promise,
      oldSuccess,
      oldFailure,
    );

    guard.begin();
    oldRequest.reject(new Error("old request failed"));
    await oldSettlement;

    expect(oldSuccess).not.toHaveBeenCalled();
    expect(oldFailure).not.toHaveBeenCalled();
  });

  it("settles the current execution result", async () => {
    const guard = new ExecutionAttemptGuard();
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const attempt = guard.begin();

    await settleExecutionAttempt(
      guard,
      attempt,
      Promise.resolve("current execution"),
      onSuccess,
      onFailure,
    );

    expect(onSuccess).toHaveBeenCalledWith("current execution");
    expect(onFailure).not.toHaveBeenCalled();
  });
});
