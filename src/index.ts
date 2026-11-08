import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { register } from "./infra/extension.ts";

export default function schedule(pi: ExtensionAPI): void {
  register(pi);
}
