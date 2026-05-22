import { useState } from "react";
import { cmd } from "../commands";
import { Post } from "../types";
import { useStore } from "../store";

interface Props {
  post: Post;
  onClose: () => void;
}

export default function ReachOutModal({ post, onClose }: Props) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const { setAnonThreads } = useStore();

  const send = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      await cmd.reachOutAnon(post.id, message.trim());
      const threads = await cmd.getAnonThreads();
      setAnonThreads(threads);
      setSent(true);
    } catch (e) {
      console.error(e);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-20 p-4" onClick={onClose}>
      <div
        className="bg-white w-full max-w-sm rounded-2xl p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {sent ? (
          <div className="text-center py-4">
            <p className="text-3xl mb-3">◈</p>
            <p className="font-semibold text-gray-900 mb-1">Sent anonymously</p>
            <p className="text-sm text-gray-500">
              A thread will open here if they reply.
            </p>
            <button
              onClick={onClose}
              className="mt-5 w-full bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-medium"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <span className="font-semibold text-gray-900">Reach anonymously?</span>
              <button onClick={onClose} className="text-gray-400 text-xl leading-none">×</button>
            </div>
            <p className="text-xs text-gray-500 mb-4 leading-relaxed">
              They won't know it's you. A thread opens only if they reply.
            </p>
            <div className="bg-gray-50 rounded-xl p-3 mb-4 border border-gray-100">
              <p className="text-xs text-gray-400 mb-1"># anon · their post</p>
              <p className="text-sm text-gray-700 line-clamp-3">{post.content}</p>
            </div>
            <textarea
              autoFocus
              className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:border-indigo-300 min-h-[80px]"
              placeholder="Your first message…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <div className="flex gap-3 mt-3">
              <button
                onClick={onClose}
                className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={send}
                disabled={!message.trim() || sending}
                className="flex-1 bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-40"
              >
                {sending ? "Sending…" : "Send →"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
