import { Empty, Tag, Timeline, Typography } from "antd";

import { CodexRuntimeEvent } from "@/types/codex";

interface CodexRuntimeTraceProps {
  events: CodexRuntimeEvent[];
}

export default function CodexRuntimeTrace({ events }: CodexRuntimeTraceProps) {
  if (!events.length) {
    return (
      <Empty
        className="my-3"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="No runtime events"
      />
    );
  }

  return (
    <Timeline
      className="mt-3"
      items={events.slice(-30).map((event) => {
        const view = getEventView(event);
        return {
          key: event.id,
          color: view.color,
          children: (
            <div className="text-xs">
              <div className="mb-1 flex items-center gap-2">
                <span className="font-medium">{view.title}</span>
                <Tag className="m-0" color={view.tagColor}>
                  {view.label}
                </Tag>
              </div>
              {event.summary ? (
                <Typography.Paragraph
                  className="m-0 text-xs text-[var(--sub-text)]"
                  ellipsis={{ rows: 3, expandable: true }}
                >
                  {event.summary}
                </Typography.Paragraph>
              ) : (
                <div className="text-[var(--sub-text)]">{event.eventType}</div>
              )}
            </div>
          ),
        };
      })}
    />
  );
}

function getEventView(event: CodexRuntimeEvent): {
  title: string;
  label: string;
  color: string;
  tagColor: string;
} {
  const item = isRecord(event.rawEvent.item) ? event.rawEvent.item : event.rawEvent;
  const status = typeof item.status === "string" ? item.status : "";
  const output =
    typeof item.aggregated_output === "string" ? item.aggregated_output : "";
  const blocked = status === "declined" || output.includes("blocked by policy");

  if (blocked) {
    return {
      title: "Command blocked",
      label: "policy",
      color: "red",
      tagColor: "error",
    };
  }

  if (event.title === "command_execution" && event.eventType === "item.started") {
    return {
      title: "Command started",
      label: "running",
      color: "blue",
      tagColor: "processing",
    };
  }

  if (event.title === "command_execution") {
    return {
      title: "Command completed",
      label: "done",
      color: "green",
      tagColor: "success",
    };
  }

  if (event.title === "agent_message") {
    return {
      title: "Agent message",
      label: "agent",
      color: "blue",
      tagColor: "blue",
    };
  }

  if (event.eventType === "turn.completed") {
    return {
      title: "Turn completed",
      label: "usage",
      color: "green",
      tagColor: "success",
    };
  }

  return {
    title: event.title,
    label: event.eventType,
    color: "gray",
    tagColor: "default",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
