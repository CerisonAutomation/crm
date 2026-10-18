import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { SETTINGS_SECTIONS } from "@/lib/settings/registry";

const SECTION_KEYS = SETTINGS_SECTIONS.map((s) => s.key);

const jsonContent = (schema: Record<string, unknown>) => ({ "application/json": { schema } });
const jsonResponse = (description: string, schema?: Record<string, unknown>) => ({
  description,
  ...(schema ? { content: jsonContent(schema) } : {}),
});
const ERROR_RESPONSES = {
  400: jsonResponse("Validation error", { $ref: "#/components/schemas/Error" }),
  401: jsonResponse("Authentication required", { $ref: "#/components/schemas/Error" }),
  403: jsonResponse("Forbidden", { $ref: "#/components/schemas/Error" }),
};

/**
 * GET /api/openapi — the machine-drivable integration surface as an OpenAPI 3.1
 * document (JSON). Staff only (CLIENT → 403).
 *
 * Scope is deliberately honest: this describes ONLY the surface an external
 * system (an MCP client, an ops script) drives — the platform settings, the
 * manifest, the compliance/RoPA + retention routes and the webhook/automation
 * endpoints. It is NOT a description of the whole application; the browser UI
 * and the internal domain routes are intentionally out of scope.
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    if (ctx.role === "CLIENT") throw new DomainError("Forbidden", 403);

    return jsonOk({
      openapi: "3.1.0",
      info: {
        title: "Citizen Lane — Integration API",
        version: "1.0.0",
        description:
          "The machine-drivable INTEGRATION surface only: platform settings (read/write/reset), the platform manifest, the compliance record (RoPA) and retention runner, and the outbound webhook + automation endpoints. This document deliberately does NOT describe the whole application — the browser UI and the internal domain routes (cases, documents, messages, calls, workflows, pages, admin console, …) are out of scope. Authenticate with the session cookie or `Authorization: Bearer <token>`.",
      },
      servers: [{ url: "/", description: "Same-origin platform deployment" }],
      security: [{ bearerAuth: [] }, { cookieAuth: [] }],
      tags: [
        { name: "settings", description: "Registry-driven platform settings" },
        { name: "manifest", description: "Platform manifest (registry + topics + integrations)" },
        { name: "compliance", description: "Data-governance register and retention runner" },
        { name: "webhooks", description: "Outbound webhook endpoint management" },
        { name: "automation", description: "Automation backend health and control" },
      ],
      paths: {
        "/api/settings": {
          get: {
            tags: ["settings"],
            summary: "Read the settings sections the caller's role may read",
            responses: {
              "200": jsonResponse("Merged settings (only readable sections)", {
                type: "object",
                properties: { settings: { type: "object" } },
              }),
              ...ERROR_RESPONSES,
            },
          },
        },
        "/api/settings/{section}": {
          parameters: [
            {
              name: "section",
              in: "path",
              required: true,
              schema: { type: "string", enum: SECTION_KEYS },
            },
          ],
          get: {
            tags: ["settings"],
            summary: "Read one settings section (role must be in its readRoles)",
            responses: {
              "200": jsonResponse("The section, merged over canon", {
                type: "object",
                properties: { settings: { type: "object" } },
              }),
              ...ERROR_RESPONSES,
            },
          },
          put: {
            tags: ["settings"],
            summary: "Write one settings section (settings.write + section writeRoles)",
            requestBody: {
              required: true,
              content: jsonContent({ type: "object", additionalProperties: true }),
            },
            responses: {
              "200": jsonResponse("The merged platform snapshot after the write", {
                type: "object",
                properties: { settings: { type: "object" } },
              }),
              ...ERROR_RESPONSES,
            },
          },
        },
        "/api/settings/{section}/reset": {
          parameters: [
            {
              name: "section",
              in: "path",
              required: true,
              schema: { type: "string", enum: SECTION_KEYS },
            },
          ],
          post: {
            tags: ["settings"],
            summary: "Reset one settings section to canon",
            responses: {
              "200": jsonResponse("The section reverted to defaults", {
                type: "object",
                properties: { settings: { type: "object" }, reset: { type: "boolean" } },
              }),
              ...ERROR_RESPONSES,
            },
          },
        },
        "/api/manifest": {
          get: {
            tags: ["manifest"],
            summary: "Platform manifest: settings registry, topics, integrations and governance model",
            responses: {
              "200": jsonResponse("The manifest", { type: "object" }),
              ...ERROR_RESPONSES,
            },
          },
        },
        "/api/compliance/ropa": {
          get: {
            tags: ["compliance"],
            summary: "Record of Processing Activities (controller, activities, purge tier, legal hold)",
            responses: {
              "200": jsonResponse("The RoPA register", { $ref: "#/components/schemas/Ropa" }),
              ...ERROR_RESPONSES,
            },
          },
        },
        "/api/compliance/retention": {
          post: {
            tags: ["compliance"],
            summary: "Run the PURGE_TIER retention pass (optionally as a dry-run preview)",
            requestBody: {
              required: true,
              content: jsonContent({
                type: "object",
                required: ["reason"],
                properties: {
                  reason: { type: "string", description: "Mandatory justification, recorded in the audit trail" },
                  dryRun: { type: "boolean", description: "Count without deleting", default: false },
                },
              }),
            },
            responses: {
              "200": jsonResponse("Per-model purge results", {
                type: "object",
                properties: {
                  dryRun: { type: "boolean" },
                  results: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { model: { type: "string" }, days: { type: "integer" }, deleted: { type: "integer" } },
                    },
                  },
                },
              }),
              ...ERROR_RESPONSES,
            },
          },
        },
        "/api/integrations/webhooks": {
          get: {
            tags: ["webhooks"],
            summary: "List outbound webhook endpoints",
            responses: { "200": jsonResponse("Endpoints", { type: "object" }), ...ERROR_RESPONSES },
          },
          post: {
            tags: ["webhooks"],
            summary: "Create a webhook endpoint (signing secret returned once)",
            requestBody: {
              required: true,
              content: jsonContent({
                type: "object",
                required: ["url", "events"],
                properties: {
                  url: { type: "string", format: "uri" },
                  description: { type: "string" },
                  events: { type: "array", items: { type: "string" } },
                  active: { type: "boolean" },
                },
              }),
            },
            responses: { "201": jsonResponse("Endpoint created", { type: "object" }), ...ERROR_RESPONSES },
          },
        },
        "/api/integrations/webhooks/{id}": {
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          patch: {
            tags: ["webhooks"],
            summary: "Update a webhook endpoint (optionally rotate its signing secret)",
            requestBody: { required: true, content: jsonContent({ type: "object" }) },
            responses: { "200": jsonResponse("Endpoint updated", { type: "object" }), ...ERROR_RESPONSES },
          },
          delete: {
            tags: ["webhooks"],
            summary: "Delete a webhook endpoint and its delivery log",
            responses: { "200": jsonResponse("Endpoint deleted", { type: "object" }), ...ERROR_RESPONSES },
          },
        },
        "/api/integrations/webhooks/deliveries": {
          get: {
            tags: ["webhooks"],
            summary: "Delivery log for an endpoint (latest first)",
            parameters: [{ name: "endpointId", in: "query", required: false, schema: { type: "string" } }],
            responses: { "200": jsonResponse("Deliveries", { type: "object" }), ...ERROR_RESPONSES },
          },
        },
        "/api/automation": {
          get: {
            tags: ["automation"],
            summary: "Automation backend health, recent deliveries and backend inventory",
            responses: { "200": jsonResponse("Automation status", { type: "object" }), ...ERROR_RESPONSES },
          },
          post: {
            tags: ["automation"],
                        summary: "Emit a probe event onto the automation backend",
                        requestBody: {
                          required: false,
                          content: jsonContent({ type: "object", properties: { topic: { type: "string" }, note: { type: "string" } } }),
                        },
                        responses: { "200": jsonResponse("Probe result", { type: "object" }), ...ERROR_RESPONSES },
                      },
                    },
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer" },
          cookieAuth: { type: "apiKey", in: "cookie", name: "cl_session" },
        },
        schemas: {
          Error: {
            type: "object",
            properties: {
              error: { type: "string" },
              code: { type: "integer" },
              errorCode: { type: "string" },
              correlationId: { type: "string" },
            },
          },
          Ropa: {
            type: "object",
            properties: {
              generatedAt: { type: "string", format: "date-time" },
              controller: { type: "object" },
              activities: { type: "array", items: { type: "object" } },
              purgeTier: {
                type: "array",
                items: {
                  type: "object",
                  properties: { model: { type: "string" }, days: { type: "integer" } },
                },
              },
              legalHold: { type: "array", items: { type: "object" } },
              engagementLifetime: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    });
  })(req);
}
