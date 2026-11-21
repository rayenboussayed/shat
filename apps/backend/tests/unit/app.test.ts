import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";

describe("Fastify application", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns the health status", async () => {
    const response = await app.inject({ url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("sets secure response headers", async () => {
    const response = await app.inject({ url: "/health" });

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
  });

  it("returns a typed 404 for unknown routes", async () => {
    const response = await app.inject({ url: "/missing" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      statusCode: 404,
      error: "Not Found",
      message: "The requested resource was not found",
    });
  });

  it("does not trust a caller-provided request ID", async () => {
    const response = await app.inject({
      url: "/health",
      headers: { "x-request-id": "caller-controlled" },
    });

    expect(response.headers["x-request-id"]).not.toBe("caller-controlled");
  });
});
