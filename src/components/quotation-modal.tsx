"use client";

import { Download, FileDown, LoaderCircle, X } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";
import { domToPng } from "modern-screenshot";
import { PDFDocument } from "pdf-lib";
import { deliveryTiers, formatNaira, type Fulfilment, type LocationArea, type Quote } from "@/lib/print";

export type QuotationModalProps = {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  customer: string;
  phone?: string;
  area: LocationArea;
  location: string;
  fulfilment?: Fulfilment | "delivery";
  date?: string;
  quote?: Quote | null;
  documents?: { name: string; pages: number; copies: number }[];
  total: number;
  printMode?: string;
  sides?: string;
  stapling?: string;
  binding?: string;
};

export function QuotationModal({
  isOpen,
  onClose,
  orderId,
  customer,
  phone,
  area,
  location,
  fulfilment = "collection",
  date,
  quote,
  documents,
  total,
  printMode,
  sides,
  stapling,
  binding,
}: QuotationModalProps) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [downloadingImage, setDownloadingImage] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  if (!isOpen) return null;

  const displayDate = date
    ? new Date(date).toLocaleString("en-NG", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : new Date().toLocaleString("en-NG", {
        dateStyle: "medium",
        timeStyle: "short",
      });

  async function generatePngDataUrl(): Promise<string | null> {
    if (!receiptRef.current) return null;
    return await domToPng(receiptRef.current, {
      scale: 2,
      backgroundColor: "#ffffff",
      quality: 0.95,
      features: {
        // preserve background styling
        removeControlCharacter: false,
      },
    });
  }

  async function handleSaveAsImage() {
    if (downloadingImage || downloadingPdf) return;
    setDownloadingImage(true);
    try {
      const dataUrl = await generatePngDataUrl();
      if (!dataUrl) throw new Error("Could not capture receipt.");
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `CampusConnect_Quotation_${orderId}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Save image failed:", err);
      alert("Could not save image. Please try again.");
    } finally {
      setDownloadingImage(false);
    }
  }

  async function handleSaveAsPdf() {
    if (downloadingImage || downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      const dataUrl = await generatePngDataUrl();
      if (!dataUrl) throw new Error("Could not capture receipt.");

      const pngBytes = await fetch(dataUrl).then((res) => res.arrayBuffer());
      const pdfDoc = await PDFDocument.create();
      const embeddedImage = await pdfDoc.embedPng(pngBytes);

      const imgWidth = embeddedImage.width;
      const imgHeight = embeddedImage.height;

      // Fit to PDF page size (portrait)
      const page = pdfDoc.addPage([imgWidth, imgHeight]);
      page.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: imgWidth,
        height: imgHeight,
      });

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      const blobUrl = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `CampusConnect_Quotation_${orderId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Save PDF failed:", err);
      alert("Could not save PDF. Please try again.");
    } finally {
      setDownloadingPdf(false);
    }
  }

  return (
    <div className="modal-overlay quotation-overlay" onClick={onClose}>
      <div className="quotation-modal-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Modal Top Actions */}
        <div className="quotation-modal-header">
          <div className="quotation-modal-title">
            <span>Official Quotation</span>
            <small>{orderId}</small>
          </div>
          <button
            className="doc-close-btn"
            type="button"
            onClick={onClose}
            aria-label="Close quotation preview"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Receipt Container */}
        <div className="quotation-scroll-container">
          {/* Printable OPay-style rounded card */}
          <div className="quotation-receipt-box" ref={receiptRef}>
            {/* Logo Backdrop Watermark */}
            <div className="quotation-watermark" aria-hidden="true">
              <div className="quotation-watermark-circle">
                <Image
                  src="/icononly.png"
                  alt=""
                  width={260}
                  height={260}
                  priority
                />
              </div>
            </div>

            {/* Receipt Content */}
            <div className="quotation-receipt-content">
              {/* Header */}
              <div className="quotation-receipt-head">
                <div className="quotation-brand">
                  <div className="quotation-logo-circle">
                    <Image
                      className="brand-logo"
                      src="/icononly.png"
                      alt="Campus Prints"
                      width={36}
                      height={36}
                      priority
                    />
                  </div>
                  <div>
                    <strong className="quotation-brand-name">Campus Prints</strong>
                    <span className="quotation-brand-tag">Smart students print with us</span>
                  </div>
                </div>
                <div className="quotation-receipt-tag">Quotation Receipt</div>
              </div>

              {/* Amount Display */}
              <div className="quotation-amount-section">
                <span className="quotation-amount-label">Total Amount</span>
                <h1 className="quotation-amount-val">{formatNaira(total)}</h1>
                <span className="quotation-date-tag">{displayDate}</span>
              </div>

              <div className="quotation-divider" />

              {/* Meta information */}
              <div className="quotation-grid">
                <div className="quotation-meta-item">
                  <span className="q-label">Reference ID</span>
                  <strong className="q-val">{orderId}</strong>
                </div>
                <div className="quotation-meta-item">
                  <span className="q-label">Customer Name</span>
                  <strong className="q-val">{customer}</strong>
                </div>
                {phone && (
                  <div className="quotation-meta-item">
                    <span className="q-label">Phone Number</span>
                    <strong className="q-val">{phone}</strong>
                  </div>
                )}
                <div className="quotation-meta-item">
                  <span className="q-label">
                    {fulfilment === "collection" ? "Pickup Spot" : "Delivery Spot"}
                  </span>
                  <strong className="q-val">
                    {area} · {location}
                  </strong>
                </div>
                {(sides || printMode) && (
                  <div className="quotation-meta-item">
                    <span className="q-label">Specifications</span>
                    <strong className="q-val">
                      {[printMode, sides, stapling, binding].filter(Boolean).join(" · ")}
                    </strong>
                  </div>
                )}
              </div>

              <div className="quotation-divider" />

              {/* Items Breakdown */}
              <div className="quotation-items-section">
                <span className="q-section-title">Documents</span>
                {quote?.perFile && quote.perFile.length > 0 ? (
                  <div className="quotation-items-list">
                    {quote.perFile.map((file, idx) => (
                      <div className="quotation-item-row" key={file.id || idx}>
                        <div className="quotation-item-main">
                          <strong>Doc {idx + 1}</strong>
                          <small>
                            {file.selectedCount}p × {file.copies} copy ·{" "}
                            {file.bwPages > 0 ? `${file.bwPages} B&W ` : ""}
                            {file.lightColorPages > 0 ? `${file.lightColorPages} Color Low ` : ""}
                            {file.heavyColorPages > 0 ? `${file.heavyColorPages} Color High` : ""}
                            {file.bound ? " · Spiral bound" : ""}
                            {file.stapled ? " · Stapled" : ""}
                          </small>
                        </div>
                        <div className="quotation-item-price">
                          {formatNaira(file.totalCost)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : documents && documents.length > 0 ? (
                  <div className="quotation-items-list">
                    {documents.map((doc, idx) => (
                      <div className="quotation-item-row" key={idx}>
                        <div className="quotation-item-main">
                          <strong>{doc.name}</strong>
                          <small>
                            {doc.pages} pages × {doc.copies} {doc.copies === 1 ? "copy" : "copies"}
                          </small>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Summary Totals */}
              {quote && (
                <div className="quotation-summary-stats">
                  <div className="quotation-stat-row">
                    <span>Physical paper sheets</span>
                    <strong>{quote.physicalSheets} sheets</strong>
                  </div>
                  <div className="quotation-stat-row">
                    <span>Printing cost</span>
                    <strong>{formatNaira(quote.printCost)}</strong>
                  </div>
                  {quote.night && (
                    <div className="quotation-stat-row">
                      <span>Night rates (10pm–6am)</span>
                      <strong>Applied</strong>
                    </div>
                  )}
                  {quote.finishingCost > 0 && (
                    <div className="quotation-stat-row">
                      <span>Finishing &amp; binding</span>
                      <strong>{formatNaira(quote.finishingCost)}</strong>
                    </div>
                  )}
                  <div className="quotation-stat-row">
                    <span>
                      {fulfilment === "collection"
                        ? "Collection"
                        : fulfilment === "express"
                        ? "Express delivery"
                        : "Standard delivery"}
                    </span>
                    <strong style={{ color: "var(--success)" }}>
                      {fulfilment === "express"
                        ? formatNaira(deliveryTiers.express.fee)
                        : "FREE"}
                    </strong>
                  </div>
                </div>
              )}

              <div className="quotation-divider" />

              {/* Footer */}
              <div className="quotation-footer">
                <p>Smart students print with us. Fast, neat, and reliable.</p>
                <small>Generated via CampusConnect print service</small>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons Below Rounded Box */}
        <div className="quotation-actions">
          <button
            className="pill-button quotation-btn"
            type="button"
            disabled={downloadingImage || downloadingPdf}
            onClick={handleSaveAsImage}
          >
            {downloadingImage ? (
              <>
                <LoaderCircle className="spin" size={16} /> Saving image…
              </>
            ) : (
              <>
                <Download size={16} /> Save as image
              </>
            )}
          </button>

          <button
            className="pill-button quotation-btn quotation-btn-alt"
            type="button"
            disabled={downloadingImage || downloadingPdf}
            onClick={handleSaveAsPdf}
          >
            {downloadingPdf ? (
              <>
                <LoaderCircle className="spin" size={16} /> Generating PDF…
              </>
            ) : (
              <>
                <FileDown size={16} /> Save as PDF
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
