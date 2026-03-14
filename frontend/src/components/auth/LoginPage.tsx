import { useState, useEffect } from "react";
import { Mail, Map, Loader2, CheckCircle, AlertCircle } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE || "";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("auth_error");
    if (authError) {
      setError(
        "Your login link was invalid or expired. Please request a new one.",
      );
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/auth/request-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to send login link");
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#FAFAF9] via-amber-100 to-[#FAFAF9] p-4">
      <div className="w-full max-w-[420px] bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.08),0_1px_3px_rgba(0,0,0,0.04)] p-10">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-amber-600 flex items-center justify-center text-white mb-4">
            <Map size={24} />
          </div>
          <h1 className="text-[22px] font-bold text-[#1A1A18] tracking-tight">
            Roadmap Hub
          </h1>
          <p className="text-sm text-[#6B7068] mt-1">Executive Workspace</p>
        </div>

        {sent ? (
          <div className="text-center">
            <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
              <CheckCircle size={28} className="text-green-600" />
            </div>
            <h2 className="text-base font-semibold text-[#1A1A18] mb-2">
              Check your email
            </h2>
            <p className="text-sm text-[#6B7068] leading-relaxed">
              We sent a login link to{" "}
              <strong className="text-[#1A1A18]">{email}</strong>. Click the
              link in the email to sign in.
            </p>
            <button
              onClick={() => {
                setSent(false);
                setEmail("");
              }}
              className="mt-6 bg-transparent border-none text-amber-600 text-sm font-medium cursor-pointer underline p-0"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label
              htmlFor="login-email"
              className="block text-[13px] font-medium text-[#1A1A18] mb-1.5"
            >
              Email address
            </label>
            <div className="relative mb-4">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA39A] pointer-events-none">
                <Mail size={18} />
              </div>
              <input
                id="login-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@guild.com"
                className="w-full py-2.5 pr-3 pl-10 rounded-[10px] border border-[#E5E5E3] text-sm text-[#1A1A18] bg-[#FAFAF9] box-border transition-[border-color,box-shadow] duration-150 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-200"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 mb-4 text-[13px] text-red-600">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={sending || !email.trim()}
              className={`w-full py-2.5 px-4 rounded-[10px] border-none text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors duration-150 ${
                sending || !email.trim()
                  ? "bg-amber-400 cursor-not-allowed opacity-70"
                  : "bg-amber-600 cursor-pointer opacity-100"
              }`}
            >
              {sending ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail size={18} />
                  Send Login Link
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
