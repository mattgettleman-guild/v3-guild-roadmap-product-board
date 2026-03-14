import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Loader2,
  Plus,
  Trash2,
  MessageSquare,
  Copy,
  Check,
  Pencil,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { api, type AiThread, type AiMessage } from "../../lib/api";

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString();
}

export function AiAssistantView() {
  const [threads, setThreads] = useState<AiThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    try {
      const data = await api.aiListThreads();
      setThreads(data);
    } catch {}
  }, []);

  const loadMessages = useCallback(async (threadId: string) => {
    try {
      const data = await api.aiGetMessages(threadId);
      setMessages(data);
    } catch {}
  }, []);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (activeThreadId) loadMessages(activeThreadId);
    else setMessages([]);
  }, [activeThreadId, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleNewThread() {
    try {
      const thread = await api.aiCreateThread({ title: "New conversation" });
      setThreads((prev) => [thread, ...prev]);
      setActiveThreadId(thread.id);
    } catch {}
  }

  async function handleDeleteThread(id: string) {
    try {
      await api.aiDeleteThread(id);
      setThreads((prev) => prev.filter((t) => t.id !== id));
      if (activeThreadId === id) {
        setActiveThreadId(null);
        setMessages([]);
      }
    } catch {}
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending || !activeThreadId) return;
    setSending(true);
    const text = input;
    setInput("");
    try {
      const { userMessage, assistantMessage } = await api.aiSendMessage(
        activeThreadId,
        text,
      );
      setMessages((prev) => [...prev, userMessage, assistantMessage]);
    } catch {
      setInput(text);
    } finally {
      setSending(false);
    }
  }

  function copyMessage(content: string, id: string) {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div className="flex h-full">
      {/* Thread sidebar */}
      {sidebarOpen && (
        <div className="w-64 border-r border-[#E5E5E3] bg-[#FAFAF9] flex flex-col">
          <div className="p-3 border-b border-[#E5E5E3] flex items-center gap-2">
            <button
              onClick={handleNewThread}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700 transition-colors cursor-pointer border-none"
            >
              <Plus size={12} />
              New Chat
            </button>
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1.5 rounded hover:bg-[#E5E5E3] text-[#9CA39A] cursor-pointer bg-transparent border-none"
            >
              <ChevronLeft size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {threads.map((thread) => (
              <div
                key={thread.id}
                onClick={() => setActiveThreadId(thread.id)}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-sm group ${
                  activeThreadId === thread.id
                    ? "bg-amber-50 text-amber-800"
                    : "text-[#6B7068] hover:bg-white"
                }`}
              >
                <MessageSquare size={12} className="shrink-0" />
                <span className="flex-1 truncate">{thread.title}</span>
                <span className="text-[10px] text-[#9CA39A] shrink-0">
                  {formatTime(thread.updatedAt)}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteThread(thread.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-[#9CA39A] hover:text-red-500 cursor-pointer bg-transparent border-none"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
            {threads.length === 0 && (
              <p className="px-3 py-6 text-xs text-[#9CA39A] text-center">
                No conversations yet
              </p>
            )}
          </div>
        </div>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col">
        {!sidebarOpen && (
          <div className="px-3 pt-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded hover:bg-[#FAFAF9] text-[#9CA39A] cursor-pointer bg-transparent border-none"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}

        {!activeThreadId ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare
                size={40}
                className="mx-auto mb-3 text-[#E5E5E3]"
              />
              <p className="text-sm text-[#9CA39A]">
                Select a conversation or start a new one
              </p>
              <button
                onClick={handleNewThread}
                className="mt-3 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 cursor-pointer border-none"
              >
                Start New Chat
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}
                >
                  {msg.role === "assistant" && (
                    <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                      <MessageSquare size={12} className="text-amber-600" />
                    </div>
                  )}
                  <div
                    className={`max-w-[70%] rounded-xl px-4 py-2.5 text-sm leading-relaxed group relative ${
                      msg.role === "user"
                        ? "bg-amber-600 text-white"
                        : "bg-[#FAFAF9] text-[#1A1A18] border border-[#E5E5E3]"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    <button
                      onClick={() => copyMessage(msg.content, msg.id)}
                      className={`absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 p-1 rounded bg-white border border-[#E5E5E3] shadow-sm cursor-pointer transition-opacity ${
                        msg.role === "user" ? "text-[#9CA39A]" : "text-[#9CA39A]"
                      }`}
                    >
                      {copiedId === msg.id ? (
                        <Check size={10} />
                      ) : (
                        <Copy size={10} />
                      )}
                    </button>
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                    <Loader2
                      size={12}
                      className="text-amber-600 animate-spin"
                    />
                  </div>
                  <div className="bg-[#FAFAF9] text-[#9CA39A] rounded-xl px-4 py-2.5 text-sm border border-[#E5E5E3]">
                    Thinking...
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form
              onSubmit={handleSend}
              className="px-5 pb-5 pt-2 border-t border-[#E5E5E3]"
            >
              <div className="flex items-center gap-2 bg-white border border-[#E5E5E3] rounded-xl px-4 py-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask anything about your roadmap..."
                  className="flex-1 bg-transparent border-none outline-none text-sm text-[#1A1A18] placeholder:text-[#9CA39A]"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || sending}
                  className="p-1.5 rounded-lg bg-amber-600 text-white disabled:opacity-40 cursor-pointer border-none"
                >
                  <Send size={14} />
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
