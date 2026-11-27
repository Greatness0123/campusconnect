"use client";

import { Download, X, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PwaInstallBannerProps {
  /** "admin" shows "Install Admin App", "student" shows "Install App" */
  variant?: "admin" | "student";
}

export function PwaInstallBanner({ variant = "student" }: PwaInstallBannerProps) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isInStandaloneMode, setIsInStandaloneMode] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Don't show if already installed (standalone mode)
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    setIsInStandaloneMode(standalone);
    if (standalone) return;

    // Don't show if user already dismissed this session
    const key = `pwa-install-dismissed-${variant}`;
    if (sessionStorage.getItem(key)) return;

    // Detect iOS Safari (needs manual Add to Home Screen)
    const ua = navigator.userAgent;
    const ios = /iphone|ipad|ipod/i.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    setIsIos(ios);

    if (ios) {
      // Show iOS banner after 2s
      const t = setTimeout(() => setShow(true), 2000);
      return () => clearTimeout(t);
    }

    // Android / Desktoplisten for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setTimeout(() => setShow(true), 1500);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // Also hide if already installed mid-session
    window.addEventListener("appinstalled", () => setShow(false));

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, [variant]);

  function dismiss() {
    setShow(false);
    setDismissed(true);
    sessionStorage.setItem(`pwa-install-dismissed-${variant}`, "1");
  }

  async function handleInstall() {
    if (!deferredPrompt) return;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setShow(false);
      }
    } finally {
      setInstalling(false);
      setDeferredPrompt(null);
    }
  }

  if (!show || isInStandaloneMode || dismissed) return null;

  const isAdmin = variant === "admin";
  const appName = isAdmin ? "Admin App" : "Campus Prints";

  return (
    <div className={`pwa-install-banner${isAdmin ? " is-admin" : ""}`} role="dialog" aria-label="Install app">
      <div className="pwa-install-icon">
        <Smartphone size={20} />
      </div>
      <div className="pwa-install-content">
        <p className="pwa-install-title">
          {isAdmin ? "Install Admin App" : `Install ${appName}`}
        </p>
        <p className="pwa-install-desc">
          {isIos
            ? <>Tap <strong>Share</strong> → <strong>Add to Home Screen</strong> to install</>
            : isAdmin
            ? "Get order alerts on your screen even when this site is closed."
            : "Quick access to print ordersright from your home screen."}
        </p>
      </div>
      <div className="pwa-install-actions">
        {!isIos && (
          <button
            className="pwa-install-btn"
            onClick={handleInstall}
            disabled={installing}
            type="button"
          >
            <Download size={13} />
            {installing ? "Installing…" : "Install"}
          </button>
        )}
        <button
          className="pwa-install-dismiss"
          onClick={dismiss}
          type="button"
          aria-label="Dismiss"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
