import { MessageItem as MessageItemType } from "@openim/wasm-client-sdk";
import { Layout, Spin } from "antd";
import clsx from "clsx";
import { memo, useEffect, useRef, useState } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";

import { SystemMessageTypes } from "@/constants/im";
import { useUserStore } from "@/store";
import emitter from "@/utils/events";

import MessageItem from "./MessageItem";
import NotificationMessage from "./NotificationMessage";
import { START_INDEX, useHistoryMessageList } from "./useHistoryMessageList";

const ChatContent = () => {
  const virtuoso = useRef<VirtuosoHandle>(null);
  const [highlightedClientMsgID, setHighlightedClientMsgID] = useState<string | null>(
    null,
  );
  const [pendingJumpClientMsgID, setPendingJumpClientMsgID] = useState<string | null>(
    null,
  );
  const selfUserID = useUserStore((state) => state.selfInfo.userID);

  const scrollToBottom = () => {
    setTimeout(() => {
      virtuoso.current?.scrollToIndex({
        index: 9999,
        align: "end",
        behavior: "auto",
      });
    });
  };

  const { SPLIT_COUNT, conversationID, loadState, moreOldLoading, getMoreOldMessages } =
    useHistoryMessageList();

  useEffect(() => {
    emitter.on("CHAT_LIST_SCROLL_TO_BOTTOM", scrollToBottom);
    const jumpToMessage = ({
      targetClientMsgID,
    }: {
      messages: MessageItemType[];
      targetClientMsgID: string;
    }) => {
      setPendingJumpClientMsgID(targetClientMsgID);
    };
    emitter.on("REPLACE_MESSAGE_LIST_AND_SCROLL", jumpToMessage);
    return () => {
      emitter.off("CHAT_LIST_SCROLL_TO_BOTTOM", scrollToBottom);
      emitter.off("REPLACE_MESSAGE_LIST_AND_SCROLL", jumpToMessage);
    };
  }, []);

  useEffect(() => {
    if (!pendingJumpClientMsgID) return;
    const targetIndex = loadState.messageList.findIndex(
      (message) => message.clientMsgID === pendingJumpClientMsgID,
    );
    if (targetIndex < 0) return;

    setHighlightedClientMsgID(pendingJumpClientMsgID);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        virtuoso.current?.scrollToIndex({
          index: loadState.firstItemIndex + targetIndex,
          align: "center",
          behavior: "auto",
        });
      });
    });
    const targetClientMsgID = pendingJumpClientMsgID;
    setPendingJumpClientMsgID(null);
    window.setTimeout(() => {
      setHighlightedClientMsgID((current) =>
        current === targetClientMsgID ? null : current,
      );
    }, 2400);
  }, [loadState.firstItemIndex, loadState.messageList, pendingJumpClientMsgID]);

  const loadMoreMessage = () => {
    if (!loadState.hasMoreOld || moreOldLoading) return;

    getMoreOldMessages();
  };

  return (
    <Layout.Content
      className="relative flex h-full overflow-hidden !bg-white"
      id="chat-main"
    >
      {loadState.initLoading ? (
        <div className="flex h-full w-full items-center justify-center bg-white pt-1">
          <Spin spinning />
        </div>
      ) : (
        <Virtuoso
          id="chat-list"
          className="w-full overflow-x-hidden"
          followOutput="smooth"
          firstItemIndex={loadState.firstItemIndex}
          initialTopMostItemIndex={SPLIT_COUNT - 1}
          startReached={loadMoreMessage}
          ref={virtuoso}
          data={loadState.messageList}
          components={{
            Header: () =>
              loadState.hasMoreOld ? (
                <div
                  className={clsx(
                    "flex justify-center py-2 opacity-0",
                    moreOldLoading && "opacity-100",
                  )}
                >
                  <Spin />
                </div>
              ) : null,
          }}
          computeItemKey={(_, item) => item.clientMsgID}
          itemContent={(_, message) => {
            if (SystemMessageTypes.includes(message.contentType)) {
              return (
                <NotificationMessage key={message.clientMsgID} message={message} />
              );
            }
            const isSender = selfUserID === message.sendID;
            return (
              <MessageItem
                key={message.clientMsgID}
                conversationID={conversationID}
                message={message}
                messageUpdateFlag={message.senderNickname + message.senderFaceUrl}
                isSender={isSender}
                highlighted={message.clientMsgID === highlightedClientMsgID}
              />
            );
          }}
        />
      )}
    </Layout.Content>
  );
};

export default memo(ChatContent);
