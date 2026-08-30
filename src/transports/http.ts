import type { Server as HttpServer } from "node:http";

import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { Transport } from "@modelcontextprotocol/server";
import type { Request, Response } from "express";

import type { AppConfig } from "../config.js";
import type { CalendarService } from "../services/index.js";
import { createMcpServer } from "../tools/index.js";

export type RunningHttpTransport = {
  readonly close: () => Promise<void>;
};

const internalErrorResponse = (response: Response): void => {
  if (response.headersSent) {
    return;
  }
  response.status(500).json({
    jsonrpc: "2.0",
    error: { code: -32603, message: "Internal server error" },
    id: null,
  });
};

const closeRequestResources = (
  transport: NodeStreamableHTTPServerTransport,
  server: ReturnType<typeof createMcpServer>,
): void => {
  void Promise.all([transport.close(), server.close()]).catch(() => undefined);
};

const bridgeTransport = (
  transport: NodeStreamableHTTPServerTransport,
): Transport => {
  const bridge: Transport = {
    onclose: () => undefined,
    onerror: () => undefined,
    onmessage: () => undefined,
    start: () => transport.start(),
    close: () => transport.close(),
    send: (message, options) =>
      transport.send(
        message,
        options?.relatedRequestId === undefined
          ? undefined
          : { relatedRequestId: options.relatedRequestId },
      ),
  };
  transport.onclose = () => bridge.onclose?.();
  transport.onerror = (error) => bridge.onerror?.(error);
  transport.onmessage = (message, extra) => bridge.onmessage?.(message, extra);
  return bridge;
};

export const startHttpTransport = async (
  service: CalendarService,
  config: AppConfig,
): Promise<RunningHttpTransport> => {
  const app = createMcpExpressApp({ host: config.host });

  const handlePost = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const server = createMcpServer(service);
    const transport = new NodeStreamableHTTPServerTransport();
    try {
      await server.connect(bridgeTransport(transport));
      const body: unknown = request.body;
      await transport.handleRequest(request, response, body);
      response.on("close", () => {
        closeRequestResources(transport, server);
      });
    } catch {
      closeRequestResources(transport, server);
      internalErrorResponse(response);
    }
  };

  app.post("/mcp", (request, response) => {
    void handlePost(request, response);
  });

  const methodNotAllowed = (_request: Request, response: Response): void => {
    response.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed" },
      id: null,
    });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  const httpServer = await new Promise<HttpServer>((resolve, reject) => {
    const handleError = (error: Error): void => {
      reject(error);
    };
    const candidate = app.listen(config.port, config.host, (error) => {
      candidate.off("error", handleError);
      if (error === undefined) {
        resolve(candidate);
      } else {
        reject(error);
      }
    });
    candidate.once("error", handleError);
  });

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      }),
  };
};
