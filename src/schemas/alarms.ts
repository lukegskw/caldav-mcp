import { z } from "zod";

export const alarmInputSchema = z
  .object({
    minutes_before: z.number().int().min(0).max(525_600),
    action: z.literal("DISPLAY").default("DISPLAY"),
    description: z.string().max(1_024).optional(),
  })
  .strict();

export const alarmsInputSchema = z.array(alarmInputSchema).max(20);

export type AlarmInput = z.output<typeof alarmInputSchema>;
