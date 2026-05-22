import { useEffect, useState } from "react";
import { cmd } from "../commands";
import { useStore } from "../store";
import Header from "../components/Header";
import ChatThread from "./ChatThread";
import AnonThread from "./AnonThread";
import { Conversation, AnonThread as AnonThreadType } from "../types";

function timeAgo(ts: number | null): string {
  if (!ts) return "";
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function initials(name: string | null): string {
  if (!name) return "?";
  return name.slice(0, 1).toUpperCase();
}

export default function ChatsPage() {
  const { conversations, setConversations, anonThreads, setAnonThreads } = useStore();
  const [openConvo, setOpenConvo] = useState<string | null>(null);
  const [openAnon, setOpenAnon] = useState<AnonThreadType | null>(null);

  useEffect(() => {
    cmd.getConversations().then(setConversations).catch(console.error);
    cmd.getAnonThreads().then(setAnonThreads).catch(console.error);
  }, [setConversations, setAnonThreads]);

  if (openConvo) {
    return (
      <ChatThread
        friendId={openConvo}
        nickname={conversations.find((c) => c.friend_id === openConvo)?.nickname ?? null}
        onBack={() => setOpenConvo(null)}
      />
    );
  }

  if (openAnon) {
    return <AnonThread thread={openAnon} onBack={() => setOpenAnon(null)} />;
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Chats" />
      <div className="flex-1 overflow-y-auto pb-16">
        {/* DMs */}
        {conversations.length === 0 && anonThreads.length === 0 && (
          <p className="text-center text-gray-400 text-sm mt-16">
            No chats yet. Add a friend to start messaging.
          </p>
        )}
        {conversations.map((c) => (
          <ConvoRow key={c.friend_id} convo={c} onClick={() => setOpenConvo(c.friend_id)} />
        ))}

        {/* Anon threads */}
        {anonThreads.length > 0 && (
          <>
            <div className="px-4 pt-5 pb-2">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                Anonymous threads
              </span>
            </div>
            {anonThreads.map((t) => (
              <AnonRow key={t.id} thread={t} onClick={() => setOpenAnon(t)} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function ConvoRow({ convo, onClick }: { convo: Conversation; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 border-b border-gray-100 text-left"
    >
      <div className="w-11 h-11 rounded-full bg-indigo-100 text-indigo-700 font-semibold flex items-center justify-center shrink-0">
        {initials(convo.nickname)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline">
          <span className="font-medium text-gray-900 text-sm">
            {convo.nickname ?? convo.friend_id.slice(0, 8)}
          </span>
          <span className="text-xs text-gray-400">{timeAgo(convo.last_message_at)}</span>
        </div>
        <p className="text-xs text-gray-500 truncate mt-0.5">
          {convo.last_message ?? "No messages yet"}
        </p>
      </div>
      {convo.unread_count > 0 && (
        <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center shrink-0">
          {convo.unread_count}
        </span>
      )}
    </button>
  );
}

function AnonRow({ thread, onClick }: { thread: AnonThreadType; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 border-b border-gray-100 text-left"
    >
      <div className="w-11 h-11 rounded-full bg-gray-100 text-gray-500 font-semibold flex items-center justify-center shrink-0 text-lg">
        ?
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline">
          <span className="font-medium text-gray-700 text-sm truncate max-w-[180px]">
            "{thread.post_snippet}"
          </span>
          <span className="text-xs text-gray-400">{timeAgo(thread.last_message_at)}</span>
        </div>
        <p className="text-xs text-gray-500 truncate mt-0.5">
          {thread.last_message ?? "No messages yet"}
        </p>
      </div>
    </button>
  );
}
