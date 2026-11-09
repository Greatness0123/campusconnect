import { estimateColorCoverage } from "@/lib/analysis";

export const WORD_EXTENSIONS = ["doc", "docx", "docm", "dot", "dotx", "dotm"] as const;
export const PPT_EXTENSIONS = [
  "ppt",
  "pptx",
  "pptm",
  "pot",
  "potx",
  "potm",
  "pps",
  "ppsx",
  "ppsm",
] as const;
export const OFFICE_EXTENSIONS = [...WORD_EXTENSIONS, ...PPT_EXTENSIONS] as const;

export function isOfficeFilename(name: string): boolean {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return (OFFICE_EXTENSIONS as readonly string[]).includes(extension);
}

export type OfficeConversionResult = {
  pdfFile: File;
  pages: number;
  colorCoverage: number[];
  previewUrls: string[];
};

const MAX_PAGES = 250;
const CONVERSION_DEADLINE_MS = 60_000;
// Capture pages at 2.5x (240 DPI) — sharp print output while staying well
// under mobile canvas limits and keeping conversion quick.
const CAPTURE_SCALE = 2.5;
const MAX_CAPTURE_DIMENSION = 2400;
const PREVIEW_WIDTH = 480;
const PDF_JPEG_QUALITY = 0.9;
const PREVIEW_JPEG_QUALITY = 0.75;

const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const TIMEOUT_ERROR_NAME = "OfficeConversionTimeout";

function timeoutError(): Error {
  const error = new Error(
    "Conversion took too long. Split the document into smaller files and try again."
  );
  error.name = TIMEOUT_ERROR_NAME;
  return error;
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError()), CONVERSION_DEADLINE_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function sniffSignature(file: File): Promise<"ole" | "zip" | "unknown"> {
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (header.length >= 8 && OLE_SIGNATURE.every((byte, index) => header[index] === byte)) {
    return "ole";
  }
  if (header[0] === 0x50 && header[1] === 0x4b) {
    return "zip";
  }
  return "unknown";
}

function unsupportedFileError(): Error {
  return new Error(
    "This file could not be opened as a Word or PowerPoint document. Re-save it and try again."
  );
}

function legacyFormatError(extension: string): Error {
  if (extension === "doc" || extension === "dot") {
    return new Error(
      `This is an older Word 97-2003 (.${extension}) file. Open it in Word and save it as .docx, then upload it again.`
    );
  }
  if (extension === "ppt" || extension === "pot" || extension === "pps") {
    return new Error(
      `This is an older PowerPoint 97-2003 (.${extension}) file. Open it in PowerPoint and save it as .pptx, then upload it again.`
    );
  }
  return new Error(
    `This ${extension.toUpperCase()} file looks password-protected or saved in an old format. Remove the password (or open it and save it as a modern file), then upload it again.`
  );
}

function conversionFailedError(): Error {
  return new Error(
    "This document could not be converted. It may be damaged — open it and re-save it, then try again."
  );
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === TIMEOUT_ERROR_NAME;
}

async function renderDocxPages(
  arrayBuffer: ArrayBuffer,
  container: HTMLElement
): Promise<HTMLElement[]> {
  const { renderAsync } = await import("docx-preview");
  try {
    await withTimeout(
      renderAsync(arrayBuffer, container, container, {
        // Break pages where Word recorded its own pagination, plus any
        // explicit page/section breaks, so page counts match the document.
        breakPages: true,
        ignoreLastRenderedPageBreak: false,
        useBase64URL: true,
        renderChanges: false,
        renderComments: false,
      })
    );
  } catch (error) {
    if (isTimeoutError(error)) throw error;
    throw conversionFailedError();
  }
  return Array.from(container.querySelectorAll<HTMLElement>(".docx-wrapper > section"));
}

