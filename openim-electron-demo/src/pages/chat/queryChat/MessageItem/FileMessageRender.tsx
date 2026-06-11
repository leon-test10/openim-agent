import { FileOutlined } from "@ant-design/icons";
import { MessageStatus } from "@openim/wasm-client-sdk";
import { Button, Spin } from "antd";
import { FC } from "react";

import { IMessageItemProps } from ".";

const FileMessageRender: FC<IMessageItemProps> = ({ message }) => {
  const file = message.fileElem;
  const isSending = message.status === MessageStatus.Sending;
  const sourceUrl = file?.sourceUrl || file?.filePath;

  return (
    <Spin spinning={isSending}>
      <div className="flex max-w-[320px] items-center gap-3 rounded-md bg-[var(--chat-bubble)] px-3 py-2">
        <FileOutlined className="text-xl text-[var(--primary)]" rev={undefined} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{file?.fileName ?? "File"}</div>
          <div className="mt-1 text-xs text-[var(--sub-text)]">
            {formatFileSize(file?.fileSize ?? 0)}
          </div>
        </div>
        {sourceUrl ? (
          <Button size="small" href={sourceUrl} target="_blank" rel="noreferrer">
            Open
          </Button>
        ) : null}
      </div>
    </Spin>
  );
};

function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default FileMessageRender;
