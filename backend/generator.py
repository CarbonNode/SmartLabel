"""Label PDF generator - creates warehouse location labels with barcodes and directional arrows.
One label per page, 12x4 inch labels for Zebra printers.
Layout: arrows on left/right sides, large barcode top, big text bottom."""

import io
import barcode
from barcode.writer import ImageWriter
from PIL import Image
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader


LABEL_W = 12 * inch
LABEL_H = 4 * inch

# Global progress tracking
progress = {"current": 0, "total": 0, "done": False}


def parse_location(loc_str):
    """Parse a location string like K2-01-01-3 into components."""
    parts = loc_str.strip().upper().split("-")
    if len(parts) == 4:
        return {
            "prefix": parts[0],
            "aisle": parts[1],
            "bay": parts[2],
            "level": parts[3],
        }
    elif len(parts) == 3:
        return {
            "prefix": parts[0],
            "zone": parts[1],
            "number": parts[2],
            "level": None,
        }
    return None


def generate_range(start, end, arrow_rules=None):
    """Generate all locations in a range."""
    if arrow_rules is None:
        arrow_rules = {"1": "down", "2": "down", "3": "up"}

    locations = []
    s = parse_location(start)
    e = parse_location(end)

    if s is None or e is None:
        return []

    if "aisle" in s and "aisle" in e:
        prefix = s["prefix"]
        aisle_start = int(s["aisle"])
        aisle_end = int(e["aisle"])
        bay_start = int(s["bay"])
        bay_end = int(e["bay"])
        level_start = int(s["level"])
        level_end = int(e["level"])

        for aisle in range(aisle_start, aisle_end + 1):
            b_start = bay_start if aisle == aisle_start else 1
            b_end = bay_end if aisle == aisle_end else bay_end

            for bay in range(b_start, b_end + 1):
                l_start = level_start if (aisle == aisle_start and bay == bay_start) else 1
                l_end = level_end if (aisle == aisle_end and bay == bay_end) else level_end

                for level in range(l_start, l_end + 1):
                    loc_code = f"{prefix}-{aisle:02d}-{bay:03d}-{level}"
                    arrow = arrow_rules.get(str(level), "up")
                    locations.append({"code": loc_code, "arrow": arrow})

    elif "zone" in s and "zone" in e:
        prefix = s["prefix"]
        zone = s["zone"]
        num_start = int(s["number"])
        num_end = int(e["number"])

        for num in range(num_start, num_end + 1):
            loc_code = f"{prefix}-{zone}-{num:03d}"
            locations.append({"code": loc_code, "arrow": "up"})

    return locations


def draw_arrow(c, x, y, size, direction):
    """Draw a solid bold arrow."""
    half = size / 2
    shaft_w = size * 0.38
    shaft_h = size * 0.55

    p = c.beginPath()
    if direction == "up":
        p.moveTo(x, y + half)
        p.lineTo(x - half, y)
        p.lineTo(x + half, y)
        p.close()
        c.drawPath(p, fill=1, stroke=0)
        c.rect(x - shaft_w / 2, y - shaft_h, shaft_w, shaft_h, fill=1, stroke=0)
    else:
        p.moveTo(x, y - half)
        p.lineTo(x - half, y)
        p.lineTo(x + half, y)
        p.close()
        c.drawPath(p, fill=1, stroke=0)
        c.rect(x - shaft_w / 2, y, shaft_w, shaft_h, fill=1, stroke=0)


class NoTextImageWriter(ImageWriter):
    """ImageWriter that never renders text below the barcode."""
    def _paint_text(self, xpos, ypos):
        pass


