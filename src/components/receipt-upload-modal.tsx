"use client";

import { Check, ImageIcon, Upload, X } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";
import { isSupabaseConfigured, uploadPaymentReceipt } from "@/lib/supabase";

interface ReceiptUploadModalProps {
  orderId: string;
  onClose: () => void;
  onUploaded: (path: string) => void;
}

export function ReceiptUploadModal({ orderId, onClose, onUploaded }: ReceiptUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(picked: File) {
    if (!picked.type.startsWith("image/") && picked.type !== "application/pdf") {
      setError("Please upload an image (JPG, PNG, WEBP) or PDF.");
      return;
    }
    if (picked.size > 10 * 1024 * 1024) {
      setError("File is too large. Maximum size is 10 MB.");
      return;
    }
    setError(null);
    setFile(picked);
    if (picked.type.startsWith("image/")) {
      const url = URL.createObjectURL(picked);
      setPreview(url);
    } else {
      setPreview(null); // PDF — no preview
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (picked) handleFile(picked);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const picked = e.dataTransfer.files?.[0];
    if (picked) handleFile(picked);
  }

  async function handleSubmit() {
    if (!file) return;
    setUploading(true);
    setError(null);

    if (!isSupabaseConfigured) {
      // Demo fallback — just mark as done without actual upload
      await new Promise((r) => setTimeout(r, 1200));
      setDone(true);
      setUploading(false);
      onUploaded("demo-receipt");
      return;
    }

    const path = await uploadPaymentReceipt(orderId, file);
    setUploading(false);
    if (!path) {
      setError("Upload failed. Please check your connection and try again.");
      return;
    }
    setDone(true);
    onUploaded(path);
  }

  return (
    <div className="receipt-upload-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="receipt-upload-dialog" role="dialog" aria-modal="true" aria-label="Upload payment receipt">

        {/* Header */}
        <div className="receipt-upload-header">
          <div>
            <span className="receipt-upload-title">Upload Payment Receipt</span>
            <small className="receipt-upload-sub">Your receipt will be sent to the print operator for verification.</small>
          </div>
          <button className="doc-close-btn" type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="receipt-upload-body">
          {done ? (
            /* Success state */
            <div className="receipt-upload-success">
              <div className="receipt-upload-success-icon">
                <Check size={28} />
              </div>
              <strong>Receipt sent!</strong>
              <p>The print operator will verify your payment shortly. You can close this window.</p>
              <button className="pill-button" type="button" onClick={onClose}>
                Close
              </button>
            </div>
          ) : (
            <>
              {/* Drop zone */}
              <div
                className={`receipt-drop-zone ${file ? "receipt-drop-zone--filled" : ""}`}
                onClick={() => inputRef.current?.click()}
                onDrop={onDrop}
                onDragOver={(e) => e.preventDefault()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
                aria-label="Click or drop to upload receipt"
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  style={{ display: "none" }}
                  onChange={onInputChange}
                />

                {preview ? (
                  /* Image preview */
                  <div className="receipt-preview-wrap">
                    <Image src={preview} alt="Receipt preview" fill style={{ objectFit: "contain" }} sizes="400px" />
                  </div>
                ) : file ? (
                  /* PDF selected — no image preview */
                  <div className="receipt-drop-placeholder">
                    <ImageIcon size={32} className="receipt-drop-icon" />
                    <span className="receipt-drop-label">{file.name}</span>
                    <span className="receipt-drop-hint">PDF selected — tap to change</span>
                  </div>
                ) : (
                  /* Empty state */
                  <div className="receipt-drop-placeholder">
                    <Upload size={32} className="receipt-drop-icon" />
                    <span className="receipt-drop-label">Tap to choose or drag &amp; drop</span>
                    <span className="receipt-drop-hint">JPG, PNG, WEBP or PDF · max 10 MB</span>
                  </div>
                )}
              </div>

              {error && <p className="receipt-upload-error">{error}</p>}

              <button
                className="pill-button"
                style={{ width: "100%", justifyContent: "center", opacity: !file || uploading ? 0.5 : 1 }}
                type="button"
                disabled={!file || uploading}
                onClick={handleSubmit}
              >
                {uploading ? "Sending receipt…" : "Send receipt to operator"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
