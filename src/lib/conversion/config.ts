function numberSetting(value: string | undefined, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
}
export function conversionConfig() {
  return {
    maxBytes: numberSetting(process.env.MAX_UPLOAD_MB, 50, 1, 100) * 1024 * 1024,
    timeoutMs: numberSetting(process.env.CONVERSION_TIMEOUT_MS, 90000, 1000, 180000),
    maxPages: Math.floor(numberSetting(process.env.MAX_PDF_PAGES, 300, 1, 1000)),
  };
}
