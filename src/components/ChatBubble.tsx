import { useEffect, useRef } from "react";

export interface BubbleMessage {
  id: string;
  plaintext: string;
  timestamp: number;
  isMe: boolean;
  status?: "sending" | "sent" | "delivered" | "read";
}

interface GroupedMessages {
  isMe: boolean;
  messages: BubbleMessage[];
}

function groupMessages(messages: BubbleMessage[]): GroupedMessages[] {
  const groups: GroupedMessages[] = [];
  for (const msg of messages) {
    const last = groups[groups.length - 1];
    if (last && last.isMe === msg.isMe) {
      last.messages.push(msg);
    } else {
      groups.push({ isMe: msg.isMe, messages: [msg] });
    }
  }
  return groups;
}

function formatTime(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateSeparator(ts: number) {
  const d = new Date(ts * 1000);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

function shouldShowDateSeparator(prev: BubbleMessage | undefined, curr: BubbleMessage) {
  if (!prev) return true;
  const a = new Date(prev.timestamp * 1000);
  const b = new Date(curr.timestamp * 1000);
  return a.toDateString() !== b.toDateString();
}

function bubbleRadius(isMe: boolean, isFirst: boolean, isLast: boolean) {
  const base = "rounded-2xl";
  if (isFirst && isLast) return base;
  if (isMe) {
    if (isFirst) return `${base} rounded-br-[6px]`;
    if (isLast) return `${base} rounded-tr-[6px]`;
    return `${base} rounded-tr-[6px] rounded-br-[6px]`;
  } else {
    if (isFirst) return `${base} rounded-bl-[6px]`;
    if (isLast) return `${base} rounded-tl-[6px]`;
    return `${base} rounded-tl-[6px] rounded-bl-[6px]`;
  }
}

function StatusTick({ status }: { status: BubbleMessage["status"] }) {
  if (!status || status === "sending") {
    return <span className="text-white/50 text-[10px] ml-1">◌</span>;
  }
  if (status === "sent") {
    return <span className="text-white/60 text-[10px] ml-1">✓</span>;
  }
  if (status === "delivered") {
    return <span className="text-white/70 text-[10px] ml-1">✓✓</span>;
  }
  // read
  return <span className="text-blue-200 text-[10px] ml-1">✓✓</span>;
}

interface ChatBubbleProps {
  messages: BubbleMessage[];
  /** Initial shown next to incoming bubbles. Omit to hide avatars (e.g. anon threads). */
  incomingInitial?: string;
  /** Accent colour class for outgoing bubbles. Defaults to indigo. */
  outgoingColor?: string;
}

export default function ChatBubble({
  messages,
  incomingInitial,
  outgoingColor = "bg-indigo-600",
}: ChatBubbleProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const groups = groupMessages(messages);
  let flatIdx = 0;

  return (
    <div className="flex-1 overflow-y-auto px-3 pt-3 pb-4">
      {groups.map((group, gi) => {
        const firstMsgOfGroup = group.messages[0];
        const prevGroupLast =
          gi > 0 ? groups[gi - 1].messages[groups[gi - 1].messages.length - 1] : undefined;

        return (
          <div key={gi}>
            {/* Date separator */}
            {shouldShowDateSeparator(prevGroupLast, firstMsgOfGroup) && (
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400 font-medium shrink-0">
                  {formatDateSeparator(firstMsgOfGroup.timestamp)}
                </span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
            )}

            {/* Message group */}
            <div
              className={`flex flex-col ${group.isMe ? "items-end" : "items-start"} mb-3`}
            >
              {group.messages.map((msg, mi) => {
                const isFirst = mi === 0;
                const isLast = mi === group.messages.length - 1;
                flatIdx++;
                void flatIdx;

                return (
                  <div
                    key={msg.id}
                    className={`flex items-end gap-1.5 w-full ${
                      group.isMe ? "flex-row-reverse" : "flex-row"
                    } ${mi > 0 ? "mt-0.5" : ""}`}
                  >
                    {/* Avatar slot (incoming side) */}
                    {!group.isMe && (
                      <div className="w-6 shrink-0 self-end mb-0.5">
                        {isLast && incomingInitial ? (
                          <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 text-[10px] font-bold flex items-center justify-center select-none">
                            {incomingInitial}
                          </div>
                        ) : null}
                      </div>
                    )}

                    {/* Bubble */}
                    <div className="relative max-w-[72%]">
                      <div
                        className={`px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap
                          ${bubbleRadius(group.isMe, isFirst, isLast)}
                          ${
                            group.isMe
                              ? `${outgoingColor} text-white shadow-sm`
                              : "bg-white text-gray-800 border border-gray-100 shadow-sm"
                          }`}
                      >
                        {msg.plaintext}
                        {/* Inline status tick on last outgoing bubble */}
                        {group.isMe && isLast && msg.status && (
                          <StatusTick status={msg.status} />
                        )}
                      </div>

                      {/* Bubble tail on last in group */}
                      {isLast && (
                        <div
                          style={
                            group.isMe
                              ? {
                                  position: "absolute",
                                  bottom: 0,
                                  right: -5,
                                  width: 0,
                                  height: 0,
                                  borderStyle: "solid",
                                  borderWidth: "0 0 8px 7px",
                                  // must match outgoing color; indigo-600 = #4f46e5
                                  borderColor: `transparent transparent ${
                                    outgoingColor === "bg-indigo-600"
                                      ? "#4f46e5"
                                      : "#6366f1"
                                  } transparent`,
                                }
                              : {
                                  position: "absolute",
                                  bottom: 0,
                                  left: -5,
                                  width: 0,
                                  height: 0,
                                  borderStyle: "solid",
                                  borderWidth: "0 7px 8px 0",
                                  borderColor: "transparent #ffffff transparent transparent",
                                }
                          }
                        />
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Timestamp below each group */}
              <p
                className={`text-[10px] text-gray-400 mt-1 ${
                  group.isMe ? "pr-1" : incomingInitial ? "pl-8" : "pl-1"
                }`}
              >
                {formatTime(group.messages[group.messages.length - 1].timestamp)}
              </p>
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
