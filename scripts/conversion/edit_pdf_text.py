"""Remove selected PDF glyphs and insert style-matched replacement text.

The browser sends rotation-aware PDF.js bounds. PyMuPDF re-extracts the source
span, redacts its content without painting a fill rectangle, and only then adds
replacement text. Document text is logged only when SIMPLEPDF_DEBUG_TEXT_EDIT
is explicitly enabled, and is never retained by this worker.
"""
from __future__ import annotations

import json
import math
import os
import sys
import unicodedata
from pathlib import Path

try:
    import pymupdf as fitz
except ImportError as error:
    Path(sys.argv[4]).write_text(
        json.dumps({"ok": False, "code": "PYTHON_DEPENDENCIES", "message": str(error)}),
        encoding="utf-8",
    )
    raise SystemExit(0)

_VERTICAL_GRID_LINES: dict[int, list[tuple[float, float, float]]] = {}
_DEBUG_TEXT_EDIT = os.getenv("SIMPLEPDF_DEBUG_TEXT_EDIT", "").lower() in {"1", "true", "yes"}
_DECORATIVE_LINE_CHARACTERS = frozenset("_\u2017\u203e\u2500\u2501")


def clean(value: str) -> str:
    return " ".join(value.replace("\x00", "").replace("\u00a0", " ").split())


def comparison_key(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).replace("\x00", "")
    return "".join(
        character
        for character in normalized
        if not character.isspace() and character not in {"\u200b", "\u200c", "\u200d", "\ufeff"}
    )


def is_decorative_text_run(value: str) -> bool:
    visible = [character for character in value if not character.isspace()]
    return len(visible) >= 2 and all(
        character in _DECORATIVE_LINE_CHARACTERS for character in visible
    )


def normalize_replacement_text(original: str, replacement: str) -> str:
    if not is_decorative_text_run(original):
        return replacement
    start = 0
    end = len(replacement)
    while start < end and (
        replacement[start].isspace()
        or replacement[start] in _DECORATIVE_LINE_CHARACTERS
    ):
        start += 1
    while end > start and (
        replacement[end - 1].isspace()
        or replacement[end - 1] in _DECORATIVE_LINE_CHARACTERS
    ):
        end -= 1
    return replacement[start:end]


def rect_values(rect: fitz.Rect) -> list[float]:
    return [round(float(value), 3) for value in (rect.x0, rect.y0, rect.x1, rect.y1)]


