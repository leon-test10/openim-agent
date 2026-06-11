import { MessageItem } from "@openim/wasm-client-sdk";
import { Popover, PopoverProps, Upload } from "antd";
import { TooltipPlacement } from "antd/es/tooltip";
import clsx from "clsx";
import i18n, { t } from "i18next";
import { UploadRequestOption } from "rc-upload/lib/interface";
import { memo, ReactNode, useState } from "react";
import React from "react";

import fileIcon from "@/assets/images/chatFooter/file.png";
import image from "@/assets/images/chatFooter/image.png";
import rtc from "@/assets/images/chatFooter/rtc.png";
import { useConversationStore } from "@/store";

import { SendMessageParams } from "../useSendMessage";
import CallPopContent from "./CallPopContent";

const sendActionList = [
  {
    title: t("placeholder.image"),
    icon: image,
    key: "image",
    accept: "image/*",
    comp: null,
    placement: undefined,
  },
  {
    title: "File",
    icon: fileIcon,
    key: "file",
    accept: "*",
    comp: null,
    placement: undefined,
  },
  {
    title: t("placeholder.call"),
    icon: rtc,
    key: "rtc",
    accept: undefined,
    comp: <CallPopContent />,
    placement: "top",
  },
];

i18n.on("languageChanged", () => {
  sendActionList[0].title = t("placeholder.image");
  sendActionList[1].title = t("placeholder.call");
});

const SendActionBar = ({
  sendMessage,
  getImageMessage,
  getNormalFileMessage,
}: {
  sendMessage: (params: SendMessageParams) => Promise<void>;
  getImageMessage: (file: File) => Promise<MessageItem>;
  getNormalFileMessage: (file: File) => Promise<MessageItem>;
}) => {
  const [visibleState, setVisibleState] = useState(false);
  const isGroupSession = useConversationStore((state) =>
    Boolean(state.currentConversation?.groupID),
  );

  const closePop = () => setVisibleState(false);

  const fileHandle = async (options: UploadRequestOption) => {
    const file = options.file as File;
    const message =
      file.type.startsWith("image/") &&
      (options as UploadRequestOption & { actionKey?: string }).actionKey !== "file"
        ? await getImageMessage(file)
        : await getNormalFileMessage(file);
    sendMessage({
      message,
    });
  };

  return (
    <div className="flex items-center px-4.5 pt-2">
      {sendActionList.map((action) => {
        if (action.key === "rtc" && isGroupSession) {
          return null;
        }
        const popProps: PopoverProps = {
          placement: action.placement as TooltipPlacement,
          content:
            action.comp &&
            React.cloneElement(action.comp as React.ReactElement, {
              closePop,
            }),
          title: null,
          arrow: false,
          trigger: "click",
          // @ts-ignore
          open: action.comp ? visibleState : false,
          onOpenChange: (visible) => setVisibleState(visible),
        };

        return (
          <ActionWrap
            popProps={popProps}
            key={action.key}
            accept={action.accept}
            fileHandle={fileHandle}
            actionKey={action.key}
          >
            <div
              className={clsx("flex cursor-pointer items-center last:mr-0", {
                "mr-5": !action.accept,
              })}
            >
              <img src={action.icon} width={20} alt={action.title} />
            </div>
          </ActionWrap>
        );
      })}
    </div>
  );
};

export default memo(SendActionBar);

const ActionWrap = ({
  accept,
  popProps,
  children,
  fileHandle,
  actionKey,
}: {
  accept?: string;
  children: ReactNode;
  popProps?: PopoverProps;
  fileHandle: (options: UploadRequestOption) => Promise<void>;
  actionKey: string;
}) => {
  return accept ? (
    <Upload
      showUploadList={false}
      customRequest={(options) =>
        void fileHandle({ ...options, actionKey } as UploadRequestOption & {
          actionKey: string;
        })
      }
      accept={accept === "*" ? undefined : accept}
      multiple
      className="mr-5 flex"
    >
      {children}
    </Upload>
  ) : (
    <Popover {...popProps}>{children}</Popover>
  );
};
