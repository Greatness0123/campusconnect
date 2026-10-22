"use client";

import { useEffect, useRef, useState } from "react";
import { convertOfficeToPdf } from "@/lib/office-to-pdf";

type Check = { name: string; pass: boolean; detail: string };

async function loadFixture(name: string): Promise<File> {
  const response = await fetch(`/__test__/${name}`);
  if (!response.ok) throw new Error(`fixture ${name} missing (HTTP ${response.status})`);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type });
}

async function runTests(): Promise<{
  pass: boolean;
  results: Check[];
  durations: Record<string, number>;
}> {
  const results: Check[] = [];
  const durations: Record<string, number> = {};
  function check(name: string, pass: boolean, detail: string) {
    results.push({ name, pass, detail });
  }
  const { PDFDocument } = await import("pdf-lib");

  // --- .docx conversion ---
  try {
    const t0 = performance.now();
    const converted = await convertOfficeToPdf(await loadFixture("fixture.docx"));
    durations["fixture.docx"] = Math.round(performance.now() - t0);

    check("docx: page count is 2", converted.pages === 2, `pages=${converted.pages}`);
    check(
      "docx: output named fixture.pdf",
      converted.pdfFile.name === "fixture.pdf" && converted.pdfFile.type === "application/pdf",
      `${converted.pdfFile.name} (${converted.pdfFile.type})`
    );

    const bytes = new Uint8Array(await converted.pdfFile.arrayBuffer());
    const magic = String.fromCharCode(...bytes.slice(0, 4));
    check("docx: PDF magic %PDF", magic === "%PDF", `magic=${magic}`);

    const back = await PDFDocument.load(bytes);
    check("docx: PDF reloads with 2 pages", back.getPageCount() === 2, `pages=${back.getPageCount()}`);

    const { width, height } = back.getPage(0).getSize();
    check(
      "docx: PDF page is A4 (595.3 x 841.9 pt)",
      Math.abs(width - 595.3) < 2 && Math.abs(height - 841.9) < 2,
      `${width.toFixed(1)} x ${height.toFixed(1)} pt`
    );

    check(
      "docx: coverage for both pages",
      converted.colorCoverage.length === 2,
      `coverage=${converted.colorCoverage.map((c) => c.toFixed(4)).join(", ")}`
    );
    check(
      "docx: red page detected as colour",
      (converted.colorCoverage[0] ?? 0) > 0.005,
      `page1=${(converted.colorCoverage[0] ?? 0).toFixed(4)}`
    );

    check(
      "docx: two jpeg previews",
      converted.previewUrls.length === 2 &&
        converted.previewUrls.every((u) => u.startsWith("data:image/jpeg")),
      converted.previewUrls.map((u) => `${u.slice(0, 15)}…(${u.length} chars)`).join(" | ")
    );
    check(
      "docx: converted under 60s deadline",
      (durations["fixture.docx"] ?? 999999) < 60000,
      `${durations["fixture.docx"]} ms`
    );
  } catch (error) {
    check("docx: converts without error", false, String(error));
  }

  // --- .pptx conversion ---
  try {
    const t0 = performance.now();
    const converted = await convertOfficeToPdf(await loadFixture("fixture.pptx"));
    durations["fixture.pptx"] = Math.round(performance.now() - t0);

    check("pptx: page count is 2", converted.pages === 2, `pages=${converted.pages}`);

    const bytes = new Uint8Array(await converted.pdfFile.arrayBuffer());
    const back = await PDFDocument.load(bytes);
    check("pptx: PDF reloads with 2 pages", back.getPageCount() === 2, `pages=${back.getPageCount()}`);

    const { width, height } = back.getPage(0).getSize();
    check(
      "pptx: slide is landscape (960 x 540 pt for 16:9)",
      width > height && Math.abs(width - 960) < 4 && Math.abs(height - 540) < 4,
      `${width.toFixed(1)} x ${height.toFixed(1)} pt`
    );
    check(
      "pptx: coverage for both slides",
      converted.colorCoverage.length === 2,
      `coverage=${converted.colorCoverage.map((c) => c.toFixed(4)).join(", ")}`
    );
    check(
      "pptx: red title detected as colour",
      (converted.colorCoverage[0] ?? 0) > 0.005,
      `slide1=${(converted.colorCoverage[0] ?? 0).toFixed(4)}`
    );
    check(
      "pptx: converted under 60s deadline",
      (durations["fixture.pptx"] ?? 999999) < 60000,
      `${durations["fixture.pptx"]} ms`
    );
  } catch (error) {
    check("pptx: converts without error", false, String(error));
  }

  // --- legacy .doc rejected with friendly guidance ---
  try {
    await convertOfficeToPdf(await loadFixture("fixture.doc"));
    check("legacy .doc: rejected", false, "conversion unexpectedly succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(
      "legacy .doc: rejected with save-as-docx guidance",
      message.includes("Word 97-2003 (.doc)") && message.includes("save it as .docx"),
      message
    );
  }

  // --- legacy .ppt rejected with friendly guidance ---
  try {
    await convertOfficeToPdf(await loadFixture("fixture.ppt"));
    check("legacy .ppt: rejected", false, "conversion unexpectedly succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(
      "legacy .ppt: rejected with save-as-pptx guidance",
      message.includes("PowerPoint 97-2003 (.ppt)") && message.includes("save it as .pptx"),
      message
    );
  }

  // --- garbage bytes with .docx extension ---
  try {
    await convertOfficeToPdf(await loadFixture("garbage.docx"));
    check("garbage .docx: rejected", false, "conversion unexpectedly succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(
      "garbage .docx: rejected with re-save guidance",
      message.includes("could not be opened"),
      message
    );
  }

  return { pass: results.every((r) => r.pass), results, durations };
}

export default function ConvertTestPage() {
  const started = useRef(false);
  const [report, setReport] = useState<string>("RUNNING…");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    runTests()
      .then((outcome) => {
        (window as unknown as { __testResults?: object }).__testResults = outcome;
        setReport(JSON.stringify(outcome, null, 2));
      })
      .catch((error) => {
        const failure = { pass: false, fatal: String(error) };
        (window as unknown as { __testResults?: object }).__testResults = failure;
        setReport(JSON.stringify(failure, null, 2));
      });
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "monospace" }}>
      <h1>Office conversion E2E</h1>
      <pre id="test-results">{report}</pre>
    </main>
  );
}
