export interface CodexSessionRecord {
  id: string;
  openimConversationId: string;
  openimDisplayUserId: string;
  codexSessionId: string | null;
  codexProjectPath: string;
  codexHomeDir: string | null;
  codexHomeSeedMode: "copy-auth-only" | "copy-auth-and-config" | "none" | null;
  sandboxMode: string | null;
  displayName: string | null;
  displayNameSource: "auto" | "manual" | null;
  lastSummary: string | null;
  isActive: boolean;
  status: "active" | "paused" | "archived" | "error";
  parentSessionRecordId: string | null;
  forkedFromCodexSessionId: string | null;
  createdReason: string;
  createdAt: number;
  updatedAt: number;
}
