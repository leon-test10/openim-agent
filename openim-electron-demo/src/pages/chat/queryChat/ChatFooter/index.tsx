import { SessionType } from "@openim/wasm-client-sdk";
import { useLatest } from "ahooks";
import { Button } from "antd";
import { t } from "i18next";
import {
  forwardRef,
  ForwardRefRenderFunction,
  memo,
  useEffect,
  useMemo,
  useState,
} from "react";

import CKEditor, { MentionFeedItem } from "@/components/CKEditor";
import { getCleanText, getMentionMetadata } from "@/components/CKEditor/utils";
import useGroupMembers from "@/hooks/useGroupMembers";
import { useCodexConversation } from "@/hooks/useCodexConversation";
import i18n from "@/i18n";
import { IMSDK } from "@/layout/MainContentWrap";
import { useConversationStore } from "@/store";

import SendActionBar from "./SendActionBar";
import { useFileMessage } from "./SendActionBar/useFileMessage";
import { useSendMessage } from "./useSendMessage";

const sendActions = [
  { label: t("placeholder.sendWithEnter"), key: "enter" },
  { label: t("placeholder.sendWithShiftEnter"), key: "enterwithshift" },
];

i18n.on("languageChanged", () => {
  sendActions[0].label = t("placeholder.sendWithEnter");
  sendActions[1].label = t("placeholder.sendWithShiftEnter");
});

const ChatFooter: ForwardRefRenderFunction<unknown, unknown> = () => {
  const [html, setHtml] = useState("");
  const latestHtml = useLatest(html);

  const { getImageMessage, getNormalFileMessage } = useFileMessage();
  const { sendMessage } = useSendMessage();
  const { isCodexConversation, activeJob, queuedJobCount, cancel } =
    useCodexConversation();

  const currentConversation = useConversationStore(
    (state) => state.currentConversation,
  );
  const isGroupChat =
    currentConversation?.conversationType === SessionType.Group;

  const { fetchState: groupMemberState, getMemberData } = useGroupMembers(
    isGroupChat
      ? { groupID: currentConversation?.groupID }
      : undefined,
  );

  useEffect(() => {
    if (isGroupChat) {
      void getMemberData(true);
    }
  }, [isGroupChat, currentConversation?.groupID, getMemberData]);

  const mentionFeeds = useMemo(() => {
    if (!isGroupChat || groupMemberState.groupMemberList.length === 0)
      return undefined;
    const feed: MentionFeedItem[] = groupMemberState.groupMemberList.map(
      (member) => ({
        id: `@${member.userID}`,
        text: member.nickname || member.userID,
      }),
    );
    return [{ marker: "@", feed, minimumCharacters: 0 }];
  }, [isGroupChat, groupMemberState.groupMemberList]);

  const onChange = (value: string) => {
    setHtml(value);
  };

  const enterToSend = async () => {
    const sourceHtml = latestHtml.current ?? "";
    const cleanText = getCleanText(sourceHtml);
    const mentions = isGroupChat ? getMentionMetadata(sourceHtml) : [];
    if (!cleanText) {
      setHtml("");
      return;
    }

    const message =
      isGroupChat && mentions.length > 0
        ? (
            await IMSDK.createTextAtMessage({
              text: cleanText,
              atUserIDList: mentions.map((mention) => mention.atUserID),
              atUsersInfo: mentions.map((mention) => ({
                atUserID: mention.atUserID,
                groupNickname: mention.groupNickname,
              })),
            })
          ).data
        : (await IMSDK.createTextMessage(cleanText)).data;
    setHtml("");

    sendMessage({ message });
  };

  return (
    <footer className="relative h-full bg-white py-px">
      <div className="flex h-full flex-col border-t border-t-[var(--gap-text)]">
        <SendActionBar
          sendMessage={sendMessage}
          getImageMessage={getImageMessage}
          getNormalFileMessage={getNormalFileMessage}
        />
        <div className="relative flex flex-1 flex-col overflow-hidden">
          {isCodexConversation && activeJob && (
            <div className="flex items-center justify-between border-b border-b-[var(--gap-text)] px-3 py-1 text-xs text-[var(--sub-text)]">
              <span>
                Codex is {activeJob.status}. New messages will queue
                {queuedJobCount > 0 ? ` (${queuedJobCount} waiting)` : ""}.
              </span>
              {activeJob.canCancel && (
                <Button size="small" danger onClick={() => void cancel()}>
                  Cancel
                </Button>
              )}
            </div>
          )}
          <CKEditor
            value={html}
            onEnter={() => void enterToSend()}
            onChange={onChange}
            mentionFeeds={mentionFeeds}
          />
          <div className="flex items-center justify-end py-2 pr-3">
            <Button
              className="w-fit px-6 py-1"
              type="primary"
              onClick={() => void enterToSend()}
            >
              {t("placeholder.send")}
            </Button>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default memo(forwardRef(ChatFooter));
