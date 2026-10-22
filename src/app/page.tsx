"use client";

import {
  ArrowRight,
  Eye,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Minus,
  Plus,
  UploadCloud,
  X,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { estimateColorCoverage } from "@/lib/analysis";
import { convertOfficeToPdf, isOfficeFilename } from "@/lib/office-to-pdf";
import { syncDeviceSession } from "@/lib/supabase";
import {
  computeQuote,
  formatNaira,
  locationOptions,
  parsePageSelection,
  pricing,
  type ColorMode,
  type Sides,
} from "@/lib/print";
import { setOrderDraft, getOrderDraft, clearOrderDraft } from "@/lib/order-draft";

type UploadStatus = "analyzing" | "ready" | "error";

type PrintFile = {
  id: string;
  file: File;
  status: UploadStatus;
  pages: number;
  colorCoverage: number[];
  previewUrls: string[];
  previewPage: number;
  pageSelection: string;
  copies: number;
  colorMode: ColorMode;
  sides: Sides;
  stapled: boolean;
  bound: boolean;
  message?: string;
};

let pdfjsPromise: Promise<any> | null = null;

// Browser-safe PDF.js loader that uses native dynamic import to avoid Webpack chunking issues
async function getPdfJs(): Promise<any> {
  if (typeof window === "undefined") {
    throw new Error("PDF processing is only available in the browser.");
  }
  if ((window as any).pdfjsLib?.getDocument) {
    return (window as any).pdfjsLib;
  }
  if (pdfjsPromise) {
    return pdfjsPromise;
  }

  pdfjsPromise = (async () => {
    try {
      const dynamicImport = new Function("url", "return import(url)");
      const mod = await dynamicImport("/pdf.min.mjs");
      const pdfjs = mod?.getDocument ? mod : (window as any).pdfjsLib || mod?.default;

      if (!pdfjs?.getDocument) {
        throw new Error("PDF engine could not find getDocument.");
      }

      if (pdfjs.GlobalWorkerOptions) {
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      }

      (window as any).pdfjsLib = pdfjs;
      return pdfjs;
    } catch (err) {
      pdfjsPromise = null;
      throw err;
    }
  })();

  return pdfjsPromise;
}

async function analyzeFile(
  file: File,
  onProgress?: (message: string) => void
): Promise<Partial<PrintFile>> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "pdf") {
    const pdfjs = await getPdfJs();
    if (pdfjs?.GlobalWorkerOptions) {
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    }
    const pdfDocument = await pdfjs.getDocument({
      data: await file.arrayBuffer(),
      cMapUrl: "https://unpkg.com/pdfjs-dist@4.10.38/cmaps/",
      cMapPacked: true,
    }).promise;

    if (pdfDocument.numPages > 250) {
      await pdfDocument.destroy();
      throw new Error("This preview supports up to 250 pages at a time. Split the PDF into smaller files.");
    }

    const coverage: number[] = [];
    const previewUrls: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(480 / baseViewport.width, 0.75);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Your browser could not prepare a preview.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;

      coverage.push(estimateColorCoverage(context.getImageData(0, 0, canvas.width, canvas.height).data));
      previewUrls.push(canvas.toDataURL("image/jpeg", 0.75));
      page.cleanup();
    }
    await pdfDocument.destroy();
    return {
      pages: coverage.length,
      colorCoverage: coverage,
      previewUrls,
      previewPage: 1,
      status: "ready",
    };
  }

  if (["jpg", "jpeg", "png", "webp"].includes(extension ?? "")) {
    const image = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 600 / image.width);
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Your browser could not prepare a preview.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const colorCoverage = estimateColorCoverage(context.getImageData(0, 0, canvas.width, canvas.height).data);
    image.close();
    return {
      pages: 1,
      colorCoverage: [colorCoverage],
      previewUrls: [URL.createObjectURL(file)],
      previewPage: 1,
      status: "ready",
    };
  }

  if (isOfficeFilename(file.name)) {
    const converted = await convertOfficeToPdf(file, onProgress);
    return {
      file: converted.pdfFile,
      pages: converted.pages,
      colorCoverage: converted.colorCoverage,
      previewUrls: converted.previewUrls,
      previewPage: 1,
      status: "ready",
    };
  }

  throw new Error(
    "Unsupported file type. Upload a PDF, Word, PowerPoint or image file."
  );
}

