import { CbEvents, MessageType, ViewType } from "@openim/wasm-client-sdk";
import {
  GroupItem,
  MessageItem,
  RtcInvite,
  WSEvent,
} from "@openim/wasm-client-sdk/lib/types/entity";
import { Popover } from "antd";
import { Input, List, Tabs, Typography } from "antd";
import i18n, { t } from "i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getBusinessUserInfo } from "@/api/login";
import add_friend from "@/assets/images/topSearchBar/add_friend.png";
import add_group from "@/assets/images/topSearchBar/add_group.png";
import create_group from "@/assets/images/topSearchBar/create_group.png";
import show_more from "@/assets/images/topSearchBar/show_more.png";
import WindowControlBar from "@/components/WindowControlBar";
import { CustomType } from "@/constants";
import { OverlayVisibleHandle } from "@/hooks/useOverlayVisible";
import { replaceMessageListAndScroll } from "@/pages/chat/queryChat/useHistoryMessageList";
import ChooseModal, { ChooseModalState } from "@/pages/common/ChooseModal";
import GroupCardModal from "@/pages/common/GroupCardModal";
import RtcCallModal from "@/pages/common/RtcCallModal";
import { InviteData } from "@/pages/common/RtcCallModal/data";
import UserCardModal, { CardInfo } from "@/pages/common/UserCardModal";
import { useContactStore, useConversationStore, useUserStore } from "@/store";
import emitter, { OpenUserCardParams } from "@/utils/events";
import {
  getCachedConversationMessages,
  getMessagePreview,
  searchConversationMessages,
} from "@/utils/messageSearch";

import { IMSDK } from "../MainContentWrap";
import SearchUserOrGroup from "./SearchUserOrGroup";

type UserCardState = OpenUserCardParams & {
  cardInfo?: CardInfo;
};

