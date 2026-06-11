import { MoreOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Dropdown,
  Empty,
  Input,
  List,
  Modal,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
} from "antd";
import {
  forwardRef,
  ForwardRefRenderFunction,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  createRuntimeProfile,
  deleteRuntimeScopeConfig,
  getResolvedRuntimeScopeConfig,
  deleteRuntimeProfile,
  getCodexContextPreview,
  listRuntimeProfiles,
  testRuntimeProfile,
  upsertRuntimeScopeConfig,
  updateRuntimeProfile,
} from "@/api/codexBridge";
import CodexRuntimeTrace from "@/components/CodexRuntimeTrace";
import { useCodexConversation } from "@/hooks/useCodexConversation";
import { OverlayVisibleHandle, useOverlayVisible } from "@/hooks/useOverlayVisible";
import { useConversationStore } from "@/store";
import {
  CodexContextPreview,
  CodexRuntimeEvent,
  CodexRuntimeJob,
  CodexRuntimeProfile,
  CodexRuntimeProfileInput,
  CodexSessionDiagnostics,
  CodexSessionRecord,
  ResolvedRuntimeScopeConfig,
  RuntimeKind,
  RuntimeScopeType,
} from "@/types/codex";
import { feedbackToast } from "@/utils/common";
import { getViteEnv } from "@/utils/env";

const defaultProjectPath = getViteEnv(
  "VITE_CODEX_DEFAULT_PROJECT_PATH",
  "D:\\agent_trial\\claude_code\\official-openim",
);

const jobColors: Record<CodexRuntimeJob["status"], string> = {
  queued: "processing",
  running: "processing",
  cancelling: "warning",
  succeeded: "success",
  failed: "error",
  cancelled: "default",
};

