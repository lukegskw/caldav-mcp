/**
 * The MCP TypeScript SDK converts Zod tool schemas with a hardcoded
 * `target: "draft-7"` (see server/zod-json-schema-compat.js), stamping
 * `"$schema": "http://json-schema.org/draft-07/schema#"` onto every
 * inputSchema and outputSchema. Claude's client validates tool output
 * schemas with Ajv configured for JSON Schema 2020-12 only and rejects
 * the tool before dispatch.
 *
 * The schema bodies we emit are dialect-agnostic (type/properties/required/
 * additionalProperties/anyOf/const/pattern/format/minimum/maximum/default),
 * so dropping the `$schema` annotation lets each client apply its own
 * default dialect without changing any validation semantics.
 */

import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

type JsonRecord = Record<string, unknown>;

const isJsonRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stripDialect = (value: unknown): void => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      stripDialect(entry);
    }
    return;
  }
  if (!isJsonRecord(value)) {
    return;
  }
  delete value["$schema"];
  for (const nested of Object.values(value)) {
    stripDialect(nested);
  }
};

export const stripSchemaDialect = (message: unknown): void => {
  if (!isJsonRecord(message)) {
    return;
  }
  const result = message["result"];
  if (!isJsonRecord(result)) {
    return;
  }
  const tools = result["tools"];
  if (!Array.isArray(tools)) {
    return;
  }
  for (const tool of tools) {
    if (!isJsonRecord(tool)) {
      continue;
    }
    stripDialect(tool["inputSchema"]);
    stripDialect(tool["outputSchema"]);
  }
};

export const withSchemaDialectFix = <T extends Transport>(transport: T): T => {
  const send = transport.send.bind(transport);
  transport.send = async (
    message: Parameters<Transport["send"]>[0],
    options?: Parameters<Transport["send"]>[1],
  ) => {
    stripSchemaDialect(message);
    return send(message, options);
  };
  return transport;
};
