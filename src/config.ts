import { inspect } from "node:util";

import { z } from "zod";

const optionalUrlSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.url().optional(),
);

const environmentSchema = z
  .object({
    CALDAV_PROVIDER: z.enum(["generic", "icloud"]).default("icloud"),
    CALDAV_URL: optionalUrlSchema,
    CALDAV_USERNAME: z.string().min(1),
    CALDAV_PASSWORD: z.string().min(1),
    CALDAV_MCP_TRANSPORT: z.enum(["stdio", "streamable-http"]).default("stdio"),
    CALDAV_MCP_HOST: z.string().min(1).default("0.0.0.0"),
    CALDAV_MCP_PORT: z.coerce.number().int().min(1).max(65_535).default(8100),
    CALDAV_MCP_LOG_LEVEL: z
      .enum(["DEBUG", "INFO", "WARNING", "ERROR"])
      .default("INFO"),
    CALDAV_MCP_REQUEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .default(30_000),
  })
  .superRefine((value, context) => {
    if (value.CALDAV_PROVIDER === "generic" && value.CALDAV_URL === undefined) {
      context.addIssue({
        code: "custom",
        message: "CALDAV_URL is required for the generic provider",
        path: ["CALDAV_URL"],
      });
    }
  });

export type AppConfig = {
  readonly provider: "generic" | "icloud";
  readonly url: string;
  readonly username: string;
  readonly password: string;
  readonly transport: "stdio" | "streamable-http";
  readonly host: string;
  readonly port: number;
  readonly logLevel: "DEBUG" | "INFO" | "WARNING" | "ERROR";
  readonly requestTimeoutMs: number;
};

export type PublicAppConfig = Omit<AppConfig, "password"> & {
  readonly password: "[REDACTED]";
};

const defaultICloudUrl = "https://caldav.icloud.com";

export const loadConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig => {
  const parsed = environmentSchema.parse(environment);
  const config: AppConfig = {
    provider: parsed.CALDAV_PROVIDER,
    url: parsed.CALDAV_URL ?? defaultICloudUrl,
    username: parsed.CALDAV_USERNAME,
    password: parsed.CALDAV_PASSWORD,
    transport: parsed.CALDAV_MCP_TRANSPORT,
    host: parsed.CALDAV_MCP_HOST,
    port: parsed.CALDAV_MCP_PORT,
    logLevel: parsed.CALDAV_MCP_LOG_LEVEL,
    requestTimeoutMs: parsed.CALDAV_MCP_REQUEST_TIMEOUT_MS,
  };
  Object.defineProperties(config, {
    toJSON: {
      value: () => redactConfig(config),
    },
    [inspect.custom]: {
      value: () => redactConfig(config),
    },
  });
  return config;
};

export const redactConfig = (config: AppConfig): PublicAppConfig => ({
  ...config,
  password: "[REDACTED]",
});
