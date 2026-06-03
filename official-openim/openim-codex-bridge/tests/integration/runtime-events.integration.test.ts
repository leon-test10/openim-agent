import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/storage/db.js";
import { RuntimeEventRepository } from "../../src/core/runtime-event.repository.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "openim-codex-runtime-events-"));
  tempDirs.push(dir);
  return openDatabase(`file:${join(dir, "bridge.sqlite")}`);
}

describe("runtime event repository", () => {
  it("persists normalized Codex JSONL events in sequence order", () => {
    const db = createTempDb();
    const events = new RuntimeEventRepository(db);

    const first = events.recordCodexJsonEvent({
      jobId: "job_1",
      sessionRecordId: "csr_1",
      openimConversationId: "single:codex_bot:user_1",
      eventType: "thread.started",
      rawEvent: { type: "thread.started", session_id: "thread_1" }
    });
    const second = events.recordCodexJsonEvent({
      jobId: "job_1",
      sessionRecordId: "csr_1",
      openimConversationId: "single:codex_bot:user_1",
      eventType: "tool.call",
      rawEvent: { type: "tool.call", name: "shell", command: "git status --short" }
    });

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(events.listByJobId("job_1")).toMatchObject([
      {
        id: first.id,
        jobId: "job_1",
        sequence: 1,
        eventType: "thread.started",
        title: "thread.started",
        rawEvent: { type: "thread.started", session_id: "thread_1" }
      },
      {
        id: second.id,
        jobId: "job_1",
        sequence: 2,
        eventType: "tool.call",
        title: "tool.call",
        rawEvent: { type: "tool.call", name: "shell", command: "git status --short" }
      }
    ]);
    expect(events.listByJobIdAfter("job_1", 1)).toMatchObject([{ id: second.id, sequence: 2 }]);

    db.close();
  });
});
