import type { AppConfig } from "../../config/env.js";
import type { OpenImAuthClient } from "./openim-auth.client.js";

export interface SendBotTextInput {
  operationId: string;
  recvId: string;
  text: string;
  metadata: {
    jobId: string;
    sessionRecordId: string;
    codexSessionId: string | null;
  };
}

export class OpenImMessageSender {
  constructor(
    private readonly config: AppConfig,
    private readonly authClient: OpenImAuthClient
  ) {}

  async sendBotText(input: SendBotTextInput): Promise<void> {
    const token = await this.authClient.getAdminToken(input.operationId);
    const response = await fetch(`${this.config.OPENIM_API_BASE_URL}/msg/send_msg`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        operationID: input.operationId,
        token
      },
      body: JSON.stringify({
        operationID: input.operationId,
        sendID: this.config.OPENIM_BOT_USER_ID,
        recvID: input.recvId,
        contentType: 101,
        sessionType: 1,
        content: { content: input.text },
        ex: JSON.stringify({
          agent: {
            generated_by: "codex",
            runtime: "codex_cli",
            job_id: input.metadata.jobId,
            binding_id: input.metadata.sessionRecordId,
            codex_session_id: input.metadata.codexSessionId
          }
        })
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenIM send_msg failed: HTTP ${response.status} ${body}`);
    }
  }
}

