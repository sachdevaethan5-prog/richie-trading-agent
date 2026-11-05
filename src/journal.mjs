// Journal writes with an explicit result: a failed write says so instead of passing
// as saved. Reads are the plain file reads in live-sessions.mjs.
import { appendFile } from "node:fs/promises";

export async function appendJournal(file, label, line) {
  try { await appendFile(file, line.endsWith("\n") ? line : `${line}\n`); return { status: "ok", label }; }
  catch (error) { return { status: "unwritable", label, errorCode: error.code || "UNKNOWN" }; }
}
