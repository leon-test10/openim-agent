import { v4 as uuidV4 } from "uuid";

import { IMSDK } from "@/layout/MainContentWrap";

export interface FileWithPath extends File {
  path?: string;
}

export function useFileMessage() {
  const getImageMessage = async (file: FileWithPath) => {
    const { width, height } = await getPicInfo(file);
    const baseInfo = {
      uuid: uuidV4(),
      type: file.type,
      size: file.size,
      width,
      height,
      url: URL.createObjectURL(file),
    };

    if (window.electronAPI) {
      const imageMessage = (await IMSDK.createImageMessageFromFullPath(file.path!))
        .data;
      imageMessage.pictureElem!.sourcePicture.url = baseInfo.url;
      return imageMessage;
    }
    const options = {
      sourcePicture: baseInfo,
      bigPicture: baseInfo,
      snapshotPicture: baseInfo,
      sourcePath: "",
      file,
    };

    return (await IMSDK.createImageMessageByFile(options)).data;
  };

  const getPicInfo = (file: File): Promise<HTMLImageElement> =>
    new Promise((resolve) => {
      const _URL = window.URL || window.webkitURL;
      const img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.src = _URL.createObjectURL(file);
    });

  const getNormalFileMessage = async (file: FileWithPath) => {
    if (window.electronAPI) {
      return (
        await IMSDK.createFileMessageFromFullPath({
          filePath: file.path!,
          fileName: file.name,
        })
      ).data;
    }

    return (
      await IMSDK.createFileMessageByFile({
        filePath: "",
        fileName: file.name,
        uuid: uuidV4(),
        sourceUrl: URL.createObjectURL(file),
        fileSize: file.size,
        fileType: file.type,
        file,
      })
    ).data;
  };

  return {
    getImageMessage,
    getNormalFileMessage,
  };
}