def debug_verification(
    page_number: int,
    item: dict,
    nearby: str,
    verification_text: str,
    extracted: list[dict],
    visual_change: bool | None,
) -> None:
    if not _DEBUG_TEXT_EDIT:
        return
    edit = item["edit"]
    print(
        json.dumps(
            {
                "event": "source_text_verification",
                "page": page_number,
                "editId": edit["id"],
                "originalText": edit["originalText"],
                "replacementText": edit["replacementText"],
                "selectedBounds": rect_values(item["match"]["expected"]),
                "matchedBounds": rect_values(item["match"]["rect"]),
                "nearbyText": nearby,
                "verificationText": verification_text,
                "extractedSpans": extracted,
                "visualChange": visual_change,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        file=sys.stderr,
        flush=True,
    )


def display_rect(page: fitz.Page, rect: fitz.Rect) -> fitz.Rect:
    return fitz.Rect(rect) * page.rotation_matrix


def redaction_band(quad: fitz.Quad, text: str) -> fitz.Quad:
    """Use the glyph-run centre so overlapping line boxes cannot erase a neighbour."""
    def between(first: fitz.Point, second: fitz.Point, amount: float) -> fitz.Point:
        return fitz.Point(
            first.x + (second.x - first.x) * amount,
            first.y + (second.y - first.y) * amount,
        )

    character_count = max(1, len(comparison_key(text)))
    edge_fraction = min(0.2, 0.35 / character_count)
    top_left = between(quad.ul, quad.ur, edge_fraction)
    top_right = between(quad.ul, quad.ur, 1 - edge_fraction)
    bottom_left = between(quad.ll, quad.lr, edge_fraction)
    bottom_right = between(quad.ll, quad.lr, 1 - edge_fraction)
    return fitz.Quad(
        [
            between(top_left, bottom_left, 0.35),
            between(top_right, bottom_right, 0.35),
            between(top_left, bottom_left, 0.65),
            between(top_right, bottom_right, 0.65),
        ]
    )


def rect_score(actual: fitz.Rect, expected: fitz.Rect) -> float:
    scale_x = max(4.0, expected.width)
    scale_y = max(4.0, expected.height)
    return (
        abs(actual.x0 + actual.x1 - expected.x0 - expected.x1) / (2 * scale_x)
        + abs(actual.y0 + actual.y1 - expected.y0 - expected.y1) / (2 * scale_y)
        + abs(actual.width - expected.width) / scale_x
        + abs(actual.height - expected.height) / scale_y
    )


def page_spans(page: fitz.Page) -> list[dict]:
    result: list[dict] = []
    data = page.get_text("dict", flags=fitz.TEXTFLAGS_TEXT)
    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            direction = tuple(line.get("dir", (1.0, 0.0)))
            for span in line.get("spans", []):
                text = clean(str(span.get("text", "")))
                if not text:
                    continue
                result.append({**span, "clean_text": text, "line_dir": direction})
    return result


def verification_spans(page: fitz.Page, rect: fitz.Rect) -> list[dict]:
    area = fitz.Rect(rect)
    area.x0 -= max(4.0, rect.width * 0.15)
    area.x1 += max(4.0, rect.width * 0.15)
    area.y0 -= max(2.0, rect.height * 0.5)
    area.y1 += max(2.0, rect.height * 0.5)
    return [
        {"text": span["text"], "bounds": rect_values(fitz.Rect(span["bbox"]))}
        for span in page_spans(page)
        if fitz.Rect(span["bbox"]).intersects(area)
    ]


def verification_text(extracted: list[dict], rect: fitz.Rect) -> str:
    target = fitz.Rect(rect)
    target.x0 -= 2
    target.x1 += 2
    target.y0 -= 2
    target.y1 += 2
    selected: list[str] = []
    for span in extracted:
        bounds = fitz.Rect(span["bounds"])
        centre = fitz.Point((bounds.x0 + bounds.x1) / 2, (bounds.y0 + bounds.y1) / 2)
        if target.contains(centre):
            selected.append(span["text"])
    return " ".join(selected)


def render_region(page: fitz.Page, rect: fitz.Rect, template: dict | None = None) -> dict | None:
    try:
        if template is None:
            clip = fitz.Rect(rect)
            clip.x0 -= 2
            clip.x1 += 2
            clip.y0 -= 2
            clip.y1 += 2
            clip &= page.rect
            if clip.is_empty:
                return None
            area = max(1.0, clip.width * clip.height)
            scale = min(2.0, max(0.5, math.sqrt(16_384 / area)))
        else:
            clip = fitz.Rect(template["clip"])
            scale = float(template["scale"])
        pixmap = page.get_pixmap(
            matrix=fitz.Matrix(scale, scale),
            colorspace=fitz.csGRAY,
            alpha=False,
            clip=clip,
        )
        return {
            "clip": tuple(clip),
            "scale": scale,
            "width": pixmap.width,
            "height": pixmap.height,
            "samples": bytes(pixmap.samples),
        }
    except Exception:
        return None


def rendered_replacement_changed(page: fitz.Page, item: dict) -> bool:
    before = item.get("redacted_render")
    if before is None:
        return False
    after = render_region(page, fitz.Rect(item["match"]["rect"]), before)
    if (
        after is None
        or after["width"] != before["width"]
        or after["height"] != before["height"]
        or len(after["samples"]) != len(before["samples"])
    ):
        return False
    deltas = [
        abs(current - previous)
        for previous, current in zip(before["samples"], after["samples"])
    ]
    changed = sum(delta >= 24 for delta in deltas)
    minimum = max(6, int(len(deltas) * 0.0008))
    return changed >= minimum and sum(deltas) >= minimum * 32


def safely_rendered_ascii(replacement: str, page: fitz.Page, item: dict) -> bool:
    return (
        bool(replacement)
        and replacement.isascii()
        and all(character.isprintable() or character.isspace() for character in replacement)
        and rendered_replacement_changed(page, item)
    )


def closest_style(spans: list[dict], rect: fitz.Rect) -> dict | None:
    overlaps = [span for span in spans if fitz.Rect(span["bbox"]).intersects(rect)]
    pool = overlaps or spans
    if not pool:
        return None
    return min(
        pool,
        key=lambda span: abs(fitz.Rect(span["bbox"]).x0 - rect.x0)
        + abs(fitz.Rect(span["bbox"]).y0 - rect.y0),
    )


def find_match(page: fitz.Page, edit: dict) -> dict:
    expected = fitz.Rect(
        float(edit["x"]),
        float(edit["y"]),
        float(edit["x"] + edit["width"]),
        float(edit["y"] + edit["height"]),
    )
    if not page.rect.contains(expected):
        expanded = fitz.Rect(page.rect)
        expanded.x0 -= 2
        expanded.y0 -= 2
        expanded.x1 += 2
        expanded.y1 += 2
        if not expanded.contains(expected):
            raise ValueError(f"Text edit {edit['id']} is outside page {edit['pageIndex'] + 1}.")
    spans = page_spans(page)
    original = clean(edit["originalText"])
    matches: list[tuple[fitz.Rect, fitz.Quad, dict | None, float]] = []
    for quad in page.search_for(original, quads=True):
        source_rect = quad.rect
        shown = display_rect(page, source_rect)
        matches.append((source_rect, quad, closest_style(spans, source_rect), rect_score(shown, expected)))

    if not matches:
        for span in spans:
            if span["clean_text"] != original:
                continue
            source_rect = fitz.Rect(span["bbox"])
            matches.append(
                (
                    source_rect,
                    fitz.Quad(source_rect),
                    span,
                    rect_score(display_rect(page, source_rect), expected),
                )
            )
    if not matches:
        raise ValueError(
            f'Could not find “{original[:80]}” on page {edit["pageIndex"] + 1}. '
            "The PDF text layer may use unsupported character encoding."
        )
    source_rect, quad, style, score = min(matches, key=lambda item: item[3])
    if score > 3.5:
        raise ValueError(
            f'The selected occurrence of “{original[:80]}” could not be matched safely on '
            f'page {edit["pageIndex"] + 1}. Select the text again and retry.'
        )
    if style is None:
        raise ValueError(f"Could not read the source font on page {edit['pageIndex'] + 1}.")
    return {
        "rect": source_rect,
        "quad": quad,
        "redact_quad": redaction_band(quad, original),
        "style": style,
        "expected": expected,
    }


def normalized_font_name(value: str) -> str:
    value = value.split("+")[-1].lower()
    return "".join(character for character in value if character.isalnum())


def font_resource(doc: fitz.Document, page: fitz.Page, style: dict):
    wanted = normalized_font_name(str(style.get("font", "")))
    closest = None
    for item in page.get_fonts(full=True):
        xref, basefont, resource = int(item[0]), str(item[3]), str(item[4])
        candidate = normalized_font_name(basefont)
        if candidate == wanted or candidate.endswith(wanted) or wanted.endswith(candidate):
            closest = (xref, resource)
            break
    if closest is None:
        return None, None
    xref, resource = closest
    try:
        buffer = doc.extract_font(xref)[3]
        return resource, fitz.Font(fontbuffer=buffer) if buffer else None
    except Exception:
        return resource, None


def base14_font(flags: int) -> str:
    italic = bool(flags & 2)
    serif = bool(flags & 4)
    mono = bool(flags & 8)
    bold = bool(flags & 16)
    if mono:
        return ("cobi" if bold else "coit") if italic else ("cobo" if bold else "cour")
    if serif:
        return ("tibi" if bold else "tiit") if italic else ("tibo" if bold else "tiro")
    return ("hebi" if bold else "heit") if italic else ("hebo" if bold else "helv")


def text_length(text: str, size: float, font: fitz.Font | None, fallback: str) -> float:
    if font is not None:
        try:
            return float(font.text_length(text, fontsize=size))
        except Exception:
            pass
    return float(fitz.get_text_length(text, fontname=fallback, fontsize=size))


def supports_text(font: fitz.Font | None, text: str) -> bool:
    if font is None:
        return True
    try:
        return all(character.isspace() or font.has_glyph(ord(character)) > 0 for character in text)
    except Exception:
        return False


def alignment_container(page: fitz.Page, source_rect: fitz.Rect) -> fitz.Rect:
    centre = fitz.Point(
        (source_rect.x0 + source_rect.x1) / 2,
        (source_rect.y0 + source_rect.y1) / 2,
    )
    try:
        if page.number not in _VERTICAL_GRID_LINES:
            lines: list[tuple[float, float, float]] = []
            for drawing in page.get_drawings():
                for item in drawing.get("items", []):
                    if item[0] != "l":
                        continue
                    start, end = item[1], item[2]
                    if abs(start.x - end.x) <= 0.5:
                        lines.append((start.x, min(start.y, end.y), max(start.y, end.y)))
            _VERTICAL_GRID_LINES[page.number] = lines
        crossing = [
            x
            for x, top, bottom in _VERTICAL_GRID_LINES[page.number]
            if top - 1 <= centre.y <= bottom + 1
        ]
        left = [x for x in crossing if x <= source_rect.x0 + 1]
        right = [x for x in crossing if x >= source_rect.x1 - 1]
        if left and right:
            container = fitz.Rect(max(left), source_rect.y0, min(right), source_rect.y1)
            if container.width > source_rect.width and container.width < page.cropbox.width * 0.75:
                return container
    except Exception:
        pass
    return fitz.Rect(page.cropbox)


def prepare_replacement(doc: fitz.Document, page: fitz.Page, match: dict, edit: dict, warnings: list[str]):
    style = match["style"]
    replacement = edit["replacementText"]
    size = max(4.0, min(300.0, float(style.get("size", edit.get("fontSize") or 11))))
    flags = int(style.get("flags", 0))
    fallback = base14_font(flags)
    resource, embedded_font = font_resource(doc, page, style)
    fontname = resource if resource and supports_text(embedded_font, replacement) else fallback
    metric_font = embedded_font if fontname == resource else fitz.Font(fontname=fallback)
    if fontname != resource:
        warnings.append(
            f"A close substitute font was used for one replacement on page {edit['pageIndex'] + 1}."
        )
    edge = match["quad"].ur - match["quad"].ul
    source_width = max(1.0, math.hypot(float(edge.x), float(edge.y)))
    measured = text_length(replacement, size, metric_font, fallback)
    if measured > source_width:
        size = max(4.0, size * source_width / measured)
        measured = text_length(replacement, size, metric_font, fallback)
        warnings.append(f"Replacement text was reduced to fit on page {edit['pageIndex'] + 1}.")
    if measured > source_width * 1.05:
        raise ValueError(
            f'Replacement for “{clean(edit["originalText"])[:80]}” is too long to fit. '
            "Use shorter text."
        )
    source_rect = match["rect"]
    line_dir = tuple(style.get("line_dir", (1.0, 0.0)))
    direction_length = math.hypot(float(line_dir[0]), float(line_dir[1])) or 1.0
    along = (
        float(line_dir[0]) / direction_length,
        float(line_dir[1]) / direction_length,
    )
    normal = (-along[1], along[0])
    style_origin = fitz.Point(style.get("origin", (source_rect.x0, source_rect.y1)))
    leading = match["quad"].ul
    origin = fitz.Point(
        along[0] * (leading.x * along[0] + leading.y * along[1])
        + normal[0] * (style_origin.x * normal[0] + style_origin.y * normal[1]),
        along[1] * (leading.x * along[0] + leading.y * along[1])
        + normal[1] * (style_origin.x * normal[0] + style_origin.y * normal[1]),
    )
    container = alignment_container(page, source_rect)
    left_gap = max(0.0, source_rect.x0 - container.x0)
    right_gap = max(0.0, container.x1 - source_rect.x1)
    centered = abs(left_gap - right_gap) <= max(5, container.width * 0.04)
    right = (
        not centered
        and right_gap <= max(7, container.width * 0.04)
        and right_gap < left_gap * 0.45
    )
    spare = max(0.0, source_width - measured)
    shift = spare / 2 if centered else spare if right else 0.0
    origin += fitz.Point(float(line_dir[0]) * shift, float(line_dir[1]) * shift)
    try:
        color = fitz.sRGB_to_pdf(int(style.get("color", 0)))
    except Exception:
        color = (0.0, 0.0, 0.0)
    angle = math.degrees(math.atan2(-float(line_dir[1]), float(line_dir[0]))) % 360
    return {
        "text": replacement,
        "origin": origin,
        "fontname": fontname,
        "fallback": fallback,
        "size": size,
        "color": color,
        "angle": angle,
    }


def insert_replacement(page: fitz.Page, prepared: dict, warnings: list[str], page_number: int):
    args = {
        "fontsize": prepared["size"],
        "fontname": prepared["fontname"],
        "color": prepared["color"],
        "overlay": True,
    }
    angle = prepared["angle"]
    nearest = round(angle / 90) * 90
    if abs(angle - nearest) <= 0.5:
        args["rotate"] = int(nearest % 360)
    else:
        args["morph"] = (prepared["origin"], fitz.Matrix(angle))
    try:
        written = page.insert_text(prepared["origin"], prepared["text"], **args)
    except Exception:
        args["fontname"] = prepared["fallback"]
        written = page.insert_text(prepared["origin"], prepared["text"], **args)
        warnings.append(f"A close substitute font was used for one replacement on page {page_number}.")
    if written < 0:
        raise ValueError(f"Replacement text could not be inserted on page {page_number}.")


def edit_pdf_bytes(input_bytes: bytes, edits: list[dict]) -> tuple[bytes, list[str]]:
    """Apply validated source-text edits and return the new PDF without persistent storage."""
    document = fitz.open(stream=input_bytes, filetype="pdf")
    warnings: list[str] = []
    plans: dict[int, list[dict]] = {}
    try:
        for edit in edits:
            edit = {
                **edit,
                "replacementText": normalize_replacement_text(
                    edit["originalText"], edit["replacementText"]
                ),
            }
            if not edit["deleted"] and not clean(edit["replacementText"]):
                raise ValueError("Enter replacement text or choose Delete.")
            page_index = int(edit["pageIndex"])
            if page_index < 0 or page_index >= len(document):
                raise ValueError(f"Page {page_index + 1} does not exist in this PDF.")
            page = document[page_index]
            match = find_match(page, edit)
            prepared = None
            if not edit["deleted"] and clean(edit["replacementText"]) != clean(edit["originalText"]):
                prepared = prepare_replacement(document, page, match, edit, warnings)
            plans.setdefault(page_index, []).append({"edit": edit, "match": match, "prepared": prepared})

        for page_index, page_plans in plans.items():
            page = document[page_index]
            rects = [item["match"]["rect"] for item in page_plans]
            for left_index, left in enumerate(rects):
                for right in rects[left_index + 1 :]:
                    intersection = left & right
                    if not intersection.is_empty and intersection.get_area() > 0.1:
                        raise ValueError(f"Two selected text edits overlap on page {page_index + 1}.")
            for item in page_plans:
                edit = item["edit"]
                if clean(edit["replacementText"]) == clean(edit["originalText"]) and not edit["deleted"]:
                    continue
                page.add_redact_annot(
                    item["match"]["redact_quad"], fill=False, cross_out=False
                )
            page.apply_redactions(
                images=fitz.PDF_REDACT_IMAGE_NONE,
                graphics=fitz.PDF_REDACT_LINE_ART_NONE,
                text=fitz.PDF_REDACT_TEXT_REMOVE,
            )
            for item in page_plans:
                if item["prepared"] is not None:
                    item["redacted_render"] = render_region(
                        page, fitz.Rect(item["match"]["rect"])
                    )
            for item in page_plans:
                if item["prepared"] is not None:
                    insert_replacement(page, item["prepared"], warnings, page_index + 1)

        output_bytes = document.tobytes(garbage=4, clean=True, deflate=True)
    finally:
        document.close()

    check = fitz.open(stream=output_bytes, filetype="pdf")
    try:
        for page_index, page_plans in plans.items():
            page = check[page_index]
            for item in page_plans:
                edit = item["edit"]
                matched_rect = fitz.Rect(item["match"]["rect"])
                nearby = page.get_textbox(matched_rect)
                extracted = verification_spans(page, matched_rect)
                extracted_text = verification_text(extracted, matched_rect)
                original_key = comparison_key(edit["originalText"])
                replacement_key = comparison_key(edit["replacementText"])
                extracted_key = comparison_key(extracted_text)
                replacement_mismatch = (
                    not edit["deleted"]
                    and clean(edit["replacementText"]) != clean(edit["originalText"])
                    and (not replacement_key or replacement_key not in extracted_key)
                )
                visual_change = (
                    safely_rendered_ascii(edit["replacementText"], page, item)
                    if replacement_mismatch
                    else None
                )
                debug_verification(
                    page_index + 1,
                    item,
                    nearby,
                    extracted_text,
                    extracted,
                    visual_change,
                )
                if edit["deleted"]:
                    if original_key and original_key in extracted_key:
                        raise ValueError(f"Source text removal could not be verified on page {page_index + 1}.")
                elif clean(edit["replacementText"]) != clean(edit["originalText"]):
                    if (
                        original_key not in replacement_key
                        and original_key in extracted_key
                    ):
                        raise ValueError(
                            f"Source text removal could not be verified on page {page_index + 1}."
                        )
                    if replacement_mismatch:
                        if visual_change:
                            warnings.append(
                                f"Replacement text on page {page_index + 1} was rendered, but its "
                                "text encoding could not be fully verified. Review the downloaded PDF."
                            )
                        else:
                            raise ValueError(
                                f"Replacement text could not be verified on page {page_index + 1}."
                            )
    finally:
        check.close()
    return output_bytes, sorted(set(warnings))


def edit_pdf(input_path: str, edits_path: str, output_path: str, status_path: str):
    edits = json.loads(Path(edits_path).read_text(encoding="utf-8"))
    output_bytes, warnings = edit_pdf_bytes(Path(input_path).read_bytes(), edits)
    Path(output_path).write_bytes(output_bytes)
    Path(status_path).write_text(
        json.dumps({"ok": True, "applied": len(edits), "warnings": warnings}),
        encoding="utf-8",
    )


if __name__ == "__main__":
    try:
        edit_pdf(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4])
    except Exception as error:
        message = (
            str(error)
            if isinstance(error, (ValueError, json.JSONDecodeError))
            else "The selected source text could not be edited safely."
        )
        Path(sys.argv[4]).write_text(
            json.dumps({"ok": False, "code": "TEXT_EDIT_FAILED", "message": message}),
            encoding="utf-8",
        )