def generate_barcode_image(text):
    """Generate a Code128 barcode as PNG. Crop whitespace so bars fill the image."""
    code128 = barcode.get_barcode_class("code128")
    writer = NoTextImageWriter()
    writer.set_options({
        "module_width": 0.9,
        "module_height": 50,
        "font_size": 0,
        "text_distance": 0,
        "quiet_zone": 1,
        "write_text": False,
        "dpi": 300,
    })
    bc = code128(text, writer=writer)
    buf = io.BytesIO()
    bc.write(buf)
    buf.seek(0)
    img = Image.open(buf)
    # Invert to find black bar bounding box (getbbox ignores white)
    from PIL import ImageOps
    inverted = ImageOps.invert(img.convert("RGB"))
    bbox = inverted.getbbox()
    if bbox:
        img = img.crop(bbox)
    out = io.BytesIO()
    img.save(out, format="PNG")
    out.seek(0)
    return out


def generate_pdf(locations, output_path):
    """Generate PDF: one 12x4 label per page."""
    global progress
    progress = {"current": 0, "total": len(locations), "done": False}

    c = canvas.Canvas(output_path, pagesize=(LABEL_W, LABEL_H))

    # Layout constants
    arrow_size = 0.8 * inch
    arrow_col_w = 0.9 * inch

    # Text sits at the very bottom
    text_band = 1.0 * inch  # space for location text at bottom
    top_margin = 0.3 * inch
    side_pad = 0.3 * inch  # extra padding between arrows and barcode

    # Barcode with padding on all sides
    bc_x = arrow_col_w + side_pad
    bc_w = LABEL_W - 2 * (arrow_col_w + side_pad)
    bc_y = text_band
    bc_h = LABEL_H - text_band - top_margin

    ax_left = arrow_col_w / 2 + 0.05 * inch
    ax_right = LABEL_W - arrow_col_w / 2 - 0.05 * inch
    ay_top = LABEL_H * 0.75
    ay_bot = LABEL_H * 0.30

    for i, loc in enumerate(locations):
        if i > 0:
            c.showPage()

        progress["current"] = i + 1

        arrow_dir = loc["arrow"]
        has_arrows = arrow_dir in ("up", "down")
        c.setFillColorRGB(0, 0, 0)

        if has_arrows:
            # Arrows
            draw_arrow(c, ax_left, ay_top, arrow_size, arrow_dir)
            draw_arrow(c, ax_left, ay_bot, arrow_size, arrow_dir)
            draw_arrow(c, ax_right, ay_top, arrow_size, arrow_dir)
            draw_arrow(c, ax_right, ay_bot, arrow_size, arrow_dir)
            cur_bc_x = bc_x
            cur_bc_w = bc_w
        else:
            # No arrows — barcode uses full width with small margins
            cur_bc_x = side_pad
            cur_bc_w = LABEL_W - 2 * side_pad

        # Barcode - high-res image stretched to fill area
        bc_img = generate_barcode_image(loc["code"])
        img = ImageReader(bc_img)
        c.drawImage(img, cur_bc_x, bc_y, width=cur_bc_w, height=bc_h)

        # Location text
        text = loc["code"]
        font_size = 80
        c.setFont("Helvetica-Bold", font_size)
        text_w = c.stringWidth(text, "Helvetica-Bold", font_size)
        max_text_w = cur_bc_w
        while text_w > max_text_w and font_size > 20:
            font_size -= 2
            c.setFont("Helvetica-Bold", font_size)
            text_w = c.stringWidth(text, "Helvetica-Bold", font_size)

        text_x = LABEL_W / 2 - text_w / 2
        text_y = 0.15 * inch
        c.drawString(text_x, text_y, text)

    c.save()
    progress["done"] = True
    return output_path


def generate_labels(ranges, arrow_rules=None, output_path="labels.pdf"):
    """Main entry point. ranges is a list of {start, end} dicts."""
    if arrow_rules is None:
        arrow_rules = {"1": "down", "2": "down", "3": "up"}

    all_locations = []
    for r in ranges:
        locs = generate_range(r["start"], r["end"], arrow_rules)
        all_locations.extend(locs)

    if not all_locations:
        return None

    generate_pdf(all_locations, output_path)
    return output_path
