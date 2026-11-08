import {
  mkdirSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  unlinkSync,
  rmdirSync,
  constants,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { emptyState, type State } from "../domain/scheduler.ts";
import type { Store } from "../application/runtime.ts";
import { decodeState } from "./state-codec.ts";

export class FileStore implements Store {
  readonly file: string;
  readonly lock: string;
  private readonly token = randomUUID();
  private closed = false;
  private readonly root: string;
  private readonly sessionId: string;
  private readonly projectPath: string;

  constructor(root: string, sessionId: string, projectPath: string) {
    this.root = root;
    this.sessionId = sessionId;
    this.projectPath = projectPath;
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const dir = lstatSync(root);
    if (!dir.isDirectory() || (dir.mode & 0o077) !== 0)
      throw new Error("Scheduler needs a private, real directory (mode 700).");
    const key = createHash("sha256").update(sessionId).digest("hex");
    this.file = join(root, key + ".json");
    this.lock = join(root, key + ".lock");
    try {
      mkdirSync(this.lock, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      throw new Error(
        `Scheduler locked: ${this.lock}. Close the other Pi session. After a crash inspect owner.json and verify its PID is gone before removing that owner.json and empty lock directory.`,
        { cause: error },
      );
    }
    try {
      writeFileSync(
        join(this.lock, "owner.json"),
        JSON.stringify({ pid: process.pid, token: this.token }),
        { mode: 0o600, flag: "wx" },
      );
    } catch (error) {
      rmdirSync(this.lock);
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Scheduler store is closed.");
    const owner = JSON.parse(readFileSync(join(this.lock, "owner.json"), "utf8")) as {
      token?: string;
    };
    if (owner.token !== this.token)
      throw new Error("Scheduler ownership changed; reload before continuing.");
  }

  load(): State {
    this.assertOpen();
    let stat;
    try {
      stat = lstatSync(this.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
      throw error;
    }
    if (!stat.isFile() || (stat.mode & 0o077) !== 0)
      throw new Error("Scheduler state must be a private regular file (mode 600).");
    if (stat.size > 16 * 1024 * 1024) throw new Error("Scheduler state is too large.");
    const fd = openSync(this.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      return decodeState(readFileSync(fd, "utf8"), this.sessionId, this.projectPath);
    } catch (error) {
      throw new Error(
        `Cannot restore scheduler state ${this.file}: ${String(error)}. Keep a private backup, restore valid state, then /reload.`,
        { cause: error },
      );
    } finally {
      closeSync(fd);
    }
  }

  save(state: State): void {
    this.assertOpen();
    const raw = JSON.stringify(state);
    if (Buffer.byteLength(raw) > 16 * 1024 * 1024) throw new Error("Scheduler state is too large.");
    // Validate writes too, so a programming error cannot corrupt the last good snapshot.
    decodeState(raw, this.sessionId, this.projectPath);
    const temp = this.file + "." + randomUUID() + ".tmp";
    const fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {
      writeFileSync(fd, raw);
      fsyncSync(fd);
    } catch (error) {
      unlinkSync(temp);
      throw error;
    } finally {
      closeSync(fd);
    }
    try {
      renameSync(temp, this.file);
      const directory = openSync(this.root, constants.O_RDONLY);
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } catch (error) {
      try {
        unlinkSync(temp);
      } catch {
        /* Rename may already have completed; caller must stop. */
      }
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.assertOpen();
    unlinkSync(join(this.lock, "owner.json"));
    rmdirSync(this.lock);
    this.closed = true;
  }
}