const CodexActivityDrawer: ForwardRefRenderFunction<OverlayVisibleHandle, unknown> = (
  _,
  ref,
) => {
  const { isOverlayOpen, closeOverlay } = useOverlayVisible(ref);
  const {
    isCodexConversation,
    conversationID,
    status,
    meta,
    error,
    activeJob,
    latestJob,
    queuedJobCount,
    sessions,
    eventsByJobId,
    cancel,
    retry,
    rebind,
    createSession,
    activateSession,
    renameSession,
    archiveSession,
    restoreSession,
    deleteSession,
    loadJobEvents,
    getSessionDiagnostics,
  } = useCodexConversation();
  const currentConversation = useConversationStore((state) => state.currentConversation);
  const [selectedJobID, setSelectedJobID] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState(defaultProjectPath);
  const [submitting, setSubmitting] = useState(false);
  const [runtimeProfiles, setRuntimeProfiles] = useState<CodexRuntimeProfile[]>([]);
  const [selectedRuntimeProfileID, setSelectedRuntimeProfileID] = useState<string>("");
  const [selectedScopeType, setSelectedScopeType] = useState<RuntimeScopeType>("shared");
  const [resolvedScopeConfig, setResolvedScopeConfig] = useState<ResolvedRuntimeScopeConfig | null>(null);
  const [profileDraft, setProfileDraft] = useState<RuntimeProfileDraft>(
    createEmptyProfileDraft(),
  );
  const [profileTestResult, setProfileTestResult] = useState<string>("");
  const [contextPreview, setContextPreview] = useState<CodexContextPreview | null>(
    null,
  );
  const [sessionDiagnostics, setSessionDiagnostics] = useState<
    Record<string, CodexSessionDiagnostics>
  >({});

  const jobs = useMemo(() => {
    const byId = new Map<string, CodexRuntimeJob>();
    for (const job of [activeJob, latestJob, ...(status?.recentJobs ?? [])]) {
      if (job) {
        byId.set(job.id, job);
      }
    }
    return Array.from(byId.values());
  }, [activeJob, latestJob, status?.recentJobs]);

  const selectedJob =
    jobs.find((job) => job.id === selectedJobID) ?? activeJob ?? latestJob ?? null;
  const selectedEvents: CodexRuntimeEvent[] = selectedJob
    ? eventsByJobId[selectedJob.id] ?? []
    : [];
  const hasActiveJob = Boolean(activeJob);

  useEffect(() => {
    if (!selectedJobID && (activeJob?.id || latestJob?.id)) {
      setSelectedJobID(activeJob?.id ?? latestJob?.id ?? null);
    }
  }, [activeJob?.id, latestJob?.id, selectedJobID]);

  useEffect(() => {
    if (status?.activeSession?.codexProjectPath) {
      setProjectPath(status.activeSession.codexProjectPath);
    }
  }, [status?.activeSession?.codexProjectPath]);

  useEffect(() => {
    if (status?.activeSession?.runtimeProfileId) {
      setSelectedRuntimeProfileID(status.activeSession.runtimeProfileId);
    }
  }, [status?.activeSession?.runtimeProfileId]);

  useEffect(() => {
    const runtimeKind =
      status?.activeSession?.runtimeKind ?? resolvedScopeConfig?.runtimeKind ?? "codex_cli";
    setProfileDraft((current) => ({ ...current, runtimeKind }));
  }, [resolvedScopeConfig?.runtimeKind, status?.activeSession?.runtimeKind]);

  const refreshRuntimeProfiles = async () => {
    const { profiles } = await listRuntimeProfiles();
    setRuntimeProfiles(profiles);
  };

  const refreshResolvedScopeConfig = async () => {
    const resolved = await getResolvedRuntimeScopeConfig(
      conversationID ?? undefined,
      currentConversation?.groupID ?? undefined,
    );
    setResolvedScopeConfig(resolved);
    if (resolved.source !== "env") {
      setSelectedScopeType(resolved.source);
    }
    if (resolved.runtimeProfileId) {
      setSelectedRuntimeProfileID(resolved.runtimeProfileId);
    }
  };

  useEffect(() => {
    if (isOverlayOpen) {
      void Promise.all([
        refreshRuntimeProfiles(),
        refreshResolvedScopeConfig(),
      ]).catch((error) => feedbackToast({ error }));
    }
  }, [conversationID, currentConversation?.groupID, isOverlayOpen]);

  useEffect(() => {
    if (isOverlayOpen && selectedJob?.id) {
      void loadJobEvents(selectedJob.id);
    }
  }, [isOverlayOpen, loadJobEvents, selectedJob?.id]);

  useEffect(() => {
    if (!isOverlayOpen || !getSessionDiagnostics) return;
    let cancelled = false;
    void Promise.all(
      sessions.map(async (session) => {
        const diagnostics = await getSessionDiagnostics(session.id);
        return diagnostics ? [session.id, diagnostics] : null;
      }),
    )
      .then((items) => {
        if (cancelled) return;
        setSessionDiagnostics(
          Object.fromEntries(
            items.filter(Boolean) as Array<[string, CodexSessionDiagnostics]>,
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [getSessionDiagnostics, isOverlayOpen, sessions]);

  if (!isCodexConversation) {
    return null;
  }

  const runAction = async (action: () => Promise<unknown>, successMessage?: string) => {
    setSubmitting(true);
    try {
      await action();
      if (successMessage) {
        feedbackToast({ msg: successMessage });
      }
      return true;
    } catch (error) {
      feedbackToast({ error });
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const saveRuntimeProfile = async () =>
    runAction(async () => {
      const payload = toRuntimeProfilePayload(profileDraft);
      const profile = profileDraft.id
        ? await updateRuntimeProfile(profileDraft.id, payload)
        : await createRuntimeProfile(payload as CodexRuntimeProfileInput);
      setSelectedRuntimeProfileID(profile.id);
      setProfileDraft(createDraftFromProfile(profile));
      await refreshRuntimeProfiles();
    }, "Runtime profile saved");

  const removeRuntimeProfile = async (profileID: string) =>
    runAction(async () => {
      await deleteRuntimeProfile(profileID);
      if (selectedRuntimeProfileID === profileID) {
        setSelectedRuntimeProfileID("");
      }
      setProfileDraft(createEmptyProfileDraft());
      await refreshRuntimeProfiles();
    }, "Runtime profile deleted");

  const runRuntimeProfileTest = async (profileID: string) =>
    runAction(async () => {
      const result = await testRuntimeProfile(profileID);
      setProfileTestResult(
        `Upstream: ${formatProbe(result.upstreamProbe)} / Codex: ${formatProbe(
          result.codexProbe,
        )}`,
      );
    }, "Runtime profile checked");

  const loadContextPreview = async () =>
    runAction(async () => {
      if (!conversationID) {
        return false;
      }
      setContextPreview(await getCodexContextPreview(conversationID, true));
      return true;
    }, "Context preview loaded");

  return (
    <Drawer
      title="Codex Activity"
      placement="right"
      rootClassName="chat-drawer"
      destroyOnClose={false}
      onClose={closeOverlay}
      open={isOverlayOpen}
      maskClassName="opacity-0"
      maskMotion={{ visible: false }}
      width={560}
      getContainer={"#chat-container"}
    >
      <Tabs
        className="px-3"
        items={[
          {
            key: "runs",
            label: "Runs",
            children: (
              <RunsTab
                jobs={jobs}
                activeJob={activeJob}
                selectedJob={selectedJob}
                selectedEvents={selectedEvents}
                queuedJobCount={queuedJobCount}
                error={error}
                submitting={submitting}
                onSelectJob={setSelectedJobID}
                onCancel={() => runAction(cancel, "Codex job cancellation requested")}
                onRetry={(jobID) => runAction(() => retry(jobID), "Codex job queued")}
              />
            ),
          },
          {
            key: "sessions",
            label: "Sessions",
            children: (
              <SessionsTab
                sessions={sessions}
                diagnosticsBySessionId={sessionDiagnostics}
                hasActiveJob={hasActiveJob}
                error={error}
                submitting={submitting}
                projectPath={projectPath}
                onCreate={() =>
                  runAction(
                    () =>
                      createSession({
                        codexProjectPath: projectPath,
                        runtimeKind: profileDraft.runtimeKind,
                        runtimeProfileId: selectedRuntimeProfileID || null,
                      }),
                    "New runtime session activated",
                  )
                }
                onActivate={(session) =>
                  runAction(
                    () => activateSession(session.id),
                    "Runtime session activated",
                  )
                }
                onRename={(session, displayName) =>
                  runAction(
                    () => renameSession(session.id, displayName),
                    "Runtime session renamed",
                  )
                }
                onArchive={(session) =>
                  runAction(() => archiveSession(session.id), "Runtime session archived")
                }
                onRestore={(session) =>
                  runAction(() => restoreSession(session.id), "Runtime session restored")
                }
                onDelete={(session) =>
                  runAction(() => deleteSession(session.id), "Runtime session deleted")
                }
              />
            ),
          },
          {
            key: "config",
            label: "Config",
            children: (
              <ConfigTab
                activeSession={status?.activeSession ?? null}
                latestJob={latestJob}
                projectPath={projectPath}
                hasActiveJob={hasActiveJob}
                submitting={submitting}
                currentConversation={currentConversation}
                onProjectPathChange={setProjectPath}
                runtimeProfiles={runtimeProfiles}
                selectedRuntimeProfileID={selectedRuntimeProfileID}
                selectedScopeType={selectedScopeType}
                resolvedScopeConfig={resolvedScopeConfig}
                profileDraft={profileDraft}
                runtimePolicy={meta?.runtimePolicy}
                profileTestResult={profileTestResult}
                contextPreview={contextPreview}
                onRuntimeProfileChange={(profileID) => {
                  setSelectedRuntimeProfileID(profileID);
                  const profile = runtimeProfiles.find((item) => item.id === profileID);
                  setProfileDraft(
                    profile
                      ? createDraftFromProfile(profile)
                      : createEmptyProfileDraft(),
                  );
                }}
                onScopeTypeChange={setSelectedScopeType}
                onProfileDraftChange={setProfileDraft}
                onSaveRuntimeProfile={saveRuntimeProfile}
                onSaveScopeConfig={(scopeType) =>
                  runAction(
                    async () => {
                      const scopeKey =
                        scopeType === "shared"
                          ? "__shared__"
                          : scopeType === "group"
                            ? currentConversation?.groupID ?? ""
                            : conversationID ?? "";
                      await upsertRuntimeScopeConfig(scopeType, scopeKey, {
                        runtimeKind: profileDraft.runtimeKind,
                        runtimeProfileId: selectedRuntimeProfileID || null,
                      });
                      await refreshResolvedScopeConfig();
                    },
                    "Runtime scope saved",
                  )
                }
                onClearScopeConfig={(scopeType) =>
                  runAction(
                    async () => {
                      const scopeKey =
                        scopeType === "shared"
                          ? "__shared__"
                          : scopeType === "group"
                            ? currentConversation?.groupID ?? ""
                            : conversationID ?? "";
                      await deleteRuntimeScopeConfig(scopeType, scopeKey);
                      await refreshResolvedScopeConfig();
                    },
                    "Runtime scope cleared",
                  )
                }
                onDeleteRuntimeProfile={removeRuntimeProfile}
                onTestRuntimeProfile={runRuntimeProfileTest}
                onLoadContextPreview={loadContextPreview}
                onRebind={() =>
                  runAction(
                    () =>
                      rebind({
                        codexProjectPath: projectPath,
                        runtimeKind: profileDraft.runtimeKind,
                        runtimeProfileId: selectedRuntimeProfileID || null,
                      }),
                    "Runtime binding changed",
                  )
                }
              />
            ),
          },
        ]}
      />
    </Drawer>
  );
};

function RunsTab({
  jobs,
  activeJob,
  selectedJob,
  selectedEvents,
  queuedJobCount,
  error,
  submitting,
  onSelectJob,
  onCancel,
  onRetry,
}: {
  jobs: CodexRuntimeJob[];
  activeJob: CodexRuntimeJob | null | undefined;
  selectedJob: CodexRuntimeJob | null;
  selectedEvents: CodexRuntimeEvent[];
  queuedJobCount: number;
  error: string | null;
  submitting: boolean;
  onSelectJob: (jobID: string) => void;
  onCancel: () => Promise<unknown>;
  onRetry: (jobID: string) => Promise<unknown>;
}) {
  return (
    <div className="space-y-3">
      <Card size="small">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">
              {selectedJob ? "Selected run" : "No runs"}
            </div>
            <div className="mt-1 text-xs text-[var(--sub-text)]">
              {queuedJobCount > 0 ? `${queuedJobCount} queued` : "No queued jobs"}
              {selectedJob ? ` / ${formatJobTiming(selectedJob)}` : ""}
            </div>
          </div>
          <Space>
            <Button
              size="small"
              danger
              disabled={!activeJob?.canCancel}
              loading={submitting}
              onClick={() => void onCancel()}
            >
              Cancel
            </Button>
            <Button
              size="small"
              disabled={!selectedJob?.canRetry}
              loading={submitting}
              onClick={() => selectedJob && void onRetry(selectedJob.id)}
            >
              Retry
            </Button>
          </Space>
        </div>
        {error ? (
          <div className="mt-2 text-xs text-red-500">Bridge: {error}</div>
        ) : null}
      </Card>

      <List
        size="small"
        dataSource={jobs}
        locale={{
          emptyText: (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No Codex runs" />
          ),
        }}
        renderItem={(job) => (
          <List.Item
            className={job.id === selectedJob?.id ? "!bg-[#F5F9FF]" : undefined}
            onClick={() => onSelectJob(job.id)}
          >
            <div className="w-full cursor-pointer">
              <div className="flex items-center justify-between gap-3">
                <Typography.Text className="max-w-[320px]" ellipsis>
                  {job.inputText}
                </Typography.Text>
                <Tag color={jobColors[job.status]}>{job.status}</Tag>
              </div>
              <div className="mt-1 text-xs text-[var(--sub-text)]">
                {formatJobTiming(job)}
              </div>
            </div>
          </List.Item>
        )}
      />

      <Card size="small" title="Runtime trace">
        <CodexRuntimeTrace events={selectedEvents} />
      </Card>
    </div>
  );
}

function SessionsTab({
  sessions,
  diagnosticsBySessionId,
  hasActiveJob,
  error,
  submitting,
  projectPath,
  onCreate,
  onActivate,
  onArchive,
  onRestore,
  onDelete,
  onRename,
}: {
  sessions: CodexSessionRecord[];
  diagnosticsBySessionId: Record<string, CodexSessionDiagnostics>;
  hasActiveJob: boolean;
  error: string | null;
  submitting: boolean;
  projectPath: string;
  onCreate: () => Promise<boolean>;
  onActivate: (session: CodexSessionRecord) => Promise<boolean>;
  onArchive: (session: CodexSessionRecord) => Promise<boolean>;
  onRestore: (session: CodexSessionRecord) => Promise<boolean>;
  onDelete: (session: CodexSessionRecord) => Promise<boolean>;
  onRename: (session: CodexSessionRecord, displayName: string) => Promise<boolean>;
}) {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const openRename = (session: CodexSessionRecord) => {
    setEditingSessionId(session.id);
    setRenameValue(getSessionTitle(session));
  };
  const closeRename = () => {
    setEditingSessionId(null);
    setRenameValue("");
  };
  const saveRename = async (session: CodexSessionRecord) => {
    if (!renameValue.trim()) return;
    const ok = await onRename(session, renameValue.trim());
    if (ok) {
      closeRename();
    }
  };

  return (
    <div className="space-y-3 px-3 pb-4">
      {error ? <Alert type="error" showIcon message={error} /> : null}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-[var(--sub-text)]">
          Select a session to use it for the next Codex run.
        </div>
        <Button
          disabled={hasActiveJob || !projectPath.trim()}
          loading={submitting}
          onClick={() => void onCreate()}
        >
          New Session
        </Button>
      </div>

      <List
        size="small"
        dataSource={sessions}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No session records"
            />
          ),
        }}
        renderItem={(session) => {
          const diagnostics = diagnosticsBySessionId[session.id];
          const canActivate =
            !hasActiveJob && !session.isActive && session.status !== "archived";
          const canArchive = !hasActiveJob && session.status !== "archived";
          const canRestore = !hasActiveJob && session.status === "archived";
          const canDelete = !hasActiveJob;
          return (
            <List.Item
              className={[
                "mb-2 cursor-pointer rounded border px-3 py-3 transition",
                session.isActive
                  ? "!border-[#95de64] !bg-[#f6ffed]"
                  : "!border-[#f0f0f0]",
                canActivate ? "hover:!border-[#91caff] hover:!bg-[#f5f9ff]" : "",
                session.status === "archived" ? "cursor-not-allowed opacity-60" : "",
              ].join(" ")}
              onClick={() => {
                if (canActivate && !submitting && editingSessionId !== session.id) {
                  void onActivate(session);
                }
              }}
              actions={[
                <Button
                  key="activate"
                  size="small"
                  type={session.isActive ? "primary" : "default"}
                  disabled={(!canActivate && !canRestore) || submitting}
                  loading={submitting && canActivate}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (canActivate) {
                      void onActivate(session);
                    }
                    if (canRestore) {
                      void onRestore(session);
                    }
                  }}
                >
                  {session.isActive ? "Active" : canRestore ? "Restore" : "Activate"}
                </Button>,
                <Dropdown
                  key="more"
                  trigger={["click"]}
                  menu={{
                    items: [
                      { key: "rename", label: "Rename" },
                      {
                        key: "archive",
                        label: "Archive",
                        disabled: !canArchive,
                      },
                      {
                        key: "delete",
                        label: "Delete",
                        danger: true,
                        disabled: !canDelete,
                      },
                    ],
                    onClick: ({ key, domEvent }) => {
                      domEvent.stopPropagation();
                      if (key === "rename") {
                        openRename(session);
                      }
                      if (key === "archive") {
                        void onArchive(session);
                      }
                      if (key === "delete") {
                        Modal.confirm({
                          title: "Delete Codex session?",
                          content:
                            "The session record will be hidden from the UI. Runtime jobs remain in the bridge audit data.",
                          okButtonProps: { danger: true },
                          onOk: () => onDelete(session),
                        });
                      }
                    },
                  }}
                >
                  <Button
                    size="small"
                    type="text"
                    icon={<MoreOutlined rev={undefined} />}
                    onClick={(event) => event.stopPropagation()}
                  />
                </Dropdown>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <span>{getSessionTitle(session)}</span>
                    {session.isActive ? <Tag color="success">Active</Tag> : null}
                    {!session.isActive && session.status === "archived" ? (
                      <Tag>Archived</Tag>
                    ) : null}
                    {!session.isActive && session.status !== "archived" ? (
                      <Tag color="blue">Ready</Tag>
                    ) : null}
                    <Tag color={getDiagnosticsColor(diagnostics)}>
                      {getDiagnosticsLabel(session, diagnostics)}
                    </Tag>
                  </Space>
                }
                description={
                  <div className="space-y-1 text-xs">
                    <div>{session.lastSummary ?? "No summary yet"}</div>
                    <div>Project: {session.codexProjectPath}</div>
                    <div>Name source: {session.displayNameSource ?? "default"}</div>
                    <div>
                      Updated: {new Date(session.updatedAt).toLocaleString()} / Record:{" "}
                      {session.id}
                    </div>
                    {editingSessionId === session.id ? (
                      <div
                        className="flex items-center gap-2 pt-2"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Input
                          aria-label="Session name"
                          size="small"
                          value={renameValue}
                          maxLength={80}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onPressEnter={() => void saveRename(session)}
                        />
                        <Button
                          size="small"
                          type="primary"
                          loading={submitting}
                          disabled={!renameValue.trim()}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void saveRename(session);
                          }}
                          onClick={() => void saveRename(session)}
                        >
                          Save
                        </Button>
                        <Button size="small" onClick={closeRename}>
                          Cancel
                        </Button>
                      </div>
                    ) : null}
                  </div>
                }
              />
            </List.Item>
          );
        }}
      />
    </div>
  );
}

function ConfigTab({
  activeSession,
  latestJob,
  projectPath,
  hasActiveJob,
  submitting,
  currentConversation,
  runtimeProfiles,
  selectedRuntimeProfileID,
  selectedScopeType,
  resolvedScopeConfig,
  profileDraft,
  runtimePolicy,
  profileTestResult,
  contextPreview,
  onProjectPathChange,
  onRuntimeProfileChange,
  onScopeTypeChange,
  onProfileDraftChange,
  onSaveRuntimeProfile,
  onSaveScopeConfig,
  onClearScopeConfig,
  onDeleteRuntimeProfile,
  onTestRuntimeProfile,
  onLoadContextPreview,
  onRebind,
}: {
  activeSession: CodexSessionRecord | null;
  latestJob: CodexRuntimeJob | null | undefined;
  projectPath: string;
  hasActiveJob: boolean;
  submitting: boolean;
  currentConversation: { groupID?: string | null } | null | undefined;
  runtimeProfiles: CodexRuntimeProfile[];
  selectedRuntimeProfileID: string;
  selectedScopeType: RuntimeScopeType;
  resolvedScopeConfig: ResolvedRuntimeScopeConfig | null;
  profileDraft: RuntimeProfileDraft;
  runtimePolicy:
    | {
        canModify: boolean;
        canUseDangerFullAccess: boolean;
        canUseCodexHomeOverride: boolean;
      }
    | undefined;
  profileTestResult: string;
  contextPreview: CodexContextPreview | null;
  onProjectPathChange: (value: string) => void;
  onRuntimeProfileChange: (value: string) => void;
  onScopeTypeChange: (value: RuntimeScopeType) => void;
  onProfileDraftChange: (value: RuntimeProfileDraft) => void;
  onSaveRuntimeProfile: () => Promise<boolean>;
  onSaveScopeConfig: (scopeType: RuntimeScopeType) => Promise<boolean>;
  onClearScopeConfig: (scopeType: RuntimeScopeType) => Promise<boolean>;
  onDeleteRuntimeProfile: (profileID: string) => Promise<boolean>;
  onTestRuntimeProfile: (profileID: string) => Promise<boolean>;
  onLoadContextPreview: () => Promise<boolean>;
  onRebind: () => Promise<unknown>;
}) {
  const patchDraft = (patch: Partial<RuntimeProfileDraft>) =>
    onProfileDraftChange({ ...profileDraft, ...patch });
  const sandboxOptions = [
    { label: "read-only", value: "read-only" },
    { label: "workspace-write", value: "workspace-write" },
    ...(runtimePolicy?.canUseDangerFullAccess === false
      ? []
      : [{ label: "danger-full-access", value: "danger-full-access" }]),
  ];
  const canModifyProfiles = runtimePolicy?.canModify !== false;
  const showCodexFields = profileDraft.runtimeKind === "codex_cli";
  const scopeOptions: Array<{ label: string; value: RuntimeScopeType; disabled?: boolean }> = [
    { label: "Shared default", value: "shared" },
    { label: "Current conversation", value: "conversation" },
    {
      label: "Current group",
      value: "group",
      disabled: !currentConversation?.groupID,
    },
  ];
  return (
    <div className="space-y-3">
      <Card size="small" title="Runtime profile">
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={selectedScopeType}
              onChange={(value) => onScopeTypeChange(value)}
              options={scopeOptions}
            />
            <Select
              value={profileDraft.runtimeKind}
              onChange={(value) =>
                patchDraft({ runtimeKind: value as RuntimeKind })
              }
              options={[
                { label: "Codex CLI", value: "codex_cli" },
                  { label: "Template", value: "template" },
                { label: "OpenAI-compatible", value: "openai_compatible" },
                { label: "OpenHands", value: "openhands" },
              ]}
            />
          </div>
          <div className="text-xs text-[var(--sub-text)]">
            Current effective scope: {resolvedScopeConfig?.source ?? "env"} / runtime{" "}
            {resolvedScopeConfig?.runtimeKind ?? profileDraft.runtimeKind}
          </div>
          <Select
            className="w-full"
            allowClear
            placeholder="Use shared runtime configuration"
            value={selectedRuntimeProfileID || undefined}
            onChange={(value) => onRuntimeProfileChange(value ?? "")}
            options={runtimeProfiles.map((profile) => ({
              label: `${profile.name} / ${profile.runtimeKind}${profile.model ? ` / ${profile.model}` : ""}`,
              value: profile.id,
            }))}
          />
          <Input
            placeholder="Profile name"
            value={profileDraft.name}
            onChange={(event) => patchDraft({ name: event.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            {showCodexFields ? (
              <Select
                value={profileDraft.providerType}
                onChange={(value) => patchDraft({ providerType: value })}
                options={[
                  { label: "OpenAI", value: "openai" },
                  { label: "OpenAI compatible", value: "openai-compatible" },
                  { label: "OSS local", value: "oss-local" },
                ]}
              />
            ) : (
              <Input value={profileDraft.runtimeKind} disabled />
            )}
            <Input
              placeholder="Model"
              value={profileDraft.model}
              onChange={(event) => patchDraft({ model: event.target.value })}
            />
          </div>
          {showCodexFields ? (
            <>
              <Select
                allowClear
                placeholder="Provider mode"
                value={profileDraft.providerMode || undefined}
                onChange={(value) => patchDraft({ providerMode: value ?? "" })}
                options={[
                  { label: "OpenAI Responses", value: "openai-responses" },
                  {
                    label: "DeepSeek via Responses bridge",
                    value: "deepseek-via-responses-bridge",
                  },
                  {
                    label: "Chat probe only",
                    value: "openai-chat-probe-only",
                  },
                ]}
              />
              <div className="grid grid-cols-2 gap-2">
                <Select
                  allowClear
                  placeholder="Sandbox"
                  value={profileDraft.sandboxMode || undefined}
                  onChange={(value) => patchDraft({ sandboxMode: value ?? "" })}
                  options={sandboxOptions}
                />
                <Select
                  allowClear
                  placeholder="Approval"
                  value={profileDraft.approvalPolicy || undefined}
                  onChange={(value) => patchDraft({ approvalPolicy: value ?? "" })}
                  options={[
                    { label: "never", value: "never" },
                    { label: "on-request", value: "on-request" },
                    { label: "untrusted", value: "untrusted" },
                  ]}
                />
              </div>
              <Input
                placeholder="Codex profile name"
                value={profileDraft.codexProfile}
                onChange={(event) =>
                  patchDraft({ codexProfile: event.target.value })
                }
              />
            </>
          ) : null}
          <Input
            placeholder="Upstream base URL"
            value={profileDraft.baseUrl}
            onChange={(event) => patchDraft({ baseUrl: event.target.value })}
          />
          {showCodexFields ? (
            <>
              <Input
                placeholder="Responses bridge URL, for example http://127.0.0.1:38440/v1"
                value={profileDraft.bridgeBaseUrl}
                onChange={(event) =>
                  patchDraft({ bridgeBaseUrl: event.target.value })
                }
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="wire_api"
                  value={profileDraft.wireApi}
                  onChange={(event) => patchDraft({ wireApi: event.target.value })}
                />
                <Input
                  placeholder="Auth env key"
                  value={profileDraft.authEnvKey}
                  onChange={(event) =>
                    patchDraft({ authEnvKey: event.target.value })
                  }
                />
              </div>
              {runtimePolicy?.canUseCodexHomeOverride !== false ? (
                <Input
                  placeholder="Codex home override"
                  value={profileDraft.codexHomeOverride}
                  onChange={(event) =>
                    patchDraft({ codexHomeOverride: event.target.value })
                  }
                />
              ) : null}
            </>
          ) : (
            <div className="text-xs text-[var(--sub-text)]">
              OpenHands / OpenAI-compatible profiles use `model`, `base URL`, and
              `API key`. Project path is still bound at session level.
            </div>
          )}
          <Input.Password
            placeholder={
              profileDraft.apiKeyMasked
                ? `API key unchanged (${profileDraft.apiKeyMasked})`
                : "API key"
            }
            value={profileDraft.apiKey}
            onChange={(event) => patchDraft({ apiKey: event.target.value })}
          />
          <Space>
            <Button
              size="small"
              type="primary"
              disabled={!canModifyProfiles || !profileDraft.name.trim()}
              loading={submitting}
              onClick={() => void onSaveRuntimeProfile()}
            >
              Save profile
            </Button>
            <Button
              size="small"
              disabled={!canModifyProfiles}
              loading={submitting}
              onClick={() => void onSaveScopeConfig(selectedScopeType)}
            >
              Save scope
            </Button>
            <Button
              size="small"
              disabled={!canModifyProfiles}
              loading={submitting}
              onClick={() => void onClearScopeConfig(selectedScopeType)}
            >
              Clear scope
            </Button>
            <Button
              size="small"
              disabled={!canModifyProfiles || !profileDraft.id}
              loading={submitting}
              onClick={() =>
                profileDraft.id && void onTestRuntimeProfile(profileDraft.id)
              }
            >
              Test
            </Button>
            <Button
              size="small"
              danger
              disabled={!canModifyProfiles || !profileDraft.id}
              loading={submitting}
              onClick={() =>
                profileDraft.id && void onDeleteRuntimeProfile(profileDraft.id)
              }
            >
              Delete profile
            </Button>
          </Space>
          {profileTestResult ? (
            <div className="text-xs text-[var(--sub-text)]">{profileTestResult}</div>
          ) : null}
        </div>
      </Card>

      <Card size="small" title="Project path">
        <Input
          value={projectPath}
          disabled={hasActiveJob}
          onChange={(event) => onProjectPathChange(event.target.value)}
        />
        <div className="mt-2 text-xs text-[var(--sub-text)]">
          The selected runtime uses this directory as its working project path.
          This is runtime configuration, not an OpenIM setting.
          {selectedRuntimeProfileID
            ? " Runtime profile will be bound to the new session."
            : ""}
        </div>
        <Button
          className="mt-3"
          size="small"
          disabled={hasActiveJob || !projectPath.trim()}
          loading={submitting}
          onClick={() => void onRebind()}
        >
          Rebind current conversation
        </Button>
      </Card>

      <Card size="small" title="Runtime">
        <InfoRow
          label="Codex session"
          value={activeSession?.codexSessionId ?? "not created"}
        />
        <InfoRow label="Codex home" value={activeSession?.codexHomeDir ?? "default"} />
        <InfoRow
          label="Seed mode"
          value={activeSession?.codexHomeSeedMode ?? "default"}
        />
        <InfoRow
          label="Sandbox"
          value={activeSession?.sandboxMode ?? "Codex CLI default"}
        />
        <InfoRow
          label="Runtime profile"
          value={activeSession?.runtimeProfileId ?? "Codex CLI default"}
        />
        <InfoRow
          label="Latest job"
          value={
            latestJob ? `${latestJob.status} / ${formatJobTiming(latestJob)}` : "none"
          }
        />
      </Card>

      <Card size="small" title="Context diagnostics">
        <Space className="mb-2">
          <Button
            size="small"
            loading={submitting}
            onClick={() => void onLoadContextPreview()}
          >
            Load preview
          </Button>
          {contextPreview?.semanticContextReason ? (
            <Tag
              color={contextPreview.semanticContextIncluded ? "processing" : "default"}
            >
              {contextPreview.semanticContextReason}
            </Tag>
          ) : null}
        </Space>
        {contextPreview ? (
          <div className="space-y-1 text-xs text-[var(--sub-text)]">
            <div>
              Recent: {contextPreview.recentEventCount} / skipped:{" "}
              {contextPreview.skippedEventCount}
            </div>
            <div>Roles: {formatCountMap(contextPreview.roleCounts)}</div>
            <div>Skipped: {formatCountMap(contextPreview.skippedReasons)}</div>
            <div>
              Summary: {contextPreview.summaryIncluded ? "included" : "not included"}
            </div>
            <div>
              Prompt preview: {contextPreview.promptRedacted ? "redacted" : "none"}
            </div>
          </div>
        ) : (
          <div className="text-xs text-[var(--sub-text)]">
            Context preview is diagnostics-only and does not change OpenIM settings.
          </div>
        )}
      </Card>
    </div>
  );
}

function formatCountMap(value: Record<string, number>): string {
  const entries = Object.entries(value);
  return entries.length
    ? entries.map(([key, count]) => `${key}:${count}`).join(", ")
    : "none";
}

function getSessionTitle(session: CodexSessionRecord): string {
  return (
    session.displayName ||
    session.codexSessionId ||
    (session.isActive ? "Active session" : "New session")
  );
}

function getDiagnosticsLabel(
  session: CodexSessionRecord,
  diagnostics: CodexSessionDiagnostics | undefined,
) {
  if (!session.codexSessionId) return "No Codex session yet";
  if (!diagnostics) return "Resume unknown";
  if (diagnostics.resumeReady) return "Resume ready";
  if (!diagnostics.homeExists) return "Home missing";
  if (!diagnostics.rolloutExists) return "Rollout missing";
  return "Resume unavailable";
}

function getDiagnosticsColor(diagnostics: CodexSessionDiagnostics | undefined) {
  if (!diagnostics) return "default";
  return diagnostics.resumeReady ? "green" : "orange";
}

function formatProbe(probe: { ok: boolean; skipped: boolean; errorText?: string }) {
  if (probe.skipped) return "skipped";
  if (probe.ok) return "ok";
  return probe.errorText ? `failed (${probe.errorText})` : "failed";
}

type RuntimeProfileDraft = {
  id: string;
  name: string;
  runtimeKind: RuntimeKind;
  providerType: CodexRuntimeProfile["providerType"];
  providerMode: NonNullable<CodexRuntimeProfile["providerMode"]> | "";
  model: string;
  sandboxMode: string;
  approvalPolicy: string;
  codexProfile: string;
  baseUrl: string;
  bridgeBaseUrl: string;
  wireApi: string;
  authEnvKey: string;
  codexHomeOverride: string;
  apiKey: string;
  apiKeyMasked: string | null;
};

function createEmptyProfileDraft(): RuntimeProfileDraft {
  return {
    id: "",
    name: "",
    runtimeKind: "codex_cli",
    providerType: "openai",
    providerMode: "",
    model: "",
    sandboxMode: "",
    approvalPolicy: "",
    codexProfile: "",
    baseUrl: "",
    bridgeBaseUrl: "",
    wireApi: "responses",
    authEnvKey: "",
    codexHomeOverride: "",
    apiKey: "",
    apiKeyMasked: null,
  };
}

function createDraftFromProfile(profile: CodexRuntimeProfile): RuntimeProfileDraft {
  return {
    id: profile.id,
    name: profile.name,
    runtimeKind: profile.runtimeKind,
    providerType: profile.providerType,
    providerMode: profile.providerMode ?? "",
    model: profile.model ?? "",
    sandboxMode: profile.sandboxMode ?? "",
    approvalPolicy: profile.approvalPolicy ?? "",
    codexProfile: profile.codexProfile ?? "",
    baseUrl: profile.baseUrl ?? "",
    bridgeBaseUrl: profile.bridgeBaseUrl ?? "",
    wireApi: profile.wireApi ?? "responses",
    authEnvKey: profile.authEnvKey ?? "",
    codexHomeOverride: profile.codexHomeOverride ?? "",
    apiKey: "",
    apiKeyMasked: profile.apiKeyMasked,
  };
}

function toRuntimeProfilePayload(
  draft: RuntimeProfileDraft,
): CodexRuntimeProfileInput | Partial<CodexRuntimeProfileInput> {
  return {
    name: draft.name.trim(),
    runtimeKind: draft.runtimeKind,
    providerType:
      draft.runtimeKind === "codex_cli" ? draft.providerType : "openai-compatible",
    providerMode:
      draft.runtimeKind === "codex_cli"
        ? (nullableText(draft.providerMode) as CodexRuntimeProfile["providerMode"])
        : null,
    model: nullableText(draft.model),
    sandboxMode:
      draft.runtimeKind === "codex_cli" ? nullableText(draft.sandboxMode) : null,
    approvalPolicy:
      draft.runtimeKind === "codex_cli"
        ? nullableText(draft.approvalPolicy)
        : null,
    codexProfile:
      draft.runtimeKind === "codex_cli" ? nullableText(draft.codexProfile) : null,
    baseUrl: nullableText(draft.baseUrl),
    bridgeBaseUrl:
      draft.runtimeKind === "codex_cli" ? nullableText(draft.bridgeBaseUrl) : null,
    wireApi: draft.runtimeKind === "codex_cli" ? nullableText(draft.wireApi) : null,
    authEnvKey:
      draft.runtimeKind === "codex_cli" ? nullableText(draft.authEnvKey) : null,
    codexHomeOverride:
      draft.runtimeKind === "codex_cli"
        ? nullableText(draft.codexHomeOverride)
        : null,
    apiKey: draft.apiKey.trim() ? draft.apiKey.trim() : undefined,
  };
}

function nullableText(value: string): string | null {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2 text-xs">
      <div className="text-[var(--sub-text)]">{label}</div>
      <Typography.Text className="text-xs" copyable ellipsis>
        {value}
      </Typography.Text>
    </div>
  );
}

function formatJobTiming(job: CodexRuntimeJob): string {
  const queued = job.queuedMs ?? (job.startedAt ? job.startedAt - job.createdAt : null);
  const running = job.runningMs ?? job.totalDurationMs ?? null;
  const total = job.totalMs ?? (job.finishedAt ? job.finishedAt - job.createdAt : null);
  const parts = [
    queued === null ? null : `queued ${formatMs(queued)}`,
    running === null ? null : `running ${formatMs(running)}`,
    total === null ? null : `total ${formatMs(total)}`,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" / ") || "timing unavailable";
}

function formatMs(value: number): string {
  if (value < 1000) {
    return `${value}ms`;
  }
  return `${Math.round(value / 1000)}s`;
}

export default forwardRef(CodexActivityDrawer);
