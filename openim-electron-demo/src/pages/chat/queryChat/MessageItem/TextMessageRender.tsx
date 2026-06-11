import { FC } from "react";

import { formatBr } from "@/utils/common";

import { IMessageItemProps } from ".";
import styles from "./message-item.module.scss";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const TextMessageRender: FC<IMessageItemProps> = ({ message }) => {
  let content = message.atTextElem?.text || message.textElem?.content || "";
  const atUserList = message.atTextElem?.atUserList ?? [];

  content = formatBr(escapeHtml(content));
  atUserList
    .sort((a, b) => b.length - a.length)
    .forEach((userID) => {
      const escapedToken = escapeHtml(`@${userID}`).replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );
      content = content.replace(
        new RegExp(escapedToken, "g"),
        `<span class="${styles["at-text"]}">@${userID}</span>`,
      );
    });

  return (
    <div className={styles.bubble} dangerouslySetInnerHTML={{ __html: content }}></div>
  );
};

export default TextMessageRender;
