import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Loaded only by the isolated smoke script, never by package discovery. */
export default function smokeControl(pi: ExtensionAPI): void {
  pi.registerCommand("smoke-reload", {
    handler: async (_args, ctx) => {
      await ctx.reload();
    },
  });
}
