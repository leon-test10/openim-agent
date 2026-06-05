export type RuntimeProviderType = "openai" | "openai-compatible" | "oss-local";

export interface RuntimeProfile {
  id: string;
  name: string;
  providerType: RuntimeProviderType;
  model: string | null;
  sandboxMode: string | null;
  approvalPolicy: string | null;
  codexProfile: string | null;
  baseUrl: string | null;
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
  model?: string | null;
  sandboxMode?: string | null;
  approvalPolicy?: string | null;
  codexProfile?: string | null;
  baseUrl?: string | null;
  localProvider?: "lmstudio" | "ollama" | null;
  useOss?: boolean;
  apiKey?: string | null;
}

export type RuntimeProfileUpdate = Partial<RuntimeProfileInput>;
