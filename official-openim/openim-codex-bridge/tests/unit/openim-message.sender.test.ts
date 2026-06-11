import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenImMessageSender } from "../../src/adapters/openim/openim-message.sender.js";
import type { AppConfig } from "../../src/config/env.js";

const config = {
  OPENIM_API_BASE_URL: "http://127.0.0.1:10002",
  OPENIM_BOT_USER_ID: "codex_bot"
} as AppConfig;

describe("OpenImMessageSender", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the actual runtime kind into bot reply metadata", async () => {
    const fetchImpl = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const sender = new OpenImMessageSender(config, {
      getAdminToken: async () => "admin-token"
    } as never);

    await sender.sendBotText({
      operationId: "job_1",
      recvId: "user_1",
      text: "hello",
      metadata: {
        jobId: "job_1",
        sessionRecordId: "csr_1",
        codexSessionId: null,
        runtimeKind: "template"
      }
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(JSON.parse(body.ex)).toMatchObject({
      agent: {
        generated_by: "codex",
        runtime: "template",
        job_id: "job_1",
        binding_id: "csr_1",
        codex_session_id: null
      }
    });
  });
});
