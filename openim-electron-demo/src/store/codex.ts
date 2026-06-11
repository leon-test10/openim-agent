import { create } from "zustand";

import {
  CodexBridgeMeta,
  CodexConversationStatus,
  CodexRuntimeEvent,
  CodexSessionRecord,
} from "@/types/codex";

interface CodexStateEntry {
  status: CodexConversationStatus | null;
  sessions: CodexSessionRecord[];
  eventsByJobId: Record<string, CodexRuntimeEvent[]>;
  loading: boolean;
  error: string | null;
  updatedAt: number | null;
}

interface CodexStore {
  conversations: Record<string, CodexStateEntry>;
  meta: CodexBridgeMeta | null;
  setLoading: (conversationID: string, loading: boolean) => void;
  setMeta: (meta: CodexBridgeMeta) => void;
  setStatus: (conversationID: string, status: CodexConversationStatus) => void;
  setSessions: (conversationID: string, sessions: CodexSessionRecord[]) => void;
  upsertSession: (conversationID: string, session: CodexSessionRecord) => void;
  activateSessionLocal: (conversationID: string, session: CodexSessionRecord) => void;
  setJobEvents: (
    conversationID: string,
    jobID: string,
    events: CodexRuntimeEvent[],
  ) => void;
  appendJobEvents: (
    conversationID: string,
    jobID: string,
    events: CodexRuntimeEvent[],
  ) => void;
  setError: (conversationID: string, error: string | null) => void;
}

const emptyEntry: CodexStateEntry = {
  status: null,
  sessions: [],
  eventsByJobId: {},
  loading: false,
  error: null,
  updatedAt: null,
};

export const useCodexStore = create<CodexStore>()((set) => ({
  conversations: {},
  meta: null,
  setMeta: (meta) => set({ meta }),
  setLoading: (conversationID, loading) =>
    set((state) => ({
      conversations: {
        ...state.conversations,
        [conversationID]: {
          ...(state.conversations[conversationID] ?? emptyEntry),
          loading,
        },
      },
    })),
  setStatus: (conversationID, status) =>
    set((state) => ({
      conversations: {
        ...state.conversations,
        [conversationID]: {
          ...(state.conversations[conversationID] ?? emptyEntry),
          status,
          loading: false,
          error: null,
          updatedAt: Date.now(),
        },
      },
    })),
  setSessions: (conversationID, sessions) =>
    set((state) => ({
      conversations: {
        ...state.conversations,
        [conversationID]: {
          ...(state.conversations[conversationID] ?? emptyEntry),
          sessions,
          updatedAt: Date.now(),
        },
      },
    })),
  upsertSession: (conversationID, session) =>
    set((state) => {
      const entry = state.conversations[conversationID] ?? emptyEntry;
      const sessions = entry.sessions.some((item) => item.id === session.id)
        ? entry.sessions.map((item) => (item.id === session.id ? session : item))
        : [session, ...entry.sessions];
      return {
        conversations: {
          ...state.conversations,
          [conversationID]: {
            ...entry,
            sessions,
            status: entry.status
              ? {
                  ...entry.status,
                  activeSession: session.isActive
                    ? session
                    : entry.status.activeSession,
                }
              : entry.status,
            updatedAt: Date.now(),
          },
        },
      };
    }),
  activateSessionLocal: (conversationID, session) =>
    set((state) => {
      const entry = state.conversations[conversationID] ?? emptyEntry;
      return {
        conversations: {
          ...state.conversations,
          [conversationID]: {
            ...entry,
            sessions: entry.sessions.map((item) => ({
              ...item,
              isActive: item.id === session.id,
              updatedAt: item.id === session.id ? session.updatedAt : item.updatedAt,
            })),
            status: entry.status
              ? {
                  ...entry.status,
                  activeSession: session,
                }
              : entry.status,
            updatedAt: Date.now(),
          },
        },
      };
    }),
  setJobEvents: (conversationID, jobID, events) =>
    set((state) => {
      const entry = state.conversations[conversationID] ?? emptyEntry;
      return {
        conversations: {
          ...state.conversations,
          [conversationID]: {
            ...entry,
            eventsByJobId: {
              ...entry.eventsByJobId,
              [jobID]: events,
            },
            updatedAt: Date.now(),
          },
        },
      };
    }),
  appendJobEvents: (conversationID, jobID, events) =>
    set((state) => {
      const entry = state.conversations[conversationID] ?? emptyEntry;
      const existing = entry.eventsByJobId[jobID] ?? [];
      const bySequence = new Map(
        [...existing, ...events].map((event) => [event.sequence, event]),
      );
      return {
        conversations: {
          ...state.conversations,
          [conversationID]: {
            ...entry,
            eventsByJobId: {
              ...entry.eventsByJobId,
              [jobID]: Array.from(bySequence.values()).sort(
                (left, right) => left.sequence - right.sequence,
              ),
            },
            updatedAt: Date.now(),
          },
        },
      };
    }),
  setError: (conversationID, error) =>
    set((state) => ({
      conversations: {
        ...state.conversations,
        [conversationID]: {
          ...(state.conversations[conversationID] ?? emptyEntry),
          loading: false,
          error,
          updatedAt: Date.now(),
        },
      },
    })),
}));
