import { createHash } from "node:crypto";

export function hashActor(input: { ip: string; userAgent: string; salt: string }): string {
  return createHash("sha256")
    .update(input.salt)
    .update("|")
    .update(input.ip)
    .update("|")
    .update(input.userAgent)
    .digest("hex");
}

export function minuteBucket(date = new Date()): Date {
  return new Date(Math.floor(date.getTime() / 60000) * 60000);
}
