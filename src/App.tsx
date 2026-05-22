import { useEffect } from "react";
import { cmd } from "./commands";
import { useStore } from "./store";
import BottomNav from "./components/BottomNav";
import FeedPage from "./pages/Feed";
import ChatsPage from "./pages/Chats";
import FriendsPage from "./pages/Friends";
import MePage from "./pages/Me";
import ChatThread from "./pages/ChatThread";
import AnonThread from "./pages/AnonThread";
import AddFriend from "./pages/AddFriend";

export default function App() {
  const { identity, setIdentity, activeTab, navScreen, popNav, setFriends } = useStore();

  useEffect(() => {
    cmd.getOrCreateIdentity().then(setIdentity).catch(console.error);
  }, [setIdentity]);

  if (!identity) {
    return (
      <div className="h-screen flex items-center justify-center text-gray-400 text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 max-w-md mx-auto relative overflow-hidden">
      {/* Tab pages */}
      <main className="flex-1 min-h-0 flex flex-col">
        {activeTab === "feed"    && <FeedPage />}
        {activeTab === "chats"   && <ChatsPage />}
        {activeTab === "friends" && <FriendsPage />}
        {activeTab === "me"      && <MePage />}
      </main>
      <BottomNav />

      {/* Full-screen overlay for sub-pages — sits above BottomNav */}
      {navScreen && (
        <div className="absolute inset-0 z-20 flex flex-col bg-gray-50">
          {navScreen.type === "chat" && (
            <ChatThread
              friendId={navScreen.friendId}
              nickname={navScreen.nickname}
              onBack={popNav}
            />
          )}
          {navScreen.type === "anon" && (
            <AnonThread thread={navScreen.thread} onBack={popNav} />
          )}
          {navScreen.type === "add-friend" && (
            <AddFriend
              onBack={() => {
                popNav();
                cmd.getFriends().then(setFriends).catch(console.error);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
