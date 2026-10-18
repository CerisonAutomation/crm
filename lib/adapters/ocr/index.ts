/**
 * OCR two-stage barrel - preserves the existing '@/lib/adapters/ocr' import
 * path (the engine moved to ./engine.ts unchanged in behaviour).
 *
 * NOTE: ./provisional is intentionally NOT re-exported here - it is a
 * "use client" browser module; server code imports this barrel, client code
 * imports ./provisional directly. Mixing them would drag the client boundary
 * into server routes.
 */
export * from "./engine";
export * from "./types";
export * from "./normalize";
export * from "./searchable-pdf";
export * from "./retention";
export * from "./authoritative";
