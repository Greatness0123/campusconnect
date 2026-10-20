# Campus Prints production notes

The current frontend is a local preview. Files stay in the browser and demo orders use local storage; the admin queue is not authenticated and must not be exposed as a production admin surface.

## File processing

- PDF.js renders PDF pages in-browser and estimates page/color coverage from rendered previews. This is a useful quote estimate, not printer-side preflight.
- JPG, PNG and WEBP are previewed as one page.
- DOC, DOCX, PPT and PPTX require server-side conversion to PDF. Mammoth converts DOCX structure to HTML but does not preserve print layout, so it is not sufficient for page counts or final print quotes.
- Production should preview the exact converted print artifact and apply upload-size, conversion-time and memory limits.

## Supabase and orders

- Add a signed device identity or Supabase Auth mapping, order tables with Row Level Security, and a private Storage bucket.
- Upload both source and print-ready files privately. Admin document retrieval should use short-lived signed URLs, not a public bucket.
- Create and notify orders from a server-side trusted path. Recalculate the price on the server from verified page/color analysis and a versioned rate card.
- Secure the admin route with an admin role check before connecting live orders or files.
- Supabase Free projects may be paused after a period of low activity. A scheduled ping is not a guaranteed uptime strategy; choose a plan based on availability needs and confirm current Supabase terms before implementing keep-alives.

## Current demonstration rate card

Single-sided B&W: NGN 100 per page. Color below 50%: NGN 150 per page. Color at or above 50%: NGN 200 per page. Front/back B&W: NGN 70 per printed page. Front/back color: NGN 150 per printed page. Stapling: free. Binding: NGN 500 per copy. Confirm all rates with the print operator before production.

Payments are intentionally not implemented.
