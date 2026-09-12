import type { Matrix, PageGeometry, Point } from "@/types/editor";

export function applyMatrix([a, b, c, d, e, f]: Matrix, point: Point): Point {
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
}
export function invertMatrix([a, b, c, d, e, f]: Matrix): Matrix {
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10)
    throw new Error("This page has an invalid coordinate transform.");
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ];
}
export function viewportToPdf(point: Point, page: PageGeometry) {
  return applyMatrix(invertMatrix(page.transform), point);
}
export function pdfToViewport(point: Point, page: PageGeometry) {
  return applyMatrix(page.transform, point);
}
/** Map an upright, bottom-left display coordinate system back onto the original PDF. */
export function exportMatrix(page: PageGeometry): Matrix {
  const [a, b, c, d, e, f] = invertMatrix(page.transform);
  return [a, b, -c, -d, c * page.height + e, d * page.height + f];
}
export function clientToPage(
  client: Point,
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  page: PageGeometry,
): Point {
  return {
    x: Math.max(0, Math.min(page.width, ((client.x - rect.left) * page.width) / rect.width)),
    y: Math.max(0, Math.min(page.height, ((client.y - rect.top) * page.height) / rect.height)),
  };
}
