// The shape of the health response, shared by the service, the controller and the tests.
import { z } from "zod";
import { DATABASE_STATES } from "./system.types";

export const healthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  database: z.enum(DATABASE_STATES),
  version: z.string(),
  time: z.iso.datetime(),
});

export type Health = z.infer<typeof healthSchema>;