async function renderPptxPages(
  arrayBuffer: ArrayBuffer,
  container: HTMLElement
): Promise<HTMLElement[]> {
  const [{ init }, JSZipModule] = await Promise.all([
    import("pptx-preview"),
    import("jszip"),
  ]);
  const JSZip = JSZipModule.default;

  // pptx-preview needs the target width up front, so read the native slide
  // size (EMU) from presentation.xml and pass it in CSS pixels.
  let slideWidthPx = 960;
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const presentationXml = await zip.file("ppt/presentation.xml")?.async("text");
    const slideSizeTag = presentationXml?.match(/<p:sldSz\b[^>]*>/)?.[0];
    const cx = Number(slideSizeTag?.match(/\bcx="(\d+)"/)?.[1] ?? 0);
    if (cx > 0) slideWidthPx = Math.round(cx / 9525);
  } catch {
    throw conversionFailedError();
  }

  const previewer = init(container, { width: slideWidthPx, mode: "list" });
  try {
    await withTimeout(previewer.preview(arrayBuffer));
  } catch (error) {
    if (isTimeoutError(error)) throw error;
    throw conversionFailedError();
  }
  return Array.from(
    container.querySelectorAll<HTMLElement>(".pptx-preview-slide-wrapper")
  );
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIndex = dataUrl.indexOf(",");
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function canvasToJpegBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  // 1. Try standard toBlob with target quality
  let blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", PDF_JPEG_QUALITY)
  );
  if (blob) {
    return new Uint8Array(await blob.arrayBuffer());
  }

  // 2. Retry toBlob with slightly reduced quality if memory pressure was high
  blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.8)
  );
  if (blob) {
    return new Uint8Array(await blob.arrayBuffer());
  }

  // 3. Fallback to toDataURL (WebKit iOS quirk where toBlob fails but toDataURL succeeds)
  try {
    const dataUrl = canvas.toDataURL("image/jpeg", PDF_JPEG_QUALITY);
    if (dataUrl && dataUrl.length > 50 && !dataUrl.startsWith("data:,")) {
      return dataUrlToBytes(dataUrl);
    }
  } catch {
    // Continue to downscale fallback
  }

  // 4. Downscale fallback for iOS Safari devices with strict canvas area limits
  const maxDim = Math.max(canvas.width, canvas.height);
  if (maxDim > 1200) {
    const downscaleFactor = 1600 / maxDim;
    const safeCanvas = document.createElement("canvas");
    safeCanvas.width = Math.max(1, Math.round(canvas.width * downscaleFactor));
    safeCanvas.height = Math.max(1, Math.round(canvas.height * downscaleFactor));
    const safeCtx = safeCanvas.getContext("2d");
    if (safeCtx) {
      safeCtx.fillStyle = "#ffffff";
      safeCtx.fillRect(0, 0, safeCanvas.width, safeCanvas.height);
      safeCtx.drawImage(canvas, 0, 0, safeCanvas.width, safeCanvas.height);

      const safeBlob = await new Promise<Blob | null>((resolve) =>
        safeCanvas.toBlob(resolve, "image/jpeg", 0.85)
      );
      if (safeBlob) {
        safeCanvas.width = 0;
        safeCanvas.height = 0;
        return new Uint8Array(await safeBlob.arrayBuffer());
      }

      try {
        const safeDataUrl = safeCanvas.toDataURL("image/jpeg", 0.85);
        safeCanvas.width = 0;
        safeCanvas.height = 0;
        if (safeDataUrl && safeDataUrl.length > 50 && !safeDataUrl.startsWith("data:,")) {
          return dataUrlToBytes(safeDataUrl);
        }
      } catch {
        safeCanvas.width = 0;
        safeCanvas.height = 0;
      }
    }
  }

  throw new Error("Your browser could not render this page.");
}

