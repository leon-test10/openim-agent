import { MessageItem as MessageItemType, MessageType } from "@openim/wasm-client-sdk";
import clsx from "clsx";
import { FC, memo, useCallback, useRef, useState } from "react";

import OIMAvatar from "@/components/OIMAvatar";
import { useConversationStore } from "@/store";
import { getViteEnv } from "@/utils/env";
import { formatMessageTime } from "@/utils/imCommon";

import CatchMessageRender from "./CatchMsgRenderer";
import FileMessageRender from "./FileMessageRender";
import MediaMessageRender from "./MediaMessageRender";
import styles from "./message-item.module.scss";
import MessageItemErrorBoundary from "./MessageItemErrorBoundary";
import MessageSuffix from "./MessageSuffix";
import TextMessageRender from "./TextMessageRender";

export interface IMessageItemProps {
  message: MessageItemType;
  isSender: boolean;
  disabled?: boolean;
  conversationID?: string;
  messageUpdateFlag?: string;
  highlighted?: boolean;
}

const components: Record<number, FC<IMessageItemProps>> = {
  [MessageType.TextMessage]: TextMessageRender,
  [MessageType.AtTextMessage]: TextMessageRender,
  [MessageType.PictureMessage]: MediaMessageRender,
  [MessageType.FileMessage]: FileMessageRender,
};

const CODEX_BOT_USER_ID = getViteEnv("VITE_CODEX_BOT_USER_ID", "codex_bot");

const MessageItem: FC<IMessageItemProps> = ({
  message,
  disabled,
  isSender,
  conversationID,
  highlighted,
}) => {
  const messageWrapRef = useRef<HTMLDivElement>(null);
  const [showMessageMenu, setShowMessageMenu] = useState(false);
  const currentConversation = useConversationStore(
    (state) => state.currentConversation,
  );
  const MessageRenderComponent = components[message.contentType] || CatchMessageRender;
  const isConversationPeer = message.sendID === currentConversation?.userID;
  const isCodexBotMessage = message.sendID === CODEX_BOT_USER_ID;
  const avatarSrc =
    message.senderFaceUrl ||
    (isConversationPeer || isCodexBotMessage ? currentConversation?.faceURL : "");
  const avatarText = isCodexBotMessage
    ? "CB"
    : message.senderNickname || message.sendID;

  const closeMessageMenu = useCallback(() => {
    setShowMessageMenu(false);
  }, []);

  const canShowMessageMenu = !disabled;

  return (
    <>
      <div
        id={`chat_${message.clientMsgID}`}
        className={clsx(
          "relative flex select-text px-5 py-3 transition-colors duration-300",
          highlighted && "bg-[#fff7e6]",
        )}
      >
        <div
          className={clsx(
            styles["message-container"],
            isSender && styles["message-container-sender"],
          )}
        >
          <OIMAvatar size={36} src={avatarSrc} text={avatarText} />

          <div className={styles["message-wrap"]} ref={messageWrapRef}>
            <div className={styles["message-profile"]}>
              <div
                title={message.senderNickname}
                className={clsx(
                  "max-w-[30%] truncate text-[var(--sub-text)]",
                  isSender ? "ml-2" : "mr-2",
                )}
              >
                {message.senderNickname}
              </div>
              <div className="text-[var(--sub-text)]">
                {formatMessageTime(message.sendTime)}
              </div>
            </div>

            <div className={styles["menu-wrap"]}>
              <MessageItemErrorBoundary message={message}>
                <MessageRenderComponent
                  message={message}
                  isSender={isSender}
                  disabled={disabled}
                />
              </MessageItemErrorBoundary>

              <MessageSuffix
                message={message}
                isSender={isSender}
                disabled={false}
                conversationID={conversationID}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default memo(MessageItem);
