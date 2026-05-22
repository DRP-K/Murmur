import { useEffect } from "react";
import { cmd } from "./commands";
import { useStore } from "./store";
import BottomNav from "./components/BottomNav";
import FeedPage from "./pages/Feed";
import ChatsPage from "./pages/Chats";
import FriendsPage from "./pages/Friends";
import MePage from "./pages/Me";

export default function App() {
  const { identity, setIdentity, activeTab } = useStore();

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
      <main className="flex-1 overflow-hidden flex flex-col">
        {activeTab === "feed" && <FeedPage />}
        {activeTab === "chats" && <ChatsPage />}
        {activeTab === "friends" && <FriendsPage />}
        {activeTab === "me" && <MePage />}
      </main>
      <BottomNav />
    </div>
  );
}
