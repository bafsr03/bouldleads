"use client";

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, cx } from "./ui";

// App-wide toasts and confirm dialogs, callable from anywhere: toast("Saved"), await confirmDialog({...}).

type Tone = "success" | "error" | "info";
type ToastItem = { id: number; text: string; tone: Tone };
type ConfirmOpts = { title: string; body?: string; confirmLabel?: string; danger?: boolean; checkbox?: { label: string; checked: boolean } };
type ConfirmReq = ConfirmOpts & { resolve: (r: { ok: boolean; checked: boolean }) => void };

let toastId = 0;
const bus = typeof window !== "undefined" ? new EventTarget() : null;

export function toast(text: string, tone: Tone = "success") {
  bus?.dispatchEvent(new CustomEvent("toast", { detail: { id: ++toastId, text, tone } }));
}

export async function confirmDialog(opts: Omit<ConfirmOpts, "checkbox">): Promise<boolean> {
  return (await confirmWithOption(opts)).ok;
}

/** Confirm dialog with one checkbox, e.g. "Don't add these back in future searches". */
export function confirmWithOption(opts: ConfirmOpts): Promise<{ ok: boolean; checked: boolean }> {
  return new Promise((resolve) => {
    if (!bus) return resolve({ ok: false, checked: false });
    bus.dispatchEvent(new CustomEvent("confirm", { detail: { ...opts, resolve } }));
  });
}

const ICON = { success: CheckCircle2, error: XCircle, info: Info };

export function FeedbackHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [req, setReq] = useState<ConfirmReq | null>(null);
  const [checked, setChecked] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!bus) return;
    const onToast = (e: Event) => {
      const t = (e as CustomEvent<ToastItem>).detail;
      setToasts((list) => [...list.slice(-3), t]);
      setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), t.tone === "error" ? 7000 : 3500);
    };
    const onConfirm = (e: Event) => {
      const r = (e as CustomEvent<ConfirmReq>).detail;
      setChecked(r.checkbox?.checked ?? false);
      setReq(r);
    };
    bus.addEventListener("toast", onToast);
    bus.addEventListener("confirm", onConfirm);
    return () => {
      bus.removeEventListener("toast", onToast);
      bus.removeEventListener("confirm", onConfirm);
    };
  }, []);

  useEffect(() => {
    if (req && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [req]);

  const close = (ok: boolean) => {
    req?.resolve({ ok, checked });
    dialog.current?.close();
    setReq(null);
  };

  return (
    <>
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => {
          const Icon = ICON[t.tone];
          return (
            <div
              key={t.id}
              className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-border bg-surface px-4 py-3 text-sm shadow-lg"
              role={t.tone === "error" ? "alert" : "status"}
            >
              <Icon
                size={16}
                className={cx("mt-0.5 shrink-0", t.tone === "success" && "text-emerald-600", t.tone === "error" && "text-red-600", t.tone === "info" && "text-sky-600")}
              />
              <span className="flex-1">{t.text}</span>
              <button onClick={() => setToasts((l) => l.filter((x) => x.id !== t.id))} className="text-muted hover:text-foreground" aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>

      <dialog
        ref={dialog}
        onCancel={(e) => {
          e.preventDefault();
          close(false);
        }}
        className="m-auto w-[min(440px,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/40"
      >
        {req && (
          <div className="p-5">
            <div className="flex items-start gap-3">
              {req.danger && (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950">
                  <AlertTriangle size={18} />
                </span>
              )}
              <div>
                <h2 className="font-semibold">{req.title}</h2>
                {req.body && <p className="mt-1 text-sm text-muted">{req.body}</p>}
                {req.checkbox && (
                  <label className="mt-3 flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                    {req.checkbox.label}
                  </label>
                )}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => close(false)}>Cancel</Button>
              <Button variant={req.danger ? "danger" : "primary"} onClick={() => close(true)} autoFocus>
                {req.confirmLabel ?? "Confirm"}
              </Button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
