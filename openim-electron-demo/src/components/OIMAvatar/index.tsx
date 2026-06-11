import { Avatar as AntdAvatar, AvatarProps } from "antd";
import clsx from "clsx";
import * as React from "react";
import { useMemo } from "react";

import default_group from "@/assets/images/contact/group.png";
import { avatarList, getDefaultAvatar } from "@/utils/avatar";

const default_avatars = avatarList.map((item) => item.name);

interface IOIMAvatarProps extends AvatarProps {
  text?: string;
  color?: string;
  bgColor?: string;
  isgroup?: boolean;
  isnotification?: boolean;
  size?: number;
}

const OIMAvatar: React.FC<IOIMAvatarProps> = (props) => {
  const {
    src,
    text,
    size = 42,
    color = "#fff",
    bgColor = "#0289FA",
    isgroup = false,
  } = props;
  const [errorHolder, setErrorHolder] = React.useState<string>();
  const fallbackText = useMemo(() => compactAvatarText(text), [text]);

  const getAvatarUrl = useMemo(() => {
    if (src) {
      if (default_avatars.includes(src as string))
        return getDefaultAvatar(src as string);

      return src;
    }
    return isgroup ? default_group : undefined;
  }, [src, isgroup]);

  const avatarProps = {
    ...props,
    text: undefined,
    isgroup: undefined,
    isnotification: undefined,
  };

  React.useEffect(() => {
    if (!isgroup) {
      setErrorHolder(undefined);
    }
  }, [isgroup]);

  const errorHandler = () => {
    if (isgroup) {
      setErrorHolder(default_group);
      return false;
    }
    return true;
  };

  return (
    <AntdAvatar
      style={{
        backgroundColor: bgColor,
        minWidth: `${size}px`,
        minHeight: `${size}px`,
        lineHeight: `${size - 2}px`,
        color,
      }}
      shape="square"
      {...avatarProps}
      className={clsx(
        {
          "cursor-pointer": Boolean(props.onClick),
        },
        props.className,
      )}
      src={errorHolder ?? getAvatarUrl}
      onError={errorHandler}
    >
      {fallbackText}
    </AntdAvatar>
  );
};

function compactAvatarText(text: string | undefined) {
  const normalized = text?.trim();
  if (!normalized) return "";

  const words = normalized.match(/[A-Za-z0-9]+/g);
  if (words?.length) {
    if (words.length >= 2) {
      return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
    }
    return words[0].slice(0, 2).toUpperCase();
  }

  return Array.from(normalized).slice(0, 2).join("");
}

export default OIMAvatar;
