import { useStore } from "../store";

const tabs = [
  { id: "feed" as const, label: "Feed", icon: "▦" },
  { id: "chats" as const, label: "Chats", icon: "✉" },
  { id: "friends" as const, label: "Friends", icon: "✦" },
  { id: "me" as const, label: "Me", icon: "◉" },
];

export default function BottomNav() {
  const { activeTab, setActiveTab } = useStore();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex h-16 z-10">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors ${
            activeTab === tab.id
              ? "text-indigo-600"
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          <span className="text-lg leading-none">{tab.icon}</span>
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
