import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { ZodError, z } from "zod";
import { ActionRuntime, RuntimeError } from "./runtime.js";
import type { Store } from "./store.js";

const actionParams = z.object({ id: z.string().uuid() });
const scenarioParams = z.object({ id: z.string() });
const humanSessionCookie = "openagent_human_session";

function getHumanSession(request: FastifyRequest, reply: FastifyReply) {
  const cookies: Record<string, string> = {};
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    cookies[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
  }
  const existing = z.string().uuid().safeParse(cookies[humanSessionCookie]);
  if (existing.success) return existing.data;

  const sessionId = randomUUID();
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  reply.header(
    "set-cookie",
    `${humanSessionCookie}=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600${secure}`,
  );
  return sessionId;
}

function isClientHttpError(
  error: unknown,
): error is { statusCode: number; code?: string; message: string } {
  return (
    error instanceof Error &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  );
}

export function buildApp(store: Store) {
  const app = Fastify({
    logger:
      process.env.NODE_ENV !== "test"
        ? { level: process.env.LOG_LEVEL ?? "info" }
        : false,
  });
  const runtime = new ActionRuntime(store);

  void app.register(helmet);
  app.get("/api/health", () => ({ status: "ok" }));
  app.get("/api/snapshot", async (request, reply) => {
    getHumanSession(request, reply);
    return runtime.snapshot();
  });
  app.post("/api/capabilities/:tool/invoke", async (request, reply) => {
    const { tool } = z.object({ tool: z.string() }).parse(request.params);
    const body = z
      .object({
        source: z.enum(["webmcp", "workbench"]).default("webmcp"),
        input: z.unknown(),
      })
      .parse(request.body);
    const humanSessionId = getHumanSession(request, reply);
    return reply
      .code(201)
      .send(
        await runtime.invokeCapability(
          tool,
          body.input,
          body.source,
          humanSessionId,
        ),
      );
  });
  app.post("/api/scenarios", async (request, reply) =>
    reply.code(201).send(await runtime.createScenario(request.body)),
  );
  app.post("/api/scenarios/:id/runs", async (request, reply) => {
    const { id } = scenarioParams.parse(request.params);
    const humanSessionId = getHumanSession(request, reply);
    return reply.code(201).send(await runtime.runScenario(id, humanSessionId));
  });
  app.post("/api/actions/:id/approve", async (request, reply) => {
    const { id } = actionParams.parse(request.params);
    const body = z
      .object({ acknowledgement: z.string().max(40).optional() })
      .parse(request.body);
    const humanSessionId = getHumanSession(request, reply);
    return runtime.approve(id, humanSessionId, body.acknowledgement);
  });
  app.post("/api/actions/:id/reject", async (request) => {
    const { id } = actionParams.parse(request.params);
    return runtime.reject(id);
  });
  app.post("/api/actions/:id/undo", async (request) => {
    const { id } = actionParams.parse(request.params);
    return runtime.undo(id);
  });
  app.put("/api/contracts/mode", async (request) => {
    const { mode } = z
      .object({ mode: z.enum(["ambiguous", "improved"]) })
      .parse(request.body);
    return runtime.setContractMode(mode);
  });
  app.get("/api/scenarios/:id/compare", async (request) => {
    const { id } = scenarioParams.parse(request.params);
    return runtime.compare(id);
  });
  app.get("/api/ledger/integrity", async (request) => {
    const { fixture } = z
      .object({ fixture: z.enum(["broken"]).optional() })
      .parse(request.query);
    return runtime.verifyIntegrity(fixture === "broken");
  });
  app.get("/api/ledger/export", async (_request, reply) => {
    reply.header("content-disposition", 'attachment; filename="ledger.json"');
    return runtime.exportLedger();
  });
  app.post("/api/demo/reset", async () => {
    await runtime.reset();
    return { reset: true };
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        issues: error.issues,
      });
    }
    if (error instanceof RuntimeError)
      return reply
        .code(error.statusCode)
        .send({ code: error.code, message: error.message });
    if (isClientHttpError(error)) {
      return reply.code(error.statusCode).send({
        code: error.code ?? "BAD_REQUEST",
        message: error.message,
      });
    }
    app.log.error(error);
    return reply.code(500).send({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    });
  });

  const clientRoot = resolve(process.cwd(), "dist/client");
  if (existsSync(clientRoot)) {
    void app.register(fastifyStatic, { root: clientRoot, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/"))
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Endpoint not found." });
      return reply.sendFile("index.html");
    });
  }
  return app;
}
