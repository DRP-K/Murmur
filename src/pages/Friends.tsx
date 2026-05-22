import { useEffect } from "react";
import { cmd } from "../commands";
import { Friend } from "../types";
import { useStore } from "../store";
import Header from "../components/Header";

function timeAgo(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 86400) return "today";
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export default function FriendsPage() {
  const { friends, setFriends, pushNav } = useStore();

  useEffect(() => {
    cmd.getFriends().then(setFriends).catch(console.error);
  }, [setFriends]);

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Friends"
        action={
          <button
            onClick={() => pushNav({ type: "add-friend" })}
            className="text-sm text-indigo-600 font-medium hover:text-indigo-700"
          >
            + Add
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto pb-16">
        {friends.length === 0 && (
          <div className="text-center text-gray-400 mt-16 text-sm px-8">
            <p className="text-3xl mb-3">✦</p>
            <p>No friends yet.</p>
            <p className="mt-1">Meet someone and scan their QR code.</p>
            <button
              onClick={() => pushNav({ type: "add-friend" })}
              className="mt-5 px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium"
            >
              Add friend
            </button>
          </div>
        )}
        {friends.map((f) => (
          <FriendRow key={f.user_id} friend={f} />
        ))}
      </div>
    </div>
  );
}

function FriendRow({ friend }: { friend: Friend }) {
  const initial = (friend.nickname ?? "?").slice(0, 1).toUpperCase();
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
      <div className="w-11 h-11 rounded-full bg-indigo-100 text-indigo-700 font-semibold flex items-center justify-center shrink-0">
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 text-sm">
          {friend.nickname ?? friend.user_id.slice(0, 12)}
        </p>
        <p className="text-xs text-gray-400">Added {timeAgo(friend.added_at)}</p>
      </div>
    </div>
  );
}
