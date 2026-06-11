import { CloseOutlined } from "@ant-design/icons";
import { GroupItem, WSEvent } from "@openim/wasm-client-sdk/lib/types/entity";
import { Button, Input, InputRef, List } from "antd";
import { t } from "i18next";
import {
  forwardRef,
  ForwardRefRenderFunction,
  memo,
  useEffect,
  useRef,
  useState,
} from "react";

import { message } from "@/AntdGlobalComp";
import { searchBusinessUserInfo } from "@/api/login";
import OIMAvatar from "@/components/OIMAvatar";
import DraggableModalWrap from "@/components/DraggableModalWrap";
import { OverlayVisibleHandle, useOverlayVisible } from "@/hooks/useOverlayVisible";
import { CardInfo } from "@/pages/common/UserCardModal";
import { useContactStore } from "@/store";
import { feedbackToast } from "@/utils/common";

import { IMSDK } from "../MainContentWrap";

interface ISearchUserOrGroupProps {
  isSearchGroup: boolean;
  openUserCardWithData: (data: CardInfo) => void;
  openGroupCardWithData: (data: GroupItem) => void;
}

const SearchUserOrGroup: ForwardRefRenderFunction<
  OverlayVisibleHandle,
  ISearchUserOrGroupProps
> = ({ isSearchGroup, openUserCardWithData, openGroupCardWithData }, ref) => {
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [userCandidates, setUserCandidates] = useState<CardInfo[]>([]);
  const inputRef = useRef<InputRef>(null);
  const { isOverlayOpen, closeOverlay } = useOverlayVisible(ref);

  useEffect(() => {
    if (isOverlayOpen) {
      setTimeout(() => inputRef.current?.focus());
    }
  }, [isOverlayOpen]);

  const searchData = async () => {
    if (!keyword) return;
    setLoading(true);
    if (isSearchGroup) {
      try {
        const { data } = await IMSDK.getSpecifiedGroupsInfo([keyword]);
        const groupInfo = data[0];
        setLoading(false);
        if (!groupInfo) {
          message.warning(t("empty.noSearchResults"));
          return;
        }
        openGroupCardWithData(groupInfo);
      } catch (error) {
        setLoading(false);
        if ((error as WSEvent).errCode === 1004) {
          message.warning(t("empty.noSearchResults"));
          return;
        }
        feedbackToast({ error });
      }
    } else {
      try {
        const {
          data: { users },
        } = await searchBusinessUserInfo(keyword, {
          pageNumber: 1,
          showNumber: 20,
        });
        setLoading(false);
        if (!users?.length) {
          setUserCandidates([]);
          message.warning(t("empty.noSearchResults"));
          return;
        }
        const normalizedKeyword = keyword.trim().toLowerCase();
        const friendList = useContactStore.getState().friendList;
        const candidates = users
          .map((user) => {
            const friendInfo = friendList.find((friend) => friend.userID === user.userID);
            return {
              ...(friendInfo ?? {}),
              ...user,
            };
          })
          .sort(
            (left, right) =>
              scoreCandidate(right, normalizedKeyword) -
              scoreCandidate(left, normalizedKeyword),
          );
        setUserCandidates(candidates);
      } catch (error) {
        setLoading(false);
        setUserCandidates([]);
        if ((error as WSEvent).errCode === 1004) {
          message.warning(t("empty.noSearchResults"));
          return;
        }
        feedbackToast({ error });
      }
    }
  };

  return (
    <DraggableModalWrap
      title={null}
      footer={null}
      open={isOverlayOpen}
      closable={false}
      width={332}
      onCancel={closeOverlay}
      styles={{
        mask: {
          opacity: 0,
          transition: "none",
        },
      }}
      afterClose={() => {
        setKeyword("");
        setUserCandidates([]);
      }}
      ignoreClasses=".ignore-drag, .cursor-pointer"
      className="no-padding-modal"
      maskTransitionName=""
    >
      <div className="flex h-12 items-center justify-between bg-[var(--gap-text)] px-5.5">
        <div>
          {isSearchGroup ? t("placeholder.addGroup") : t("placeholder.addFriends")}
        </div>
        <CloseOutlined
          className="cursor-pointer text-[var(--sub-text)]"
          rev={undefined}
          onClick={closeOverlay}
        />
      </div>
      <div className="ignore-drag">
        <div className="border-b border-[var(--gap-text)] px-5.5 py-6">
          <Input.Search
            ref={inputRef}
            className="no-addon-search"
            placeholder={t("placeholder.pleaseEnter")}
            value={keyword}
            addonAfter={null}
            spellCheck={false}
            onChange={(e) => {
              setKeyword(e.target.value);
              if (!e.target.value.trim()) {
                setUserCandidates([]);
              }
            }}
            onSearch={searchData}
          />
        </div>
        {!isSearchGroup && userCandidates.length > 0 ? (
          <div className="max-h-64 overflow-y-auto border-b border-[var(--gap-text)] px-5.5 py-3">
            <div className="mb-2 text-xs text-[var(--sub-text)]">
              {t("placeholder.friendSearchCandidates")}
            </div>
            <List
              dataSource={userCandidates}
              renderItem={(item) => (
                <List.Item
                  className="cursor-pointer rounded px-2 py-2 hover:bg-[var(--primary-active)]"
                  onClick={() => openUserCardWithData(item)}
                >
                  <div className="flex w-full items-center gap-3">
                    <OIMAvatar
                      size={40}
                      src={item.faceURL}
                      text={item.nickname || item.userID}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {item.nickname || item.userID}
                      </div>
                      <div className="truncate text-xs text-[var(--sub-text)]">
                        {item.userID}
                        {item.phoneNumber ? ` / ${item.phoneNumber}` : ""}
                      </div>
                    </div>
                    <div className="text-xs text-[var(--primary)]">
                      {t("placeholder.verifyAdd")}
                    </div>
                  </div>
                </List.Item>
              )}
            />
          </div>
        ) : null}
        <div className="flex justify-end px-5.5 py-2.5">
          <Button
            loading={loading}
            className="px-6"
            type="primary"
            disabled={!keyword}
            onClick={searchData}
          >
            {t("confirm")}
          </Button>
          <Button
            className="ml-3 border-0 bg-[var(--chat-bubble)] px-6"
            onClick={closeOverlay}
          >
            {t("cancel")}
          </Button>
        </div>
      </div>
    </DraggableModalWrap>
  );
};

export default memo(forwardRef(SearchUserOrGroup));

function scoreCandidate(candidate: CardInfo, normalizedKeyword: string) {
  const fields = [candidate.userID, candidate.phoneNumber, candidate.nickname]
    .filter(Boolean)
    .map((value) => value!.toLowerCase());
  let score = 0;
  for (const field of fields) {
    if (field === normalizedKeyword) score += 100;
    else if (field.startsWith(normalizedKeyword)) score += 10;
    else if (field.includes(normalizedKeyword)) score += 1;
  }
  return score;
}
