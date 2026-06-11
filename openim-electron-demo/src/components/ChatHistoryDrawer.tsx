import { SearchOutlined } from "@ant-design/icons";
import { MessageItem, MessageType, ViewType } from "@openim/wasm-client-sdk";
import { Button, Drawer, Empty, Input, List, Select, Space, Typography } from "antd";
import { forwardRef, ForwardRefRenderFunction, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { OverlayVisibleHandle, useOverlayVisible } from "@/hooks/useOverlayVisible";
import { IMSDK } from "@/layout/MainContentWrap";
import { replaceMessageListAndScroll } from "@/pages/chat/queryChat/useHistoryMessageList";
import { useConversationStore } from "@/store";
import { formatMessageTime } from "@/utils/imCommon";
import {
  getCachedConversationMessages,
  getMessagePreview,
  searchConversationMessages,
} from "@/utils/messageSearch";

const PAGE_SIZE = 30;

const ChatHistoryDrawer: ForwardRefRenderFunction<OverlayVisibleHandle, unknown> = (
  _,
  ref,
) => {
  const { isOverlayOpen, closeOverlay } = useOverlayVisible(ref);
  const currentConversation = useConversationStore(
    (state) => state.currentConversation,
  );
  const { conversationID: routeConversationID } = useParams();
  const conversationID = currentConversation?.conversationID ?? routeConversationID;
  const [keyword, setKeyword] = useState("");
  const [messageType, setMessageType] = useState<number | "all">("all");
  const [history, setHistory] = useState<MessageItem[]>([]);
  const [searchResults, setSearchResults] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (!isOverlayOpen || !conversationID) return;
    setKeyword("");
    setSearchResults([]);
    void loadHistory(false);
  }, [conversationID, isOverlayOpen]);

  const loadHistory = async (loadMore: boolean) => {
    if (!conversationID) return;
    setLoading(true);
    try {
      if (!loadMore) {
        const cached = getCachedConversationMessages(conversationID);
        if (cached.length) {
          setHistory(cached);
        }
      }
      const { data } = await IMSDK.getAdvancedHistoryMessageList({
        count: PAGE_SIZE,
        startClientMsgID: loadMore
          ? history[history.length - 1]?.clientMsgID ?? ""
          : "",
        conversationID,
        viewType: ViewType.History,
      });
      setHistory((prev) => {
        const next = loadMore ? [...prev, ...data.messageList] : data.messageList;
        return next.length ? next : prev;
      });
      setHasMore(!data.isEnd);
    } finally {
      setLoading(false);
    }
  };

  const search = async () => {
    if (!conversationID || !keyword.trim()) return;
    setLoading(true);
    try {
      const results = await searchConversationMessages({
        sdk: IMSDK,
        conversationID,
        keyword,
        messageType,
        seedMessages: [...history, ...getCachedConversationMessages(conversationID)],
      });
      setSearchResults(results);
    } finally {
      setLoading(false);
    }
  };

  const jumpToMessage = async (message: MessageItem) => {
    try {
      const { data } = await IMSDK.fetchSurroundingMessages({
        startMessage: message,
        viewType: ViewType.History,
        before: 10,
        after: 10,
      });
      replaceMessageListAndScroll(data.messageList, message.clientMsgID);
    } catch {
      replaceMessageListAndScroll(
        getCachedConversationMessages(conversationID).length
          ? getCachedConversationMessages(conversationID)
          : [message],
        message.clientMsgID,
      );
    }
    closeOverlay();
  };

  const showingSearch = keyword.trim().length > 0;
  const dataSource = showingSearch ? searchResults : history;

  return (
    <Drawer
      title="History / Search"
      placement="right"
      rootClassName="chat-drawer"
      onClose={closeOverlay}
      open={isOverlayOpen}
      maskClassName="opacity-0"
      maskMotion={{ visible: false }}
      width={520}
      getContainer={"#chat-container"}
    >
      <div className="space-y-3 px-3 pb-4">
        <Space.Compact className="w-full">
          <Input
            placeholder="Search messages"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={() => void search()}
          />
          <Select
            className="w-32"
            value={messageType}
            onChange={setMessageType}
            options={[
              { label: "All", value: "all" },
              { label: "Text", value: MessageType.TextMessage },
              { label: "Image", value: MessageType.PictureMessage },
              { label: "File", value: MessageType.FileMessage },
            ]}
          />
          <Button
            icon={<SearchOutlined rev={undefined} />}
            onClick={() => void search()}
          />
        </Space.Compact>
        <List
          size="small"
          loading={loading}
          dataSource={dataSource}
          locale={{
            emptyText: (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No messages" />
            ),
          }}
          renderItem={(message) => (
            <List.Item
              className="cursor-pointer rounded px-2 hover:bg-[#f5f9ff]"
              onClick={() => void jumpToMessage(message)}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs text-[var(--sub-text)]">
                  <span>{message.senderNickname}</span>
                  <span>{formatMessageTime(message.sendTime)}</span>
                </div>
                <Typography.Text className="block max-w-[430px]" ellipsis>
                  {getMessagePreview(message)}
                </Typography.Text>
              </div>
            </List.Item>
          )}
        />
        {!showingSearch && hasMore ? (
          <Button block loading={loading} onClick={() => void loadHistory(true)}>
            Load more
          </Button>
        ) : null}
      </div>
    </Drawer>
  );
};

export default forwardRef(ChatHistoryDrawer);
