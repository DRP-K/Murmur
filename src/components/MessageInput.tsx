import { useEffect, useRef } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function MessageInput({
  value,
  onChange,
  onSend,
  placeholder = "Message…",
  disabled,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [value]);

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <div className="bg-white border-t border-gray-100 px-3 py-2.5 flex gap-2 items-end shrink-0">
      <textarea
        ref={ref}
        rows={1}
        className="flex-1 border border-gray-200 rounded-2xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:border-indigo-300 leading-relaxed overflow-hidden transition-colors"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (canSend) onSend();
          }
        }}
      />
      <button
        onClick={onSend}
        disabled={!canSend}
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mb-0.5 transition-all
          ${canSend
            ? "bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 active:scale-95"
            : "bg-gray-100 text-gray-300"
          }`}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 translate-x-px">
          <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
        </svg>
      </button>
    </div>
  );
}
