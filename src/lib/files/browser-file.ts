/** Read a browser File/Blob with a fallback for older WebKit releases. */
export async function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();

  if (typeof FileReader === "undefined") {
    throw new Error("This browser could not read the selected file.");
  }

  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("This browser could not read the selected file."));
    };
    reader.onerror = () =>
      reject(reader.error || new Error("This browser could not read the selected file."));
    reader.onabort = () => reject(new Error("Reading the selected file was cancelled."));
    reader.readAsArrayBuffer(blob);
  });
}

export async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await readBlobAsArrayBuffer(blob));
}
