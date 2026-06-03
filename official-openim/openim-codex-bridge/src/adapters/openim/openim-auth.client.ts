import type { AppConfig } from "../../config/env.js";

export class OpenImAuthClient {
  private cachedToken: string | null = null;

  constructor(private readonly config: AppConfig) {}

  async getAdminToken(operationId: string): Promise<string> {
    if (this.config.OPENIM_ADMIN_TOKEN) {
      return this.config.OPENIM_ADMIN_TOKEN;
    }
    if (this.cachedToken) {
      return this.cachedToken;
    }
    if (!this.config.OPENIM_ADMIN_SECRET) {
      throw new Error("OPENIM_ADMIN_TOKEN or OPENIM_ADMIN_SECRET must be configured");
    }

    const response = await fetch(`${this.config.OPENIM_API_BASE_URL}/auth/get_admin_token`, {
      method: "POST",
      headers: { "content-type": "application/json", operationID: operationId },
      body: JSON.stringify({
        operationID: operationId,
        userID: this.config.OPENIM_ADMIN_USER_ID,
        secret: this.config.OPENIM_ADMIN_SECRET
      })
    });
    const body = (await response.json().catch(() => null)) as OpenImTokenResponse | null;
    if (!response.ok || !body?.data?.token) {
      throw new Error(`Failed to acquire OpenIM admin token: HTTP ${response.status}`);
    }

    this.cachedToken = body.data.token;
    return this.cachedToken;
  }
}

interface OpenImTokenResponse {
  data?: {
    token?: string;
  };
}
