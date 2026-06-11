import "./index.scss";
import "ckeditor5/ckeditor5.css";

import { CKEditor } from "@ckeditor/ckeditor5-react";
import { Bold, ClassicEditor, Essentials, Italic, Mention, Paragraph } from "ckeditor5";
import {
  forwardRef,
  ForwardRefRenderFunction,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";

export type CKEditorRef = {
  focus: (moveToEnd?: boolean) => void;
};

export interface MentionFeedItem {
  id: string;
  text: string;
}

interface CKEditorProps {
  value: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  onEnter?: () => void;
  mentionFeeds?: Array<{
    marker: string;
    feed: MentionFeedItem[];
    minimumCharacters?: number;
  }>;
}

export interface EmojiData {
  src: string;
  alt: string;
}

const keyCodes = {
  delete: 46,
  backspace: 8,
};

const Index: ForwardRefRenderFunction<CKEditorRef, CKEditorProps> = (
  { value, placeholder, onChange, onEnter, mentionFeeds },
  ref,
) => {
  const ckEditor = useRef<ClassicEditor | null>(null);

  const plugins = useMemo(() => {
    return [Essentials, Paragraph, Bold, Italic, Mention];
  }, []);

  const mentionFeedsRef = useRef(mentionFeeds);
  useEffect(() => {
    mentionFeedsRef.current = mentionFeeds;
  }, [mentionFeeds]);

  const buildMentionFeed = useCallback(
    (queryText: string) => {
      const feeds = mentionFeedsRef.current;
      if (!feeds || feeds.length === 0) return [];
      return feeds.flatMap((f) => {
        if (f.marker !== "@") return [];
        const q = queryText.toLowerCase();
        return f.feed.filter(
          (item) =>
            item.id.toLowerCase().includes(q) ||
            item.text.toLowerCase().includes(q),
        );
      });
    },
    [],
  );

  const mentionConfig = useMemo(() => {
    return {
      feeds: [
        {
          marker: "@",
          feed: buildMentionFeed,
          minimumCharacters: 0,
        },
      ],
    };
  }, [buildMentionFeed]);

  const focus = (moveToEnd = false) => {
    const editor = ckEditor.current;

    if (editor) {
      const model = editor.model;
      const view = editor.editing.view;
      const root = model.document.getRoot();
      if (moveToEnd && root) {
        const range = model.createRange(model.createPositionAt(root, "end"));

        model.change((writer) => {
          writer.setSelection(range);
        });
      }
      view.focus();
    }
  };

  const listenKeydown = (editor: ClassicEditor) => {
    editor.editing.view.document.on(
      "keydown",
      (evt, data) => {
        if (data.keyCode === 13 && !data.shiftKey) {
          data.preventDefault();
          evt.stop();
          onEnter?.();
          return;
        }
        if (data.keyCode === keyCodes.backspace || data.keyCode === keyCodes.delete) {
          const selection = editor.model.document.selection;
          const hasSelectContent = !editor.model.getSelectedContent(selection).isEmpty;
          const hasEditorContent = Boolean(editor.getData());

          if (!hasEditorContent) {
            return;
          }

          if (hasSelectContent) return;
        }
      },
      { priority: "high" },
    );
  };

  useImperativeHandle(
    ref,
    () => ({
      focus,
    }),
    [],
  );

  return (
    <CKEditor
      editor={ClassicEditor}
      data={value}
      config={{
        placeholder,
        toolbar: [],
        image: {
          toolbar: [],
          insert: {
            type: "inline",
          },
        },
        plugins,
        mention: mentionConfig,
      }}
      onReady={(editor) => {
        ckEditor.current = editor;
        listenKeydown(editor);
        focus(true);
      }}
      onChange={(event, editor) => {
        const data = editor.getData();
        onChange?.(data);
      }}
    />
  );
};

export default memo(forwardRef(Index));
