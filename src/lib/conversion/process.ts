import { spawn } from "node:child_process";
import { ConversionError } from "./errors";

export function runProcess(
  executable: string,
  args: string[],
  timeoutMs: number,
  options: { signal?: AbortSignal; cwd?: string } = {},
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: { ...process.env, SAL_USE_VCLPLUGIN: "gen" },
    });
    let timeout = false,
      aborted = false;
    function kill() {
      if (!child.pid) return;
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.on("error", () => child.kill("SIGKILL"));
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    }
    const timer = setTimeout(() => {
      timeout = true;
      kill();
    }, timeoutMs);
    const abort = () => {
      aborted = true;
      kill();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    function cleanup() {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      cleanup();
      if (timeout)
        reject(
          new ConversionError(
            "This document took too long to convert. Try a smaller or simpler file.",
            "CONVERSION_TIMEOUT",
            408,
          ),
        );
      else if (aborted) reject(new ConversionError("Conversion was cancelled.", "CANCELLED", 499));
      else if (code !== 0)
        reject(
          new ConversionError(
            "We couldn’t convert this document. It may be damaged or use unsupported content.",
            "CONVERSION_FAILED",
          ),
        );
      else resolve();
    });
  });
}
