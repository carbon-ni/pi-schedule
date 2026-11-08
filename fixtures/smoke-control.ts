import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Loaded only by the isolated smoke script, never by package discovery. */
export default function smokeControl(pi: ExtensionAPI): void {
  pi.registerCommand("smoke-rewind", {
    handler: async (_args, ctx) => {
      const entry = ctx.sessionManager
        .getEntries()
        .find((candidate) => candidate.type === "message");
      if (!entry) throw new Error("Smoke fixture needs a conversation entry.");
      await ctx.navigateTree(entry.id, { summarize: false });
    },
  });
  pi.registerCommand("smoke-reload", {
    handler: async (_args, ctx) => {
      await ctx.reload();
    },
  });
}
