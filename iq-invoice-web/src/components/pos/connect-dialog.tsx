"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * "Open Mercedes & Login" — the web equivalent of the desktop app's login
 * window. Starts a Browserbase Live View session (server side), embeds the
 * interactive Live View in an iframe so the owner can sign in with MFA
 * without the server ever seeing a password, then verifies the session via
 * /api/mercedes/verify which promotes the persistent Context to `connected`.
 */
type Phase = "opening" | "login" | "verifying" | "verified" | "error";

interface ConnectDialogProps {
  onClose: () => void;
  /** Called after a successful verify so the parent can refresh the badge. */
  onConnected: () => void;
}

/** Append the navbar-hiding query param used by the embedded Live View. */
function withNavbar(url: string): string {
  return url + (url.includes("?") ? "&" : "?") + "navbar=false";
}

export function ConnectDialog({ onClose, onConnected }: ConnectDialogProps) {
  const [phase, setPhase] = useState<Phase>("opening");
  const [liveViewUrl, setLiveViewUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [dropped, setDropped] = useState(false);

  /** Apply a /api/mercedes/connect response to the dialog state. */
  const applyResult = useCallback(
    (
      httpOk: boolean,
      data: { ok?: boolean; error?: string; liveViewUrl?: string },
    ) => {
      if (!httpOk || !data.ok) {
        setError(data.error || "Could not open the Mercedes login window.");
        setPhase("error");
        return;
      }
      setLiveViewUrl(withNavbar(data.liveViewUrl || ""));
      setPhase("login");
    },
    [],
  );

  const open = useCallback(async () => {
    setPhase("opening");
    setError("");
    setDropped(false);
    setLiveViewUrl(null);
    try {
      const res = await fetch("/api/mercedes/connect", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      applyResult(res.ok, data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }, [applyResult]);

  useEffect(() => {
    // Initial open on mount; state updates happen in the fetch callbacks
    // (React lint: no setState-calling functions invoked from effects).
    let stale = false;
    fetch("/api/mercedes/connect", { method: "POST" })
      .then((res) => res.json().catch(() => ({})).then((data) => ({ res, data })))
      .then(({ res, data }) => {
        if (!stale) applyResult(res.ok, data);
      })
      .catch((e: unknown) => {
        if (!stale) {
          setError(e instanceof Error ? e.message : String(e));
          setPhase("error");
        }
      });
    return () => {
      stale = true;
    };
  }, [applyResult]);

  // The embedded Live View posts this message when the session ends.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data === "browserbase-disconnected") setDropped(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const cancel = useCallback(async () => {
    // Close an open login window without verifying; the server restores the
    // previous connection state (and keeps the Context for next time).
    await fetch("/api/mercedes/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "cancel" }),
    }).catch(() => undefined);
  }, []);

  const handleClose = useCallback(() => {
    if (phase === "verifying" || phase === "opening") return; // don't abandon
    if (phase !== "verified") void cancel();
    onClose();
  }, [phase, cancel, onClose]);

  const handleVerify = useCallback(async () => {
    setPhase("verifying");
    try {
      const res = await fetch("/api/mercedes/verify", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error("Could not verify the session", {
          description: data.error || "Please try again.",
        });
        setPhase("login");
        return;
      }
      if (data.connected) {
        toast.success("Mercedes connected", { description: data.message });
        setPhase("verified");
        onConnected();
      } else {
        toast.warning("Still logged out", { description: data.message });
        setError(data.message || "");
        setPhase("login");
      }
    } catch (e) {
      toast.error("Verification failed", {
        description: e instanceof Error ? e.message : String(e),
      });
      setPhase("login");
    }
  }, [onConnected]);

  return (
    <Dialog open onOpenChange={(f) => { if (!f) handleClose(); }}>
      <DialogContent hideClose className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {phase === "verified" ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin" />
            )}
            Mercedes B2B Connect
          </DialogTitle>
          <DialogDescription>
            {phase === "opening" &&
              "Opening a secure Browserbase login window…"}
            {phase === "login" &&
              "Sign in with your Mercedes B2B credentials (including any " +
                "MFA) inside the window below, then press Continue."}
            {phase === "verifying" && "Verifying the Mercedes session…"}
            {phase === "verified" &&
              "Signed in. Live Mercedes pricing is ready."}
            {phase === "error" && "The login window could not be opened."}
          </DialogDescription>
        </DialogHeader>

        {(phase === "opening" || phase === "verifying") && (
          <div className="flex items-center justify-center gap-2 rounded-md border border-border bg-panel-alt py-16 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            {phase === "opening"
              ? "Creating the login session…"
              : "Checking your session…"}
          </div>
        )}

        {phase === "login" && liveViewUrl && (
          <div className="space-y-2">
            <iframe
              src={liveViewUrl}
              title="Mercedes login (Browserbase Live View)"
              className="h-[460px] w-full rounded-md border border-border bg-black/5"
            />
            <p className="text-xs text-muted">
              {dropped
                ? "The live window was closed — press Continue to verify the session anyway."
                : "This is a live view of a cloud browser. Your credentials " +
                  "are entered directly on the Mercedes site and are never " +
                  "seen or stored by this app."}
            </p>
          </div>
        )}

        {phase === "verified" && (
          <div className="flex flex-col items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 py-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <p className="font-medium">Mercedes session connected</p>
            <p className="max-w-md text-sm text-muted">
              The login is stored in an encrypted Browserbase Context, so you
              should not need to sign in again for weeks. Scan a part to see
              live prices.
            </p>
          </div>
        )}

        {phase === "error" && (
          <div className="rounded-md border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
            {error}
          </div>
        )}

        <DialogFooter>
          {phase === "login" && (
            <>
              <Button variant="default" onClick={handleClose}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void handleVerify()}>
                I&apos;ve signed in — Continue
              </Button>
            </>
          )}
          {phase === "error" && (
            <>
              <Button variant="default" onClick={handleClose}>
                Close
              </Button>
              <Button variant="primary" onClick={() => void open()}>
                Try again
              </Button>
            </>
          )}
          {phase === "verified" && (
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          )}
          {(phase === "opening" || phase === "verifying") && (
            <Button variant="default" disabled>
              Please wait…
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

