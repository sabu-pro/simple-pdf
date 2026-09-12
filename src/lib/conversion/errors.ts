export class ConversionError extends Error {
  constructor(
    message: string,
    public code: string,
    public status = 422,
  ) {
    super(message);
    this.name = "ConversionError";
  }
}
export const missingLibreOffice = () =>
  new ConversionError(
    "Word to PDF needs LibreOffice on this server. Install the free LibreOffice application, then restart SimplePDF. See the README for setup instructions.",
    "LIBREOFFICE_UNAVAILABLE",
    503,
  );
