import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { cmd } from "../commands";
import { Message } from "../types";
import { useStore } from "../store";
import Header from "../components/Header";
import ChatBubble, { BubbleMessage } from "../components/ChatBubble";
import MessageInput from "../components/MessageInput";

interface Props {
  friendId: string;
  nickname: string | null;
  onBack: () => void;
}

export default function ChatThread({ friendId, nickname, onBack }: Props) {
  const { identity } = useStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    cmd.getMessages(friendId).then(setMessages).catch(console.error);
  }, [friendId]);

  useEffect(() => {
    const unlisten = listen<{ friend_id: string; message: Message }>(
      "chat:new_message",
      (event) => {
        if (event.payload.friend_id === friendId) {
          setMessages((prev) => {
            const msg = event.payload.message;
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        }
      }
    );
    return () => { unlisten.then((fn) => fn()); };
  }, [friendId]);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    const msg = await cmd.sendMessage(friendId, text.trim());
    setMessages((prev) => [...prev, msg]);
    setText("");
    setSending(false);
  };

  const name = nickname ?? friendId.slice(0, 8);
  const initial = name.slice(0, 1).toUpperCase();

  const bubbles: BubbleMessage[] = messages.map((m) => ({
    id: m.id,
    plaintext: m.plaintext,
    timestamp: m.timestamp,
    isMe: m.sender_id === identity?.user_id,
    status: m.sender_id === identity?.user_id ? (m.status as BubbleMessage["status"]) : undefined,
  }));

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <Header title={name} onBack={onBack} />
      <ChatBubble messages={bubbles} incomingInitial={initial} />
      <MessageInput
        value={text}
        onChange={setText}
        onSend={send}
        placeholder={`Message ${name}…`}
        disabled={sending}
      />
    </div>
  );
}
