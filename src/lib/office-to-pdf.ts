import { estimateColorCoverage } from "@/lib/analysis";

export const OFFICE_EXTENSIONS = ["doc", "docx", "ppt", "pptx"] as const;

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
  if (extension === "doc") {
    return new Error(
      "This is an older Word 97-2003 (.doc) file. Open it in Word and save it as .docx, then upload it again."
    );
  }
  if (extension === "ppt") {
    return new Error(
      "This is an older PowerPoint 97-2003 (.ppt) file. Open it in PowerPoint and save it as .pptx, then upload it again."
    );
  }
  return new Error(
    `This ${extension.toUpperCase()} file looks password-protected or saved in an old format. Remove the password (or open it and save it as .${extension}), then upload it again.`
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
  const [{ init }, { loadAsync }] = await Promise.all([
    import("pptx-preview"),
    import("jszip"),
  ]);

  // pptx-preview needs the target width up front, so read the native slide
  // size (EMU) from presentation.xml and pass it in CSS pixels.
  let slideWidthPx = 960;
  try {
    const zip = await loadAsync(arrayBuffer);
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

async function canvasToJpegBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", PDF_JPEG_QUALITY)
  );
  if (!blob) throw new Error("Your browser could not render this page.");
  return new Uint8Array(await blob.arrayBuffer());
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
    "position:fixed;top:0;left:-100000px;pointer-events:none;z-index:-1;";
  document.body.appendChild(container);

  try {
    onProgress?.("Reading document structure…");
    const arrayBuffer = await file.arrayBuffer();

    const pageElements =
      extension === "doc" || extension === "docx"
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

      const canvas = await domToCanvas(element, {
        scale: CAPTURE_SCALE,
        backgroundColor: "#ffffff",
      });

      const previewCanvas = document.createElement("canvas");
      previewCanvas.width = Math.min(PREVIEW_WIDTH, canvas.width);
      previewCanvas.height = Math.max(
        1,
        Math.round((canvas.height / canvas.width) * previewCanvas.width)
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
