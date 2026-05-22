import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { cmd } from "../commands";
import { Post } from "../types";
import { useStore } from "../store";
import Header from "../components/Header";
import ComposeModal from "../components/ComposeModal";
import ReachOutModal from "../components/ReachOutModal";

function timeAgo(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function FeedPage() {
  const { feed, setFeed } = useStore();
  const [composing, setComposing] = useState(false);
  const [reachingPost, setReachingPost] = useState<Post | null>(null);

  useEffect(() => {
    cmd.getFeed().then(setFeed).catch(console.error);
  }, [setFeed]);

  useEffect(() => {
    const unlisten = listen<Post>("feed:new_post", (event) => {
      const incoming: Post = { ...event.payload, reactions: {}, my_reactions: [] };
      const current = useStore.getState().feed;
      if (!current.some((p) => p.id === incoming.id)) {
        useStore.getState().setFeed([incoming, ...current]);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handleReact = async (postId: string, emoji: string) => {
    await cmd.reactToPost(postId, emoji);
    cmd.getFeed().then(setFeed).catch(console.error);
  };

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Feed"
        action={
          <button
            onClick={() => setComposing(true)}
            className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center text-lg leading-none"
          >
            +
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto pb-16 px-3 pt-3 space-y-3">
        {feed.length === 0 && (
          <div className="text-center text-gray-400 mt-16 text-sm">
            <p className="text-3xl mb-3">◈</p>
            <p>No posts yet.</p>
            <p>Add friends and posts will appear here.</p>
          </div>
        )}
        {feed.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onReact={handleReact}
            onReach={() => setReachingPost(post)}
          />
        ))}
      </div>

      {composing && (
        <ComposeModal
          onClose={() => setComposing(false)}
          onPost={async (content) => {
            await cmd.createPost(content);
            setComposing(false);
            cmd.getFeed().then(setFeed).catch(console.error);
          }}
        />
      )}

      {reachingPost && (
        <ReachOutModal
          post={reachingPost}
          onClose={() => setReachingPost(null)}
        />
      )}
    </div>
  );
}

function PostCard({
  post,
  onReact,
  onReach,
}: {
  post: Post;
  onReact: (id: string, emoji: string) => void;
  onReach: () => void;
}) {
  const heartCount = post.reactions["❤"] ?? 0;
  const waveCount = post.reactions["~"] ?? 0;
  const liked = post.my_reactions.includes("❤");
  const waved = post.my_reactions.includes("~");

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-indigo-400 text-sm font-mono"># anon</span>
        <span className="text-gray-300">·</span>
        <span className="text-gray-400 text-xs">{timeAgo(post.timestamp)}</span>
        {post.is_own && (
          <span className="ml-auto text-xs text-indigo-400 font-medium">you</span>
        )}
      </div>
      <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">
        {post.content}
      </p>
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-50">
        <button
          onClick={() => onReact(post.id, "❤")}
          className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors ${
            liked
              ? "border-red-200 bg-red-50 text-red-500"
              : "border-gray-200 text-gray-500 hover:border-red-200 hover:text-red-400"
          }`}
        >
          ♥ {heartCount}
        </button>
        <button
          onClick={() => onReact(post.id, "~")}
          className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors ${
            waved
              ? "border-indigo-200 bg-indigo-50 text-indigo-500"
              : "border-gray-200 text-gray-500 hover:border-indigo-200 hover:text-indigo-400"
          }`}
        >
          ~ {waveCount}
        </button>
        {!post.is_own && (
          <button
            onClick={onReach}
            className="ml-auto text-xs px-3 py-1 rounded-full border border-indigo-200 text-indigo-600 hover:bg-indigo-50 transition-colors"
          >
            Reach
          </button>
        )}
      </div>
    </div>
  );
}
