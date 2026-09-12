import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** The only paths removed here are fresh, private directories created by this function. */
export async function withTempDirectory<T>(work: (directory: string) => Promise<T>) {
  const root = path.resolve(process.env.TEMP_DIRECTORY || os.tmpdir());
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "simplepdf-"));
  try {
    return await work(directory);
  } finally {
    if (path.dirname(directory) !== root || !path.basename(directory).startsWith("simplepdf-"))
      throw new Error("Invalid temporary directory.");
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