const TopSearchBar = () => {
  const navigate = useNavigate();
  const userCardRef = useRef<OverlayVisibleHandle>(null);
  const groupCardRef = useRef<OverlayVisibleHandle>(null);
  const chooseModalRef = useRef<OverlayVisibleHandle>(null);
  const searchModalRef = useRef<OverlayVisibleHandle>(null);
  const rtcRef = useRef<OverlayVisibleHandle>(null);
  const [chooseModalState, setChooseModalState] = useState<ChooseModalState>({
    type: "CRATE_GROUP",
  });
  const [userCardState, setUserCardState] = useState<UserCardState>();
  const [groupCardData, setGroupCardData] = useState<
    GroupItem & { inGroup?: boolean }
  >();
  const [actionVisible, setActionVisible] = useState(false);
  const [isSearchGroup, setIsSearchGroup] = useState(false);
  const [inviteData, setInviteData] = useState<InviteData>({} as InviteData);
  const [globalKeyword, setGlobalKeyword] = useState("");
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [messageResults, setMessageResults] = useState<MessageItem[]>([]);
  const [searchingMessages, setSearchingMessages] = useState(false);
  const conversationList = useConversationStore((state) => state.conversationList);
  const currentConversation = useConversationStore(
    (state) => state.currentConversation,
  );
  const updateCurrentConversation = useConversationStore(
    (state) => state.updateCurrentConversation,
  );
  const friendList = useContactStore((state) => state.friendList);
  const groupList = useContactStore((state) => state.groupList);

  useEffect(() => {
    const userCardHandler = (params: OpenUserCardParams) => {
      setUserCardState({ ...params });
      userCardRef.current?.openOverlay();
    };
    const chooseModalHandler = (params: ChooseModalState) => {
      setChooseModalState({ ...params });
      chooseModalRef.current?.openOverlay();
    };
    const callRtcHandler = (inviteData: InviteData) => {
      if (rtcRef.current?.isOverlayOpen) return;
      setInviteData(inviteData);
      rtcRef.current?.openOverlay();
    };
    const newMessageHandler = ({ data }: WSEvent<MessageItem[]>) => {
      if (rtcRef.current?.isOverlayOpen) return;
      let rtcInvite = undefined as undefined | RtcInvite;
      data.map((message) => {
        if (message.contentType === MessageType.CustomMessage) {
          const customData = JSON.parse(message.customElem!.data);
          if (customData.customType === CustomType.CallingInvite) {
            rtcInvite = customData.data;
          }
        }
      });
      if (rtcInvite) {
        getBusinessUserInfo([rtcInvite.inviterUserID]).then(({ data: { users } }) => {
          if (users.length === 0) return;
          setInviteData({
            invitation: rtcInvite,
            participant: {
              userInfo: {
                nickname: users[0].nickname,
                faceURL: users[0].faceURL,
                userID: users[0].userID,
                ex: "",
              },
            },
          });
          rtcRef.current?.openOverlay();
        });
      }
    };

    emitter.on("OPEN_USER_CARD", userCardHandler);
    emitter.on("OPEN_GROUP_CARD", openGroupCardWithData);
    emitter.on("OPEN_CHOOSE_MODAL", chooseModalHandler);
    emitter.on("OPEN_RTC_MODAL", callRtcHandler);
    IMSDK.on(CbEvents.OnRecvNewMessages, newMessageHandler);
    return () => {
      emitter.off("OPEN_USER_CARD", userCardHandler);
      emitter.off("OPEN_GROUP_CARD", openGroupCardWithData);
      emitter.off("OPEN_CHOOSE_MODAL", chooseModalHandler);
      emitter.off("OPEN_RTC_MODAL", callRtcHandler);
      IMSDK.off(CbEvents.OnRecvNewMessages, newMessageHandler);
    };
  }, []);

  const actionClick = (idx: number) => {
    switch (idx) {
      case 0:
      case 1:
        setIsSearchGroup(Boolean(idx));
        searchModalRef.current?.openOverlay();
        break;
      case 2:
        setChooseModalState({ type: "CRATE_GROUP" });
        chooseModalRef.current?.openOverlay();
        break;
      default:
        break;
    }
    setActionVisible(false);
  };

  const openUserCardWithData = useCallback((cardInfo: CardInfo) => {
    searchModalRef.current?.closeOverlay();
    setUserCardState({
      userID: cardInfo.userID,
      cardInfo,
      isSelf: cardInfo.userID === useUserStore.getState().selfInfo.userID,
    });
    userCardRef.current?.openOverlay();
  }, []);

  const openGroupCardWithData = useCallback((group: GroupItem) => {
    searchModalRef.current?.closeOverlay();
    const inGroup = useContactStore
      .getState()
      .groupList.some((g) => g.groupID === group.groupID);
    setGroupCardData({ ...group, inGroup });
    groupCardRef.current?.openOverlay();
  }, []);

  const runGlobalMessageSearch = async (keyword: string) => {
    const normalized = keyword.trim();
    if (!normalized) {
      setMessageResults([]);
      return;
    }
    setSearchingMessages(true);
    try {
      const routeConversationID = getRouteConversationID();
      const candidateMap = new Map<string, { conversationID: string }>();
      for (const conversation of conversationList.slice(0, 50)) {
        candidateMap.set(conversation.conversationID, conversation);
      }
      if (currentConversation?.conversationID) {
        candidateMap.set(currentConversation.conversationID, currentConversation);
      }
      if (routeConversationID) {
        candidateMap.set(routeConversationID, { conversationID: routeConversationID });
      }
      const results = await Promise.all(
        Array.from(candidateMap.values()).map(async (conversation) => {
          try {
            return await searchConversationMessages({
              sdk: IMSDK,
              conversationID: conversation.conversationID,
              keyword: normalized,
              seedMessages: getCachedConversationMessages(conversation.conversationID),
              maxHistoryPages: 2,
              pageSize: 20,
            });
          } catch {
            return [] as MessageItem[];
          }
        }),
      );
      setMessageResults(results.flat());
    } finally {
      setSearchingMessages(false);
    }
  };

  useEffect(() => {
    if (!globalSearchOpen) return;
    const timer = window.setTimeout(() => {
      void runGlobalMessageSearch(globalKeyword);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [globalKeyword, globalSearchOpen, conversationList, currentConversation]);

  const openConversation = async (
    conversationID: string,
    targetMessage?: MessageItem,
  ) => {
    const conversation = conversationList.find(
      (item) => item.conversationID === conversationID,
    );
    if (conversation) {
      await updateCurrentConversation(conversation);
    }
    navigate(`/chat/${conversationID}`);
    setGlobalSearchOpen(false);

    if (!targetMessage?.clientMsgID) {
      return;
    }

    try {
      const { data } = await IMSDK.fetchSurroundingMessages({
        startMessage: targetMessage,
        viewType: ViewType.History,
        before: 10,
        after: 10,
      });
      setTimeout(() => {
        replaceMessageListAndScroll(data.messageList, targetMessage.clientMsgID);
      }, 200);
    } catch {
      // Keep the conversation navigation even if local surrounding messages are unavailable.
    }
  };

  const searchedFriends = globalKeyword.trim()
    ? friendList.filter((friend) =>
        [friend.nickname, friend.remark, friend.userID]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(globalKeyword.toLowerCase())),
      )
    : [];
  const searchedGroups = globalKeyword.trim()
    ? groupList.filter((group) =>
        [group.groupName, group.groupID]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(globalKeyword.toLowerCase())),
      )
    : [];

  return (
    <div className="no-mobile app-drag flex h-10 min-h-[40px] items-center bg-[var(--top-search-bar)] dark:bg-[#141414]">
      <div className="flex w-full items-center justify-center">
        <Popover
          open={globalSearchOpen}
          onOpenChange={setGlobalSearchOpen}
          trigger="click"
          placement="bottom"
          arrow={false}
          content={
            <GlobalSearchResults
              friends={searchedFriends}
              groups={searchedGroups}
              messages={messageResults}
              loadingMessages={searchingMessages}
              onOpenUser={openUserCardWithData}
              onOpenGroup={openGroupCardWithData}
              onOpenConversation={openConversation}
            />
          }
        >
          <Input.Search
            className="app-no-drag w-1/3"
            size="small"
            placeholder="Search contacts, groups, messages"
            value={globalKeyword}
            onFocus={() => setGlobalSearchOpen(true)}
            onChange={(event) => setGlobalKeyword(event.target.value)}
            onSearch={(value) => void runGlobalMessageSearch(value)}
          />
        </Popover>
        <Popover
          content={<ActionPopContent actionClick={actionClick} />}
          arrow={false}
          title={null}
          trigger="click"
          placement="bottom"
          open={actionVisible}
          onOpenChange={(vis) => setActionVisible(vis)}
        >
          <img
            className="app-no-drag ml-8 cursor-pointer"
            width={20}
            src={show_more}
            alt=""
          />
        </Popover>
      </div>
      <WindowControlBar />
      <UserCardModal ref={userCardRef} {...userCardState} />
      <GroupCardModal ref={groupCardRef} groupData={groupCardData} />
      <ChooseModal ref={chooseModalRef} state={chooseModalState} />
      <SearchUserOrGroup
        ref={searchModalRef}
        isSearchGroup={isSearchGroup}
        openUserCardWithData={openUserCardWithData}
        openGroupCardWithData={openGroupCardWithData}
      />
      <RtcCallModal ref={rtcRef} inviteData={inviteData} />
    </div>
  );
};

function GlobalSearchResults({
  friends,
  groups,
  messages,
  loadingMessages,
  onOpenUser,
  onOpenGroup,
  onOpenConversation,
}: {
  friends: CardInfo[];
  groups: GroupItem[];
  messages: MessageItem[];
  loadingMessages: boolean;
  onOpenUser: (data: CardInfo) => void;
  onOpenGroup: (data: GroupItem) => void;
  onOpenConversation: (
    conversationID: string,
    targetMessage?: MessageItem,
  ) => Promise<void>;
}) {
  return (
    <div className="w-[420px]">
      <Tabs
        size="small"
        items={[
          {
            key: "contacts",
            label: `Contacts (${friends.length})`,
            children: (
              <List
                size="small"
                dataSource={friends}
                renderItem={(friend) => (
                  <List.Item
                    className="cursor-pointer"
                    onClick={() => onOpenUser(friend)}
                  >
                    <Typography.Text ellipsis>
                      {friend.nickname || friend.userID}
                    </Typography.Text>
                  </List.Item>
                )}
              />
            ),
          },
          {
            key: "groups",
            label: `Groups (${groups.length})`,
            children: (
              <List
                size="small"
                dataSource={groups}
                renderItem={(group) => (
                  <List.Item
                    className="cursor-pointer"
                    onClick={() => onOpenGroup(group)}
                  >
                    <Typography.Text ellipsis>
                      {group.groupName || group.groupID}
                    </Typography.Text>
                  </List.Item>
                )}
              />
            ),
          },
          {
            key: "messages",
            label: `Messages (${messages.length})`,
            children: (
              <List
                size="small"
                loading={loadingMessages}
                dataSource={messages}
                renderItem={(message) => (
                  <List.Item
                    className="cursor-pointer"
                    onClick={() =>
                      void onOpenConversation(String(message.conversationID), message)
                    }
                  >
                    <div className="min-w-0">
                      <div className="text-xs text-[var(--sub-text)]">
                        {message.senderNickname}
                      </div>
                      <Typography.Text className="block max-w-[360px]" ellipsis>
                        {getMessagePreview(message)}
                      </Typography.Text>
                    </div>
                  </List.Item>
                )}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

export default TopSearchBar;

const actionMenuList = [
  {
    idx: 0,
    title: t("placeholder.addFriends"),
    icon: add_friend,
  },
  {
    idx: 1,
    title: t("placeholder.addGroup"),
    icon: add_group,
  },
  {
    idx: 2,
    title: t("placeholder.createGroup"),
    icon: create_group,
  },
];

i18n.on("languageChanged", () => {
  actionMenuList[0].title = t("placeholder.addFriends");
  actionMenuList[1].title = t("placeholder.addGroup");
  actionMenuList[2].title = t("placeholder.createGroup");
});

const ActionPopContent = ({ actionClick }: { actionClick: (idx: number) => void }) => {
  return (
    <div className="p-1">
      {actionMenuList.map((action) => (
        <div
          className="flex cursor-pointer items-center rounded px-3 py-2 text-xs hover:bg-[var(--primary-active)]"
          key={action.idx}
          onClick={() => actionClick?.(action.idx)}
        >
          <img width={20} src={action.icon} alt="call_video" />
          <div className="ml-3">{action.title}</div>
        </div>
      ))}
    </div>
  );
};

function getRouteConversationID() {
  const hash = window.location.hash;
  const marker = "#/chat/";
  const index = hash.indexOf(marker);
  if (index < 0) return "";
  return decodeURIComponent(hash.slice(index + marker.length).split("?")[0] ?? "");
}
