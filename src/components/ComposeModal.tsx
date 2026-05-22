import { useState } from "react";

interface Props {
  onClose: () => void;
  onPost: (content: string) => Promise<void>;
}

export default function ComposeModal({ onClose, onPost }: Props) {
  const [content, setContent] = useState("");
  const [posting, setPosting] = useState(false);

  const submit = async () => {
    if (!content.trim()) return;
    setPosting(true);
    try {
      await onPost(content.trim());
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end z-20" onClick={onClose}>
      <div
        className="bg-white w-full rounded-t-2xl p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="font-semibold text-gray-900">New post</span>
          <button onClick={onClose} className="text-gray-400 text-xl leading-none">×</button>
        </div>
        <p className="text-xs text-gray-400 mb-3">
          Posted anonymously — friends won't see your name.
        </p>
        <textarea
          autoFocus
          className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:border-indigo-300 min-h-[120px]"
          placeholder="What's on your mind?"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <button
          onClick={submit}
          disabled={!content.trim() || posting}
          className="mt-3 w-full bg-indigo-600 text-white rounded-xl py-3 text-sm font-medium disabled:opacity-40 hover:bg-indigo-700 transition-colors"
        >
          {posting ? "Posting…" : "Post anonymously"}
        </button>
      </div>
    </div>
  );
}
