import assert from "node:assert/strict";
import { test } from "node:test";
import { runWorkerTick, type WorkerTickDeps } from "../src/tick";

type Captured = { logs: Array<{ level: string; event: string; fields: Record<string, unknown> }> };

function makeDeps(overrides: Partial<WorkerTickDeps> = {}): WorkerTickDeps & Captured {
  const logs: Captured["logs"] = [];
  const base: WorkerTickDeps = {
    workerId: "test-worker",
    maybeRecordHeartbeat: async () => {},
    recoverStaleJobs: async () => 0,
    leaseJob: async () => null,
    runJob: async () => {},
    log: (level, event, fields = {}) => {
      logs.push({ level, event, fields });
    },
    serializeError: (error) => ({ errorMessage: error instanceof Error ? error.message : String(error) })
  };
  return Object.assign({ ...base, ...overrides }, { logs });
}

test("idle outcome when the queue is empty", async () => {
  const deps = makeDeps();
  assert.equal(await runWorkerTick(deps), "idle");
});

test("ran_job outcome dispatches the leased job", async () => {
  let ran = false;
  const deps = makeDeps({
    leaseJob: async () => ({ id: "j1" }) as never,
    runJob: async () => {
      ran = true;
    }
  });
  assert.equal(await runWorkerTick(deps), "ran_job");
  assert.equal(ran, true);
});

test("a transient DB error in recoverStaleJobs is caught, not fatal", async () => {
  let leased = false;
  const deps = makeDeps({
    recoverStaleJobs: async () => {
      throw new Error("connection terminated unexpectedly");
    },
    leaseJob: async () => {
      leased = true;
      return null;
    }
  });
  // The whole point: this must NOT throw out of the tick (that is what crashed
  // the worker and left it dead for two days).
  const outcome = await runWorkerTick(deps);
  assert.equal(outcome, "error");
  assert.equal(leased, false, "tick should bail before leasing when recovery throws");
  assert.ok(deps.logs.some((l) => l.event === "worker_tick_failed" && l.level === "error"));
});

test("a transient DB error in the heartbeat is caught, not fatal", async () => {
  const deps = makeDeps({
    maybeRecordHeartbeat: async () => {
      throw new Error("db blip during heartbeat");
    }
  });
  assert.equal(await runWorkerTick(deps), "error");
  assert.ok(deps.logs.some((l) => l.event === "worker_tick_failed"));
});

test("a job that throws does not crash the tick (runJob owns its own errors)", async () => {
  // runJob is expected to swallow job errors itself; if one leaks, the tick must
  // still catch it rather than propagate.
  const deps = makeDeps({
    leaseJob: async () => ({ id: "j2" }) as never,
    runJob: async () => {
      throw new Error("unexpected job leak");
    }
  });
  assert.equal(await runWorkerTick(deps), "error");
  assert.ok(deps.logs.some((l) => l.event === "worker_tick_failed"));
});
