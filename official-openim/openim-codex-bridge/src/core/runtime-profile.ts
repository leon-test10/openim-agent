export type RuntimeProviderType = "openai" | "openai-compatible" | "oss-local";
export type RuntimeProviderMode = "openai-responses" | "deepseek-via-responses-bridge" | "openai-chat-probe-only";

export interface RuntimeProfile {
  id: string;
  name: string;
  providerType: RuntimeProviderType;
  providerMode: RuntimeProviderMode | null;
  model: string | null;
  sandboxMode: string | null;
  approvalPolicy: string | null;
  codexProfile: string | null;
  baseUrl: string | null;
  bridgeBaseUrl: string | null;
  wireApi: string | null;
  authEnvKey: string | null;
  codexHomeOverride: string | null;
  localProvider: "lmstudio" | "ollama" | null;
  useOss: boolean;
  apiKeyMasked: string | null;
  status: "active" | "deleted";
  createdAt: number;
  updatedAt: number;
}

export interface RuntimeProfileSecret extends RuntimeProfile {
  apiKey: string | null;
}

export interface RuntimeProfileInput {
  name: string;
  providerType?: RuntimeProviderType;
  providerMode?: RuntimeProviderMode | null;
  model?: string | null;
  sandboxMode?: string | null;
  approvalPolicy?: string | null;
  codexProfile?: string | null;
  baseUrl?: string | null;
  bridgeBaseUrl?: string | null;
  wireApi?: string | null;
  authEnvKey?: string | null;
  codexHomeOverride?: string | null;
  localProvider?: "lmstudio" | "ollama" | null;
  useOss?: boolean;
  apiKey?: string | null;
}

export type RuntimeProfileUpdate = Partial<RuntimeProfileInput>;
