import { create } from "zustand";
import { Identity, Friend, Post, Conversation, AnonThread } from "./types";

export type NavScreen =
  | { type: "chat"; friendId: string; nickname: string | null }
  | { type: "anon"; thread: AnonThread }
  | { type: "add-friend" };

interface AppState {
  identity: Identity | null;
  friends: Friend[];
  conversations: Conversation[];
  feed: Post[];
  anonThreads: AnonThread[];
  activeTab: "feed" | "chats" | "friends" | "me";
  navScreen: NavScreen | null;

  setIdentity: (id: Identity) => void;
  setFriends: (f: Friend[]) => void;
  setConversations: (c: Conversation[]) => void;
  setFeed: (p: Post[]) => void;
  setAnonThreads: (t: AnonThread[]) => void;
  setActiveTab: (tab: AppState["activeTab"]) => void;
  pushNav: (screen: NavScreen) => void;
  popNav: () => void;
}

export const useStore = create<AppState>((set) => ({
  identity: null,
  friends: [],
  conversations: [],
  feed: [],
  anonThreads: [],
  activeTab: "feed",
  navScreen: null,

  setIdentity: (identity) => set({ identity }),
  setFriends: (friends) => set({ friends }),
  setConversations: (conversations) => set({ conversations }),
  setFeed: (feed) => set({ feed }),
  setAnonThreads: (anonThreads) => set({ anonThreads }),
  setActiveTab: (activeTab) => set({ activeTab }),
  pushNav: (navScreen) => set({ navScreen }),
  popNav: () => set({ navScreen: null }),
}));
