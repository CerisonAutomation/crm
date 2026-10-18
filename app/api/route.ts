import { NextResponse } from "next/server";

// GET /api — service descriptor. Replaces the placeholder "Hello, world!"
// response so an accidental probe discloses the API identity, not a debug stub.
export async function GET() {
  return NextResponse.json({ name: "Citizen Lane API", status: "ok", docs: "/api/health" });
}
