import { useEffect, useState } from "react";
import { cmd } from "../commands";
import { AnonThread as AnonThreadType, AnonMessage } from "../types";
import Header from "../components/Header";
import ChatBubble, { BubbleMessage } from "../components/ChatBubble";
import MessageInput from "../components/MessageInput";

interface Props {
  thread: AnonThreadType;
  onBack: () => void;
}

export default function AnonThread({ thread, onBack }: Props) {
  const [messages, setMessages] = useState<AnonMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [status, setStatus] = useState(thread.status);

  useEffect(() => {
    cmd.getAnonMessages(thread.id).then(setMessages).catch(console.error);
  }, [thread.id]);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    const msg = await cmd.sendAnonMessage(thread.id, text.trim());
    setMessages((prev) => [...prev, msg]);
    setText("");
    setSending(false);
  };

  const reveal = async () => {
    setRevealing(true);
    await cmd.revealIdentity(thread.id).catch(console.error);
    setStatus("revealed");
    setRevealing(false);
  };

  // isMe: initiator's side = outgoing; author's side = incoming
  const bubbles: BubbleMessage[] = messages.map((m) => ({
    id: m.id,
    plaintext: m.plaintext,
    timestamp: m.timestamp,
    isMe: thread.is_initiator ? !m.from_author : m.from_author,
  }));

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <Header
        title="Anonymous thread"
        onBack={onBack}
        action={
          status === "open" ? (
            <button
              onClick={reveal}
              disabled={revealing}
              className="text-xs text-indigo-600 border border-indigo-200 rounded-full px-3 py-1 hover:bg-indigo-50 transition-colors"
            >
              {revealing ? "…" : "Reveal"}
            </button>
          ) : undefined
        }
      />

      {/* Post context strip */}
      <div className="bg-white border-b border-gray-100 px-4 py-2.5 flex items-center gap-2 shrink-0">
        <span className="text-xs font-mono text-gray-400 shrink-0"># anon</span>
        <span className="text-xs text-gray-500 truncate">"{thread.post_snippet}"</span>
      </div>

      {/* Identity hidden banner */}
      <div className="flex items-center gap-3 px-4 pt-3 pb-1">
        <div className="flex-1 h-px bg-gray-200" />
        <span className="text-[10px] text-gray-400 shrink-0 tracking-wide">
          identities hidden
        </span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>

      {/* No incomingInitial → no avatar, keeping full anonymity */}
      <ChatBubble messages={bubbles} outgoingColor="bg-indigo-600" />

      {status === "revealed" && (
        <div className="mx-3 mb-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2 text-xs text-green-700 text-center shrink-0">
          Both identities have been revealed.
        </div>
      )}

      <MessageInput
        value={text}
        onChange={setText}
        onSend={send}
        placeholder="Type a message…"
        disabled={sending}
      />
    </div>
  );
}
