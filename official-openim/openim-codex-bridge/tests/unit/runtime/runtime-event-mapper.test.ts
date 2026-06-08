import { describe, expect, it } from "vitest";
import { normalizeRuntimeEvent } from "../../../src/runtime/runtime-event-mapper.js";

describe("normalizeRuntimeEvent", () => {
  it("maps Codex CLI JSON events through the Codex parser", () => {
    const event = normalizeRuntimeEvent("codex_cli", {
      type: "agent_message",
      message: "hello from codex"
    });

    expect(event).toEqual({
      eventType: "agent_message",
      title: "agent_message",
      summary: "hello from codex",
      rawEvent: {
        type: "agent_message",
        message: "hello from codex"
      }
    });
  });

  it("keeps unknown runtime events normalized without throwing", () => {
    const event = normalizeRuntimeEvent("template", {
      type: "template.progress",
      summary: "working"
    });

    expect(event).toEqual({
      eventType: "template.progress",
      title: "template.progress",
      summary: "working",
      rawEvent: {
        type: "template.progress",
        summary: "working"
      }
    });
  });
});
