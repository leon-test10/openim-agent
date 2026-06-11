export const replaceEmoji2Str = (text: string) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/html");

  const emojiEls: HTMLImageElement[] = Array.from(doc.querySelectorAll(".emojione"));
  emojiEls.map((face) => {
    // @ts-ignore
    const escapedOut = face.outerHTML.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    text = text.replace(new RegExp(escapedOut, "g"), face.alt);
  });
  return text;
};

export interface MentionMetadata {
  atUserID: string;
  groupNickname: string;
  mentionToken: string;
}

function replaceMentionToText(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const mentionEls = Array.from(doc.querySelectorAll("[data-mention]"));

  mentionEls.forEach((el) => {
    const mentionId = (el.getAttribute("data-mention") ?? el.textContent ?? "").trim();
    el.replaceWith(doc.createTextNode(mentionId));
  });

  return doc.body.innerHTML;
}

export function getMentionMetadata(html: string): MentionMetadata[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const mentionEls = Array.from(doc.querySelectorAll("[data-mention]"));
  const seen = new Set<string>();

  return mentionEls
    .map((el) => {
      const mentionToken = (el.getAttribute("data-mention") ?? "").trim();
      const atUserID = mentionToken.replace(/^@/, "").trim();
      const groupNickname = (el.textContent ?? "")
        .trim()
        .replace(/^@/, "")
        .trim();

      if (!atUserID || seen.has(atUserID)) return undefined;
      seen.add(atUserID);

      return {
        atUserID,
        groupNickname: groupNickname || atUserID,
        mentionToken: mentionToken || `@${atUserID}`,
      };
    })
    .filter((item): item is MentionMetadata => Boolean(item));
}

export const getCleanText = (html: string) => {
  let text = replaceEmoji2Str(html);
  text = replaceMentionToText(text);
  text = text.replace(/<\/p><p>/g, "\n");
  text = text.replace(/<br\s*[/]?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = convertChar(text);
  text = decodeHtmlEntities(text);
  return text.trim();
};

let textAreaDom: HTMLTextAreaElement | null = null;
const decodeHtmlEntities = (text: string) => {
  if (!textAreaDom) {
    textAreaDom = document.createElement("textarea");
  }
  textAreaDom.innerHTML = text;
  return textAreaDom.value;
};

export const convertChar = (text: string) => text.replace(/&nbsp;/gi, " ");

export const getCleanTextExceptImg = (html: string) => {
  html = replaceEmoji2Str(html);

  const regP = /<\/p><p>/g;
  html = html.replace(regP, "</p><br><p>");

  const regBr = /<br\s*\/?>/gi;
  html = html.replace(regBr, "\n");

  const regWithoutHtmlExceptImg = /<(?!img\s*\/?)[^>]+>/gi;
  return html.replace(regWithoutHtmlExceptImg, "");
};
