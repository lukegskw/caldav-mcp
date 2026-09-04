import { z } from "zod";

export const alarmInputSchema = z
  .object({
    minutes_before: z
      .number()
      .int()
      .min(0)
      .max(525_600)
      .describe(
        "Whole minutes before the event start; use 0 for an alarm at start time.",
      ),
    action: z
      .literal("DISPLAY")
      .default("DISPLAY")
      .describe("Alarm action; only DISPLAY is supported."),
    description: z
      .string()
      .max(1_024)
      .optional()
      .describe("Optional notification text for this alarm."),
  })
  .strict()
  .describe("A display reminder attached to an event.");

export const alarmsInputSchema = z
  .array(alarmInputSchema)
  .max(20)
  .describe(
    "Display reminders for the event, up to 20; use an empty array to create or keep no alarms.",
  );

export type AlarmInput = z.output<typeof alarmInputSchema>;