export async function convertOfficeToPdf(
  file: File,
  onProgress?: (message: string) => void
): Promise<OfficeConversionResult> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  const signature = await sniffSignature(file);
  if (signature === "ole") throw legacyFormatError(extension);
  if (signature !== "zip") throw unsupportedFileError();

  const startedAt = Date.now();
  const checkDeadline = () => {
    if (Date.now() - startedAt > CONVERSION_DEADLINE_MS) throw timeoutError();
  };

  const container = document.createElement("div");
  container.setAttribute("aria-hidden", "true");
  container.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;opacity:0;pointer-events:none;z-index:-9999;overflow:hidden;";
  document.body.appendChild(container);

  try {
    onProgress?.("Reading document structure…");
    const arrayBuffer = await file.arrayBuffer();

    const isWord = (WORD_EXTENSIONS as readonly string[]).includes(extension);
    const pageElements = isWord
      ? await renderDocxPages(arrayBuffer, container)
      : await renderPptxPages(arrayBuffer, container);

    if (pageElements.length === 0) throw unsupportedFileError();
    if (pageElements.length > MAX_PAGES) {
      throw new Error(
        `This preview supports up to ${MAX_PAGES} pages at a time. Split the document into smaller files.`
      );
    }

    const [{ domToCanvas }, { PDFDocument }] = await Promise.all([
      import("modern-screenshot"),
      import("pdf-lib"),
    ]);

    const pdfDoc = await PDFDocument.create();
    const colorCoverage: number[] = [];
    const previewUrls: string[] = [];
    const total = pageElements.length;

    for (let index = 0; index < total; index += 1) {
      checkDeadline();
      onProgress?.(`Converting to PDF… (page ${index + 1} of ${total})`);

      const element = pageElements[index];
      const rect = element.getBoundingClientRect();
      const cssWidth = Math.max(1, rect.width);
      const cssHeight = Math.max(1, rect.height);

      const scale = Math.min(
        CAPTURE_SCALE,
        MAX_CAPTURE_DIMENSION / Math.max(cssWidth, cssHeight)
      );

      const canvas = await domToCanvas(element, {
        scale,
        maximumCanvasSize: MAX_CAPTURE_DIMENSION,
        backgroundColor: "#ffffff",
      });

      const previewCanvas = document.createElement("canvas");
      previewCanvas.width = Math.max(1, Math.min(PREVIEW_WIDTH, canvas.width));
      previewCanvas.height = Math.max(
        1,
        Math.round((canvas.height / Math.max(1, canvas.width)) * previewCanvas.width)
      );
      const previewContext = previewCanvas.getContext("2d", {
        willReadFrequently: true,
      });
      if (!previewContext) throw new Error("Your browser could not prepare a preview.");
      previewContext.fillStyle = "#ffffff";
      previewContext.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
      previewContext.drawImage(
        canvas,
        0,
        0,
        previewCanvas.width,
        previewCanvas.height
      );

      colorCoverage.push(
        estimateColorCoverage(
          previewContext.getImageData(
            0,
            0,
            previewCanvas.width,
            previewCanvas.height
          ).data
        )
      );
      previewUrls.push(
        previewCanvas.toDataURL("image/jpeg", PREVIEW_JPEG_QUALITY)
      );

      const jpegBytes = await canvasToJpegBytes(canvas);
      const image = await pdfDoc.embedJpg(jpegBytes);
      const pageWidth = cssWidth * 0.75;
      const pageHeight = cssHeight * 0.75;
      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });

      // Release page buffers immediately — a 250-page document must never
      // hold every full-resolution canvas in memory at once.
      previewCanvas.width = 0;
      previewCanvas.height = 0;
      canvas.width = 0;
      canvas.height = 0;

      // Yield briefly to the browser event loop so WebKit/mobile GC can reclaim graphics memory
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    onProgress?.("Building print-ready PDF…");
    const pdfBytes = await pdfDoc.save();
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const pdfFile = new File([new Uint8Array(pdfBytes)], `${baseName}.pdf`, {
      type: "application/pdf",
    });

    return { pdfFile, pages: total, colorCoverage, previewUrls };
  } finally {
    container.remove();
  }
}
