import type { RefObject } from "react";
import type { LocalChatMessage } from "./types";

type MatchChatPanelProps = {
  darkMode: boolean;
  chatScrollRef: RefObject<HTMLDivElement | null>;
  chatInputRef: RefObject<HTMLInputElement | null>;
  chatMessages: LocalChatMessage[];
  chatInput: string;
  onChangeChatInput: (value: string) => void;
  onSendChat: () => void;
};

export function MatchChatPanel({
  darkMode,
  chatScrollRef,
  chatInputRef,
  chatMessages,
  chatInput,
  onChangeChatInput,
  onSendChat,
}: MatchChatPanelProps) {
  return (
    <aside
      className={`flex h-[620px] flex-col overflow-hidden rounded-2xl border shadow-sm lg:col-span-4 ${
        darkMode ? "border-[#3A444D] bg-[#1E252B]" : "border-slate-200/60 bg-white"
      }`}
    >
      <div
        className={`flex items-center justify-between border-b p-4 ${
          darkMode ? "border-slate-700" : "border-slate-100"
        }`}
      >
        <h2 className="font-semibold text-lg">Match Chat</h2>
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold uppercase text-green-700">
          Live
        </span>
      </div>
      <div
        ref={chatScrollRef}
        className={`flex-1 overflow-y-auto p-3 ${darkMode ? "bg-[#2A3137]" : "bg-slate-50"}`}
      >
        {chatMessages.length === 0 ? (
          <div className={`py-12 text-center text-sm ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
            No messages yet. Say hi to your opponent!
          </div>
        ) : (
          <ul className="space-y-1">
            {chatMessages.map((msg) => {
              const displayName = msg.nickname?.trim() || msg.user_id.slice(0, 8);
              return (
                <li
                  key={msg.id}
                  className={`break-words text-sm ${darkMode ? "text-slate-200" : "text-slate-700"}`}
                >
                  <span className={`font-semibold ${darkMode ? "text-slate-100" : "text-slate-900"}`}>
                    {displayName}
                  </span>
                  {" : "}
                  <span>{msg.message}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div
        className={`border-t p-3 ${
          darkMode ? "border-[#3A444D] bg-[#1E252B]" : "border-slate-100 bg-slate-50"
        }`}
      >
        <div className="flex gap-2">
          <input
            ref={chatInputRef}
            value={chatInput}
            onChange={(e) => onChangeChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSendChat();
              }
            }}
            maxLength={300}
            placeholder="Type a message..."
            className={`flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:border-[#386641] ${
              darkMode
                ? "border-[#3A444D] bg-[#2A3137] text-slate-100"
                : "border-slate-300 bg-white text-slate-800"
            }`}
          />
          <button
            type="button"
            onClick={onSendChat}
            disabled={chatInput.trim().length === 0}
            className="rounded-lg bg-[#386641] px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            ➤
          </button>
        </div>
      </div>
    </aside>
  );
}
