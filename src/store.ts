import { create } from "zustand";
import { Identity, Friend, Post, Conversation, AnonThread } from "./types";

interface AppState {
  identity: Identity | null;
  friends: Friend[];
  conversations: Conversation[];
  feed: Post[];
  anonThreads: AnonThread[];
  activeTab: "feed" | "chats" | "friends" | "me";

  setIdentity: (id: Identity) => void;
  setFriends: (f: Friend[]) => void;
  setConversations: (c: Conversation[]) => void;
  setFeed: (p: Post[]) => void;
  setAnonThreads: (t: AnonThread[]) => void;
  setActiveTab: (tab: AppState["activeTab"]) => void;
}

export const useStore = create<AppState>((set) => ({
  identity: null,
  friends: [],
  conversations: [],
  feed: [],
  anonThreads: [],
  activeTab: "feed",

  setIdentity: (identity) => set({ identity }),
  setFriends: (friends) => set({ friends }),
  setConversations: (conversations) => set({ conversations }),
  setFeed: (feed) => set({ feed }),
  setAnonThreads: (anonThreads) => set({ anonThreads }),
  setActiveTab: (activeTab) => set({ activeTab }),
}));