export default function Home() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [name, setName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [files, setFiles] = useState<PrintFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const [draftRestored, setDraftRestored] = useState(false);
  const [openingSummary, setOpeningSummary] = useState(false);

  // Modal preview state
  const [previewingFile, setPreviewingFile] = useState<PrintFile | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const quoteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let savedDeviceId = localStorage.getItem("campusprints:device-session");
    if (!savedDeviceId) {
      savedDeviceId = crypto.randomUUID();
      localStorage.setItem("campusprints:device-session", savedDeviceId);
    }
    setDeviceId(savedDeviceId);

    const savedName = localStorage.getItem("campusprints:user-name");
    if (savedName) {
      setName(savedName);
      void syncDeviceSession(savedDeviceId, savedName);
    }

    // Restore an in-progress draft (survives back-navigation and refresh).
    // Guarded so a bad draft can never block the welcome flow.
    try {
      const draft = getOrderDraft();
      if (draft && draft.files.length > 0) {
        setName((current) => current || draft.customer);
        setFiles(
          draft.files.map((f) => ({
            id: f.id,
            file: f.file,
            // Placeholder files (size 0, restored after refresh) keep their stats
            // but lose live previews and must skip re-upload.
            status: f.file.size === 0 ? "ready" : (f.status as UploadStatus),
            pages: f.pages,
            colorCoverage: f.colorCoverage,
            previewUrls: f.file.size === 0 ? [] : f.previewUrls,
            previewPage: f.previewPage,
            pageSelection: f.pageSelection,
            copies: f.copies,
            colorMode: f.colorMode,
            sides: f.sides,
            stapled: f.stapled,
            bound: f.bound,
          }))
        );
      }
    } catch {
      clearOrderDraft();
    }
    setDraftRestored(true);
    setHydrated(true);
  }, []);

  // Keep the persisted draft in sync with the live workspace.
  useEffect(() => {
    if (!draftRestored) return;
    if (files.length === 0) {
      clearOrderDraft();
      return;
    }
    setOrderDraft({
      customer: name,
      deviceId,
      files: files.map((file) => ({
        id: file.id,
        file: file.file,
        status: file.status,
        pages: file.pages,
        colorCoverage: file.colorCoverage,
        previewUrls: file.previewUrls,
        previewPage: file.previewPage,
        pageSelection: file.pageSelection,
        copies: file.copies,
        colorMode: file.colorMode,
        sides: file.sides,
        stapled: file.stapled,
        bound: file.bound,
      })),
      area: "Uptown",
      location: locationOptions.Uptown[0],
    });
  }, [draftRestored, files, name, deviceId]);

  const allReady = files.length > 0 && files.every((file) => file.status === "ready");

  const quote = useMemo(() => computeQuote(files), [files]);

  async function addFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList).slice(0, Math.max(0, 10 - files.length));
    const rejected = incoming.find((file) => file.size > 35 * 1024 * 1024);
    if (rejected) {
      setConfirmationText(`${rejected.name} exceeds the 35 MB limit. Please use a compressed file.`);
      setShowConfirmation(true);
      return;
    }

    const newFiles = incoming.map<PrintFile>((file) => ({
      id: crypto.randomUUID(),
      file,
      status: "analyzing",
      pages: 0,
      colorCoverage: [],
      previewUrls: [],
      previewPage: 1,
      pageSelection: "all",
      copies: 1,
      colorMode: "keep",
      sides: "single",
      stapled: false,
      bound: false,
    }));

    setFiles((current) => [...current, ...newFiles]);

    for (const item of newFiles) {
      try {
        const result = await analyzeFile(item.file, (message) =>
          setFiles((current) =>
            current.map((file) => (file.id === item.id ? { ...file, message } : file))
          )
        );
        const hasColor = (result.colorCoverage ?? []).some((c) => c > 0.005);
        const detectedMode: ColorMode = hasColor ? "keep" : "mono";
        setFiles((current) =>
          current.map((file) =>
            file.id === item.id
              ? { ...file, ...result, message: undefined, colorMode: detectedMode }
              : file
          )
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "This file could not be analyzed.";
        setFiles((current) =>
          current.map((file) =>
            file.id === item.id ? { ...file, status: "error", message } : file
          )
        );
      }
    }
  }

  function saveName() {
    const nextName = nameInput.trim();
    if (!nextName) return;
    localStorage.setItem("campusprints:user-name", nextName);
    setName(nextName);
    if (deviceId) {
      void syncDeviceSession(deviceId, nextName);
    }
  }

  function changeName() {
    setNameInput(name);
    setName("");
    localStorage.removeItem("campusprints:user-name");
  }

  function updateFile(id: string, patch: Partial<PrintFile>) {
    setFiles((current) => current.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function goToCheckout() {
    if (!allReady || quote.copyPages === 0 || openingSummary) return;
    setOpeningSummary(true);
    setOrderDraft({
      customer: name,
      deviceId,
      files: files.map((file) => ({
        id: file.id,
        file: file.file,
        status: file.status,
        pages: file.pages,
        colorCoverage: file.colorCoverage,
        previewUrls: file.previewUrls,
        previewPage: file.previewPage,
        pageSelection: file.pageSelection,
        copies: file.copies,
        colorMode: file.colorMode,
        sides: file.sides,
        stapled: file.stapled,
        bound: file.bound,
      })),
      area: "Uptown",
      location: locationOptions.Uptown[0],
    });
    router.push("/checkout");
  }

  function openPreviewModal(file: PrintFile) {
    setPreviewingFile(file);
  }

  if (!hydrated || !name) {
    return (
      <main className="welcome-screen">
        <AppHeader compact />

        <div className="welcome-center">
          <div className="welcome-emblem">
            <Image
              src="/icononly.png"
              alt="Campus Prints Emblem"
              width={92}
              height={92}
              priority
            />
          </div>

          <p className="welcome-eyebrow">UPLOAD IT. WE&apos;LL FIGURE IT OUT.</p>
          <h1 className="welcome-title">What&apos;s your name?</h1>

          <form
            className="welcome-form"
            onSubmit={(event) => {
              event.preventDefault();
              saveName();
            }}
          >
            <input
              className="pill-input"
              autoComplete="given-name"
              maxLength={40}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder="e.g. Chidi"
              value={nameInput}
              required
              autoFocus
            />
            <button className="pill-button" type="submit">
              Continue <ArrowRight size={18} />
            </button>
          </form>
        </div>

        {/* Welcome footer removed by request */}
      </main>
    );
  }

  const canCreateOrder = allReady && quote.copyPages > 0;

  return (
    <main className="app-shell">
      <AppHeader userName={name} onChangeName={changeName} />

      <div className="page-wrap">
        {/* Page Heading & Welcome (Screenshot 2) */}
        <div className="page-heading">
          <h1>
            Hey <span className="name-highlight">{name}</span>, what are we printing today?
          </h1>
          <p className="subheading">
            Upload your documents and we&apos;ll calculate everything for you.
          </p>
        </div>

        {/* Speed Comparison Notice Card — commented out by request */}
        {/* <section className="speed-guide-card">
          <h2 className="speed-guide-title">
            <Sparkles size={15} /> NB: Analysis speed depends on file type
          </h2>
          <table className="speed-table">
            <thead>
              <tr>
                <th>File type</th>
                <th>Relative speed</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>PDF, mostly text</td>
                <td>Fastest</td>
              </tr>
              <tr>
                <td>PDF with a few images</td>
                <td>Medium</td>
              </tr>
              <tr>
                <td>DOCX (needs conversion)</td>
                <td>Slowest — limited by conversion</td>
              </tr>
              <tr>
                <td>Photo (jpg/png)</td>
                <td>Fast (single page → Full Color)</td>
              </tr>
            </tbody>
          </table>
          <p className="speed-advisory">
            For the fastest response, convert your document to PDF and upload it. If you&apos;re uploading
            a .doc or .docx file, please upload it only once and do not reload the page if processing takes
            a moment. Reloading or uploading the file again may cause additional delays.
          </p>
        </section> */}

        <div className="workspace-grid">
          <div className="main-column">
            <input
              ref={fileInput}
              id="print-file-input"
              className="visually-hidden"
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png,.webp"
              onChange={(event) => {
                const selectedFiles = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                if (selectedFiles.length > 0) void addFiles(selectedFiles);
              }}
            />

            {/* Upload Zone — only when no files yet */}
            {files.length === 0 && (
              <div
                className={`upload-dropzone ${isDragging ? "is-dragging" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                  void addFiles(event.dataTransfer.files);
                }}
                onClick={() => fileInput.current?.click()}
              >
                <div className="upload-icon-circle">
                  <UploadCloud size={26} />
                </div>
                <button
                  className="upload-action-btn"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    fileInput.current?.click();
                  }}
                >
                  Upload Files
                </button>
                <p className="upload-drag-text">or drag &amp; drop them here</p>
                <p className="upload-accepted-formats">
                  PDF · Word · PowerPoint · JPG · PNG · WEBP
                </p>
              </div>
            )}

            {/* Document Cards (Screenshot 3 & 4) */}
            {files.map((file) => {
              const selectedCount = parsePageSelection(file.pageSelection, file.pages).length;
              const colorPagesCount = file.colorCoverage.filter((c) => c > 0.005).length;
              const bwPagesCount = Math.max(0, file.pages - colorPagesCount);

              return (
                <article className="document-card" key={file.id}>
                  {/* Top Bar: Icon, Filename, Analysed badge, Close */}
                  <div className="doc-header">
                    <div className="doc-info">
                      <div className="doc-icon">
                        {file.file.type.startsWith("image/") ? (
                          <ImageIcon size={18} />
                        ) : (
                          <FileText size={18} />
                        )}
                      </div>
                      <h3 className="doc-name" title={file.file.name}>
                        {file.file.name}
                      </h3>
                      <span className="badge-tag">
                        {file.file.name.split(".").pop()?.toUpperCase() ?? "FILE"}
                      </span>
                    </div>
                    <button
                      className="doc-close-btn"
                      type="button"
                      aria-label="Remove document"
                      onClick={() => setFiles((current) => current.filter((f) => f.id !== file.id))}
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {file.status === "analyzing" && (
                    <div className="analysis-progress">
                      <span />
                      <span>
                        {file.message ??
                          (isOfficeFilename(file.file.name)
                            ? "Converting to a print-ready PDF on your device…"
                            : "Inspecting pages and scanning color distribution…")}
                      </span>
                      <LoaderCircle className="spin" size={16} />
                    </div>
                  )}

                  {file.status === "error" && <p className="inline-alert">{file.message}</p>}

                  {file.status === "ready" && (
                    <>
                      {/* 3 Large Stat Badges (Screenshot 3) */}
                      <div className="stat-triplet">
                        <div className="stat-box highlight">
                          <span className="stat-number">{file.pages}</span>
                          <span className="stat-label">Pages</span>
                        </div>
                        <div className="stat-box">
                          <span className="stat-number">{colorPagesCount}</span>
                          <span className="stat-label">Coloured</span>
                        </div>
                        <div className="stat-box">
                          <span className="stat-number">{bwPagesCount}</span>
                          <span className="stat-label">Black &amp; White</span>
                        </div>
                      </div>

                      {/* Per-file print colour */}
                      <div className="choice-cards-section">
                        <label>How should we print this?</label>
                        <div className="dual-cards-grid">
                          <div
                            className={`dual-card ${file.colorMode === "keep" ? "selected" : ""}`}
                            onClick={() =>
                              setFiles((current) =>
                                current.map((f) =>
                                  f.id === file.id ? { ...f, colorMode: "keep" } : f
                                )
                              )
                            }
                          >
                            <h4 className="dual-card-title">Print in colour</h4>
                            <p className="dual-card-desc">Keep the colours in your file</p>
                          </div>
                          <div
                            className={`dual-card ${file.colorMode === "mono" ? "selected" : ""}`}
                            onClick={() =>
                              setFiles((current) =>
                                current.map((f) =>
                                  f.id === file.id ? { ...f, colorMode: "mono" } : f
                                )
                              )
                            }
                          >
                            <h4 className="dual-card-title">Black &amp; white</h4>
                            <p className="dual-card-desc">Everything printed in B&amp;W</p>
                          </div>
                        </div>
                      </div>

                      {/* Print settings */}
                      <div className="doc-settings">
                        {/* <h4 className="setting-title">Print settings</h4> */}
                        <div className="doc-settings-panel">
                            {/* Printing side */}
                            <div className="option-pill-row">
                              <div>
                                <h4 className="setting-title">Printing side</h4>
                                <p className="setting-desc">
                                  {file.sides === "duplex"
                                    ? "Printed on both sides of each sheet"
                                    : "Printed on one side of each sheet"}
                                </p>
                              </div>
                              <div className="pill-options-group">
                                <button
                                  className={`sub-pill-btn ${file.sides === "single" ? "active" : ""}`}
                                  type="button"
                                  onClick={() => updateFile(file.id, { sides: "single" })}
                                >
                                  Single-sided
                                </button>
                                <button
                                  className={`sub-pill-btn ${file.sides === "duplex" ? "active" : ""}`}
                                  type="button"
                                  onClick={() => updateFile(file.id, { sides: "duplex" })}
                                >
                                  Front &amp; Back
                                </button>
                              </div>
                            </div>

                            {/* Stapling */}
                            <div className="option-pill-row">
                              <div>
                                <h4 className="setting-title">Stapling</h4>
                                {/* <p className="setting-desc">Keep handouts bound and organized</p> */}
                              </div>
                              <div className="pill-options-group">
                                <button
                                  className={`sub-pill-btn ${!file.stapled ? "active" : ""}`}
                                  type="button"
                                  onClick={() => updateFile(file.id, { stapled: false })}
                                >
                                  No Stapling
                                </button>
                                <button
                                  className={`sub-pill-btn ${file.stapled ? "active" : ""}`}
                                  type="button"
                                  onClick={() => updateFile(file.id, { stapled: true })}
                                >
                                  Staple (FREE)
                                </button>
                              </div>
                            </div>

                            {/* Binding */}
                            <div className="option-pill-row">
                              <div>
                                <h4 className="setting-title">Binding</h4>
                                <p className="setting-desc">Spiral binding with clear protective cover</p>
                              </div>
                              <div className="pill-options-group">
                                <button
                                  className={`sub-pill-btn ${!file.bound ? "active" : ""}`}
                                  type="button"
                                  onClick={() => updateFile(file.id, { bound: false })}
                                >
                                  No Binding
                                </button>
                                <button
                                  className={`sub-pill-btn ${file.bound ? "active" : ""}`}
                                  type="button"
                                  onClick={() => updateFile(file.id, { bound: true })}
                                >
                                  Binding (+₦500 each)
                                </button>
                              </div>
                            </div>
                        </div>
                      </div>

                      {/* Interactive Preview Trigger */}
                      {file.previewUrls.length > 0 && (
                        <button
                          className="preview-nav-btn"
                          type="button"
                          onClick={() => openPreviewModal(file)}
                          style={{ justifySelf: "start", height: 38 }}
                        >
                          <Eye size={15} /> Preview document pages ({file.pages} total)
                        </button>
                      )}

                      {/* Copies Stepper (Screenshot 3) */}
                      <div className="setting-section-row">
                        <div>
                          <h4 className="setting-title">Copies</h4>
                          <p className="setting-desc">
                            {file.pages} pages × {file.copies} = {file.pages * file.copies} printed pages
                          </p>
                        </div>
                        <div className="stepper-control">
                          <button
                            className="stepper-btn"
                            type="button"
                            onClick={() =>
                              setFiles((current) =>
                                current.map((f) =>
                                  f.id === file.id ? { ...f, copies: Math.max(1, f.copies - 1) } : f
                                )
                              )
                            }
                          >
                            <Minus size={13} />
                          </button>
                          <span className="stepper-value">{file.copies}</span>
                          <button
                            className="stepper-btn"
                            type="button"
                            onClick={() =>
                              setFiles((current) =>
                                current.map((f) =>
                                  f.id === file.id ? { ...f, copies: f.copies + 1 } : f
                                )
                              )
                            }
                          >
                            <Plus size={13} />
                          </button>
                        </div>
                      </div>

                      {/* What pages should we print? (Screenshot 3) */}
                      <div className="page-selector-row">
                        <label htmlFor={`pages-${file.id}`}>
                          What pages should we print? ({file.pages} in file)
                        </label>
                        <div className="page-selector-inputs">
                          <button
                            className={`all-pages-pill ${file.pageSelection === "all" ? "active" : ""}`}
                            type="button"
                            onClick={() =>
                              setFiles((current) =>
                                current.map((f) =>
                                  f.id === file.id ? { ...f, pageSelection: "all" } : f
                                )
                              )
                            }
                          >
                            All pages
                          </button>
                          <input
                            id={`pages-${file.id}`}
                            className="page-range-input"
                            value={file.pageSelection === "all" ? "" : file.pageSelection}
                            placeholder="e.g. 1-5 or 1,5 or 1"
                            onChange={(event) =>
                              setFiles((current) =>
                                current.map((f) =>
                                  f.id === file.id
                                    ? { ...f, pageSelection: event.target.value || "all" }
                                    : f
                                )
                              )
                            }
                          />
                        </div>
                      </div>
                    </>
                  )}
                </article>
              );
            })}

            {/* Add more files */}
            {files.length > 0 && (
              <button
                className="add-more-files-btn"
                type="button"
                onClick={() => fileInput.current?.click()}
              >
                <Plus size={16} /> Add more files
              </button>
            )}
          </div>

          {/* Desktop Quotation Card */}
          <aside className="quote-column" ref={quoteRef} aria-label="Order summary">
            <div className="quote-card">
              <div className="quote-badge-row">
                <span className="welcome-eyebrow" style={{ margin: 0 }}>
                  QUOTE SUMMARY
                </span>
              </div>

              <h2 className="quote-price-tag">{formatNaira(quote.total)}</h2>
              <p className="setting-desc" style={{ marginTop: -10 }}>
                {files.length} {files.length === 1 ? "document" : "documents"} · {quote.copyPages} pages
              </p>

              <div className="quote-breakdown-list">
                {quote.blackAndWhitePages > 0 && (
                  <div className="quote-line-item">
                    <span>Black &amp; white pages</span>
                    <strong>{quote.blackAndWhitePages}</strong>
                  </div>
                )}
                {quote.lightColorPages > 0 && (
                  <div className="quote-line-item">
                    <span>Color &lt;50%</span>
                    <strong>{quote.lightColorPages}</strong>
                  </div>
                )}
                {quote.heavyColorPages > 0 && (
                  <div className="quote-line-item">
                    <span>Color &gt;=50%</span>
                    <strong>{quote.heavyColorPages}</strong>
                  </div>
                )}
                <div className="quote-line-item">
                  <span>Printing subtotal</span>
                  <strong>{formatNaira(quote.printCost)}</strong>
                </div>
                {quote.anyStapled && (
                  <div className="quote-line-item">
                    <span>Stapling</span>
                    <strong>FREE</strong>
                  </div>
                )}
                {quote.anyBound && (
                  <div className="quote-line-item">
                    <span>Spiral binding</span>
                    <strong>{formatNaira(quote.finishingCost)}</strong>
                  </div>
                )}
                {quote.anyDuplex && (
                  <div className="quote-line-item">
                    <span>Front &amp; back printing</span>
                    <strong>Applied</strong>
                  </div>
                )}
                <div className="quote-line-item" style={{ paddingTop: 6, borderTop: "1px dashed var(--line)" }}>
                  <span>Physical sheets needed</span>
                  <strong>{quote.physicalSheets}</strong>
                </div>
              </div>

              <button
                className="pill-button"
                type="button"
                disabled={!canCreateOrder || openingSummary}
                onClick={goToCheckout}
              >
                {openingSummary ? "Opening summary…" : "Send to Print Desk"} <ArrowRight size={17} />
              </button>

              {/* Payment paused banner removed by request */}
            </div>

            <div className="rate-note">
              <p className="welcome-eyebrow">
                CAMPUS RATE CARD
              </p>
              <div className="rate-note-row">
                <span>Single · B&amp;W</span>
                <strong>{formatNaira(pricing.mono)}</strong>
              </div>
              <div className="rate-note-row">
                <span>Single · Color</span>
                <strong>{formatNaira(pricing.colorLight)}–{formatNaira(pricing.colorHeavy)}</strong>
              </div>
              <div className="rate-note-row">
                <span>Duplex · B&amp;W</span>
                <strong>{formatNaira(pricing.duplexMono)}</strong>
              </div>
              <div className="rate-note-row">
                <span>Duplex · Color</span>
                <strong>{formatNaira(pricing.duplexColor)}</strong>
              </div>
              <div className="rate-note-row">
                <span>Stapling</span>
                <strong className="rate-note-free">FREE</strong>
              </div>
              <div className="rate-note-row">
                <span>Binding</span>
                <strong>{formatNaira(pricing.binding)} / doc</strong>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Document Page Preview Modal */}
      {previewingFile && (
        <div className="modal-overlay" onClick={() => setPreviewingFile(null)}>
          <div className="preview-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="preview-modal-header">
              <div>
                <h3 className="setting-title">{previewingFile.file.name}</h3>
                <p className="setting-desc">
                  {previewingFile.pages} {previewingFile.pages === 1 ? "page" : "pages"} ·{" "}
                  {previewingFile.colorCoverage.filter((c) => c > 0.005).length} coloured ·{" "}
                  {previewingFile.colorCoverage.filter((c) => c <= 0.005).length} B&amp;W
                </p>
              </div>
              <button
                className="doc-close-btn"
                type="button"
                onClick={() => setPreviewingFile(null)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="preview-modal-body">
              {previewingFile.previewUrls.map((url, index) => {
                const coverage = previewingFile.colorCoverage[index] ?? 0;
                const isColor = coverage > 0.005;
                return (
                  <div className="preview-page-block" key={index}>
                    <span className={`preview-page-label ${isColor ? "is-color" : ""}`}>
                      <span className="color-dot" />
                      Page {index + 1} ·{" "}
                      {isColor ? `Coloured (~${Math.round(coverage * 100)}% ink)` : "Black & White"}
                    </span>
                    <div className="preview-canvas-wrapper">
                      <img src={url} alt={`Preview of page ${index + 1}`} loading="lazy" />
                    </div>
                  </div>
                );
              })}
              {previewingFile.previewUrls.length === 0 && (
                <p>Preview unavailable for this file type.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Notice Modal (e.g. file too large) */}
      {showConfirmation && (
        <div className="modal-overlay" onClick={() => setShowConfirmation(false)}>
          <div className="confirmation-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirmation-icon">
              <X size={22} />
            </div>
            <button
              className="doc-close-btn modal-close"
              type="button"
              onClick={() => setShowConfirmation(false)}
            >
              <X size={16} />
            </button>
            <p className="welcome-eyebrow">NOTICE</p>
            <h2>Upload Notice</h2>
            <p>{confirmationText}</p>
            <div className="modal-actions">
              <button className="primary-button" onClick={() => setShowConfirmation(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* <footer className="page-footer">
        <span>Campus Prints · University Student Printing</span>
        <Link href="/ccadmin">Operator Admin Queue</Link>
        <span>All rates in Nigerian Naira (NGN)</span>
      </footer> */}
    </main>
  );
}
