import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runProcess } from "./process";
import { missingLibreOffice, ConversionError } from "./errors";
import { validateDocx } from "./docx-validation";
import { validateMagic } from "@/lib/files/validation";

export async function findLibreOffice(): Promise<string | undefined> {
  const candidates = process.env.LIBREOFFICE_PATH
    ? [process.env.LIBREOFFICE_PATH]
    : process.platform === "win32"
      ? [
          "C:\\Program Files\\LibreOffice\\program\\soffice.com",
          "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
          "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
        ]
      : [
          "/usr/bin/libreoffice",
          "/usr/bin/soffice",
          "/usr/local/bin/soffice",
          "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      await runProcess(candidate, ["--version"], 5000);
      return candidate;
    } catch {
      /* Try the next known installation. */
    }
  }
  return undefined;
}

export async function wordToPdf(
  input: string,
  directory: string,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  await validateDocx(input);
  const executable = await findLibreOffice();
  if (!executable) throw missingLibreOffice();
  const profile = path.join(directory, "profile"),
    profileUser = path.join(profile, "user");
  await mkdir(profileUser, { recursive: true });
  await writeFile(
    path.join(profileUser, "registrymodifications.xcu"),
    '<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item></oor:items>',
  );
  await runProcess(
    executable,
    [
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      "--headless",
      "--nologo",
      "--nodefault",
      "--norestore",
      "--convert-to",
      "pdf:writer_pdf_Export",
      "--outdir",
      directory,
      input,
    ],
    timeoutMs,
    { signal, cwd: directory },
  );
  let bytes: Buffer;
  try {
    const output = path.join(directory, "input.pdf");
    if ((await stat(output)).size > 100 * 1024 * 1024) throw new Error("Output too large");
    bytes = await readFile(output);
    validateMagic(bytes, "pdf");
  } catch {
    throw new ConversionError(
      "LibreOffice could not create a PDF within the output size limit. Check that the document opens correctly and try a smaller file.",
      "CONVERSION_FAILED",
    );
  }
  return bytes;
}
