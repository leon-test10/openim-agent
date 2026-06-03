export interface CodexSessionRecord {
  id: string;
  openimConversationId: string;
  openimDisplayUserId: string;
  codexSessionId: string | null;
  codexProjectPath: string;
  isActive: boolean;
  status: "active" | "paused" | "archived" | "error";
  parentSessionRecordId: string | null;
  forkedFromCodexSessionId: string | null;
  createdReason: string;
  createdAt: number;
  updatedAt: number;
}

