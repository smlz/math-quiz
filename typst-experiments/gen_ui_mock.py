"""One-off script: render a wireframe sketch of the current math-quiz UI
into ui-mock.excalidraw.png. Not part of the app; safe to delete after use."""
from PIL import Image, ImageDraw, ImageFont

W, H = 1650, 1030
BG = "white"
img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

try:
    f_title = ImageFont.truetype("arialbd.ttf", 20)
    f_h = ImageFont.truetype("arialbd.ttf", 22)
    f_body = ImageFont.truetype("arial.ttf", 15)
    f_small = ImageFont.truetype("arial.ttf", 13)
    f_big = ImageFont.truetype("arialbd.ttf", 40)
    f_label = ImageFont.truetype("arialbd.ttf", 24)
except OSError:
    f_title = f_h = f_body = f_small = f_big = f_label = ImageFont.load_default()

INK = "#1a1a1a"
GRAY = "#666666"
LIGHT = "#eeeeee"
OPTION_COLORS = ["#EF476F", "#118AB2", "#C79B33", "#06D6A0"]
OPTION_TEXT = ["white", "white", "white", "white"]
OPTION_LABELS = ["A", "B", "C", "D"]


def panel(x, y, w, h, title):
    d.rounded_rectangle([x, y, x + w, y + h], radius=10, outline=INK, width=2)
    d.rectangle([x, y, x + w, y + 34], fill="#f5f5f5")
    d.line([x, y + 34, x + w, y + 34], fill=INK, width=2)
    d.text((x + 12, y + 8), title, font=f_title, fill=INK)
    return x + 18, y + 50, x + w - 18, y + h - 18  # inner content bounds


def center_text(cx, y, text, font, fill=INK):
    bbox = d.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    d.text((cx - w / 2, y), text, font=font, fill=fill)


def dim_box(bx0, by0, bx1, by1):
    ibx0, iby0, ibx1, iby1 = int(bx0), int(by0), int(bx1), int(by1)
    overlay = Image.new("RGBA", (ibx1 - ibx0, iby1 - iby0), (255, 255, 255, 130))
    crop = img.crop((ibx0, iby0, ibx1, iby1)).convert("RGBA")
    img.paste(Image.alpha_composite(crop, overlay).convert("RGB"), (ibx0, iby0))


def cross(cx, cy, r, color="#c00000", width=5):
    d.line([cx - r, cy - r, cx + r, cy + r], fill=color, width=width)
    d.line([cx - r, cy + r, cx + r, cy - r], fill=color, width=width)


def host_option_grid(x0, y0, x1, y1, dim_all_but=None, ring_index=None, counts=None):
    """Host/preview grid: label on the colored button + option content in an
    inset white/black box, with padding so the button color still shows."""
    gw = (x1 - x0 - 12) / 2
    gh = (y1 - y0 - 12) / 2
    for i in range(4):
        col, row = i % 2, i // 2
        bx0 = x0 + col * (gw + 12)
        by0 = y0 + row * (gh + 12)
        bx1, by1 = bx0 + gw, by0 + gh
        d.rounded_rectangle([bx0, by0, bx1, by1], radius=8, fill=OPTION_COLORS[i])
        d.text((bx0 + 10, by0 + 8), OPTION_LABELS[i], font=f_label, fill=OPTION_TEXT[i])
        pad = 10
        cbx0, cby0, cbx1, cby1 = bx0 + pad, by0 + 32, bx1 - pad, by1 - pad
        d.rounded_rectangle([cbx0, cby0, cbx1, cby1], radius=6, fill="white")
        center_text((cbx0 + cbx1) / 2, (cby0 + cby1) / 2 - 8, "3x + 2 = 8", f_small, INK)
        if dim_all_but is not None and i != dim_all_but:
            dim_box(bx0, by0, bx1, by1)
        if ring_index == i:
            d.rounded_rectangle([bx0 + 2, by0 + 2, bx1 - 2, by1 - 2], radius=8, outline="#ffd600", width=4)
        if counts is not None:
            # Dark pill + white bold text (not white-on-white) so the count
            # stays legible against both the white content box and dimmed background.
            badge = str(counts[i])
            d.ellipse([bx1 - 26, by1 - 26, bx1 - 6, by1 - 6], fill="#141414")
            center_text(bx1 - 16, by1 - 22, badge, f_small, "white")


def player_option_grid(x0, y0, x1, y1, disabled=False, chosen=None, reveal=False, correct_index=None):
    """Player grid: label letter only, no option content."""
    gw = (x1 - x0 - 14) / 2
    gh = (y1 - y0 - 14) / 2
    for i in range(4):
        col, row = i % 2, i // 2
        bx0 = x0 + col * (gw + 14)
        by0 = y0 + row * (gh + 14)
        bx1, by1 = bx0 + gw, by0 + gh
        d.rounded_rectangle([bx0, by0, bx1, by1], radius=10, fill=OPTION_COLORS[i])
        if disabled and not reveal:
            dim_box(bx0, by0, bx1, by1)
        center_text((bx0 + bx1) / 2, (by0 + by1) / 2 - 16, OPTION_LABELS[i], f_big, OPTION_TEXT[i])
        if reveal:
            if correct_index == i:
                d.rounded_rectangle([bx0 + 3, by0 + 3, bx1 - 3, by1 - 3], radius=10, outline="#ffd600", width=5)
            if chosen == i and chosen != correct_index:
                d.rounded_rectangle([bx0 + 3, by0 + 3, bx1 - 3, by1 - 3], radius=10, outline=INK, width=4)
                cross((bx0 + bx1) / 2, by1 - 22, 12)
        elif chosen == i:
            d.rounded_rectangle([bx0 + 3, by0 + 3, bx1 - 3, by1 - 3], radius=10, outline=INK, width=4)


PW, PH = 520, 460
GAP = 25
X0, Y0 = 25, 25

# --- Panel 1: Host - Lobby ---
ix0, iy0, ix1, iy1 = panel(X0, Y0, PW, PH, "HOST - Lobby")
center_text((ix0 + ix1) / 2, iy0, "Join at mathquiz.app/join", f_body, GRAY)
center_text((ix0 + ix1) / 2, iy0 + 25, "482913", f_big, INK)
qr_size = 110
qx = (ix0 + ix1) / 2 - qr_size / 2
qy = iy0 + 80
d.rectangle([qx, qy, qx + qr_size, qy + qr_size], outline=INK, width=2)
d.text((qx + 20, qy + 45), "QR CODE", font=f_small, fill=GRAY)
center_text((ix0 + ix1) / 2, qy + qr_size + 12, "3 players joined", f_body, GRAY)
pills_y = qy + qr_size + 40
px = ix0 + 10
for name in ["Ada", "Bo", "Cy"]:
    tb = d.textbbox((0, 0), name, font=f_small)
    pw = (tb[2] - tb[0]) + 24
    d.rounded_rectangle([px, pills_y, px + pw, pills_y + 26], radius=13, fill=LIGHT)
    d.text((px + 12, pills_y + 5), name, font=f_small, fill=INK)
    px += pw + 10
btn_y = iy1 - 40
d.rounded_rectangle([ix0, btn_y, ix1, iy1], radius=6, fill=INK)
center_text((ix0 + ix1) / 2, btn_y + 10, "Start question", f_body, "white")

# --- Panel 2: Host - Question active (with answered count + Show answer button) ---
ix0, iy0, ix1, iy1 = panel(X0 + PW + GAP, Y0, PW, PH, "HOST - Question (active)")
d.rounded_rectangle([ix0, iy0, ix1, iy0 + 56], outline="#ddd", width=1)
center_text((ix0 + ix1) / 2, iy0 + 21, "Solve: 3x + 2 = 8", f_body, INK)
host_option_grid(ix0, iy0 + 71, ix1, iy1 - 48)
btn_y = iy1 - 40
d.rounded_rectangle([ix0, btn_y, ix1, iy1], radius=6, fill=INK)
center_text((ix0 + ix1) / 2, btn_y + 10, "Show answer \u00b7 2 of 3 answered", f_body, "white")

# --- Panel 3: Host - Reveal (with tallies + Show leaderboard button) ---
ix0, iy0, ix1, iy1 = panel(X0 + 2 * (PW + GAP), Y0, PW, PH, "HOST - Reveal")
d.rounded_rectangle([ix0, iy0, ix1, iy0 + 56], outline="#ddd", width=1)
center_text((ix0 + ix1) / 2, iy0 + 21, "Solve: 3x + 2 = 8", f_body, INK)
host_option_grid(ix0, iy0 + 71, ix1, iy1 - 48, dim_all_but=1, ring_index=1, counts=[1, 5, 0, 2])
btn_y = iy1 - 40
d.rounded_rectangle([ix0, btn_y, ix1, iy1], radius=6, fill=INK)
center_text((ix0 + ix1) / 2, btn_y + 10, "Show leaderboard", f_body, "white")

# --- Panel 4: Host - Leaderboard ---
ix0, iy0, ix1, iy1 = panel(X0, Y0 + PH + GAP, PW, PH, "HOST - Leaderboard")
center_text((ix0 + ix1) / 2, iy0, "Leaderboard", f_h, INK)
row_y = iy0 + 45
for rank, (name, score) in enumerate([("Bo", 850), ("Ada", 700), ("Cy", 400)], start=1):
    d.rounded_rectangle([ix0, row_y, ix1, row_y + 40], radius=6, outline="#eee", width=1)
    d.text((ix0 + 12, row_y + 10), str(rank), font=f_body, fill=INK)
    d.text((ix0 + 45, row_y + 10), name, font=f_body, fill=INK)
    sb = d.textbbox((0, 0), str(score), font=f_body)
    d.text((ix1 - 12 - (sb[2] - sb[0]), row_y + 10), str(score), font=f_body, fill=INK)
    row_y += 48
btn_y = iy1 - 40
d.rounded_rectangle([ix0, btn_y, ix1, iy1], radius=6, fill=INK)
center_text((ix0 + ix1) / 2, btn_y + 10, "Next question", f_body, "white")

# --- Panel 5: Player - Join ---
ix0, iy0, ix1, iy1 = panel(X0 + PW + GAP, Y0 + PH + GAP, PW, PH, "PLAYER - Join")
d.text((ix0, iy0), "Game PIN", font=f_body, fill=GRAY)
d.rounded_rectangle([ix0, iy0 + 22, ix1, iy0 + 62], outline=INK, width=1)
d.text((ix0 + 12, iy0 + 32), "482913", font=f_body, fill=INK)
d.text((ix0, iy0 + 80), "Nickname", font=f_body, fill=GRAY)
d.rounded_rectangle([ix0, iy0 + 102, ix1, iy0 + 142], outline=INK, width=1)
d.text((ix0 + 12, iy0 + 112), "Ada", font=f_body, fill=INK)
btn_y = iy0 + 160
d.rounded_rectangle([ix0, btn_y, ix1, btn_y + 40], radius=6, fill=INK)
center_text((ix0 + ix1) / 2, btn_y + 10, "Join", f_body, "white")

# --- Panel 6: Player - Question (nickname + instruction pinned above the
# buttons, which fill down to the bottom of the screen) ---
ix0, iy0, ix1, iy1 = panel(X0 + 2 * (PW + GAP), Y0 + PH + GAP, PW, PH, "PLAYER - Question (answered, waiting)")
center_text((ix0 + ix1) / 2, iy0, "Bo", f_h, GRAY)
center_text((ix0 + ix1) / 2, iy0 + 28, "Answer submitted \u2014 waiting for reveal\u2026", f_body, GRAY)
player_option_grid(ix0, iy0 + 62, ix1, iy1, disabled=True, chosen=1)

img.save(r"c:\Users\marco.schmalz\Documents\informatik\info-material\math-quiz\typst-experiments\ui-mock.excalidraw.png")

# --- Second row of player states: extend canvas with a 7th panel showing reveal (wrong pick) ---
W2 = W
H2 = H + PH + GAP + 25
img2 = Image.new("RGB", (W2, H2), BG)
img2.paste(img, (0, 0))
d2 = ImageDraw.Draw(img2)


def panel2(x, y, w, h, title):
    d2.rounded_rectangle([x, y, x + w, y + h], radius=10, outline=INK, width=2)
    d2.rectangle([x, y, x + w, y + 34], fill="#f5f5f5")
    d2.line([x, y + 34, x + w, y + 34], fill=INK, width=2)
    d2.text((x + 12, y + 8), title, font=f_title, fill=INK)
    return x + 18, y + 50, x + w - 18, y + h - 18


def center_text2(cx, y, text, font, fill=INK):
    bbox = d2.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    d2.text((cx - w / 2, y), text, font=font, fill=fill)


def player_option_grid2(x0, y0, x1, y1, chosen=None, correct_index=None):
    gw = (x1 - x0 - 14) / 2
    gh = (y1 - y0 - 14) / 2
    for i in range(4):
        col, row = i % 2, i // 2
        bx0 = x0 + col * (gw + 14)
        by0 = y0 + row * (gh + 14)
        bx1, by1 = bx0 + gw, by0 + gh
        d2.rounded_rectangle([bx0, by0, bx1, by1], radius=10, fill=OPTION_COLORS[i])
        tb = d2.textbbox((0, 0), OPTION_LABELS[i], font=f_big)
        d2.text(((bx0 + bx1) / 2 - (tb[2] - tb[0]) / 2, (by0 + by1) / 2 - 26), OPTION_LABELS[i], font=f_big, fill=OPTION_TEXT[i])
        if i != correct_index:
            ibx0, iby0, ibx1, iby1 = int(bx0), int(by0), int(bx1), int(by1)
            overlay = Image.new("RGBA", (ibx1 - ibx0, iby1 - iby0), (255, 255, 255, 130))
            crop = img2.crop((ibx0, iby0, ibx1, iby1)).convert("RGBA")
            img2.paste(Image.alpha_composite(crop, overlay).convert("RGB"), (ibx0, iby0))
        # Enlarged, bolder check/cross marks (matches the real app's fix).
        if correct_index == i:
            d2.rounded_rectangle([bx0 + 3, by0 + 3, bx1 - 3, by1 - 3], radius=10, outline="#ffd600", width=5)
            if chosen == i:
                cx, cy, r = (bx0 + bx1) / 2, by1 - 32, 20
                d2.line([cx - r, cy, cx - 5, cy + r - 5], fill="#1a7a1a", width=10)
                d2.line([cx - 5, cy + r - 5, cx + r, cy - r], fill="#1a7a1a", width=10)
        if chosen == i and chosen != correct_index:
            d2.rounded_rectangle([bx0 + 3, by0 + 3, bx1 - 3, by1 - 3], radius=10, outline=INK, width=4)
            r = 20
            cx, cy = (bx0 + bx1) / 2, by1 - 30
            d2.line([cx - r, cy - r, cx + r, cy + r], fill="#c00000", width=9)
            d2.line([cx - r, cy + r, cx + r, cy - r], fill="#c00000", width=9)


PX = X0 + 2 * (PW + GAP)
PY = Y0 + 2 * (PH + GAP)
ix0, iy0, ix1, iy1 = panel2(PX, PY, PW, PH, "PLAYER - Reveal (wrong pick)")
center_text2((ix0 + ix1) / 2, iy0 - 4, "Bo", f_h, GRAY)
center_text2((ix0 + ix1) / 2, iy0 + 24, "Incorrect. +0 pts", f_h, "#c00000")
center_text2((ix0 + ix1) / 2, iy0 + 48, "Total score: 10", f_body, GRAY)
player_option_grid2(ix0, iy0 + 74, ix1, iy1, chosen=1, correct_index=2)

PX2 = X0 + PW + GAP
ix0, iy0, ix1, iy1 = panel2(PX2, PY, PW, PH, "PLAYER - Reveal (correct)")
center_text2((ix0 + ix1) / 2, iy0 - 4, "Ada", f_h, GRAY)
center_text2((ix0 + ix1) / 2, iy0 + 24, "Correct! +10 pts", f_h, "#1a7a1a")
center_text2((ix0 + ix1) / 2, iy0 + 48, "Total score: 20", f_body, GRAY)
player_option_grid2(ix0, iy0 + 74, ix1, iy1, chosen=2, correct_index=2)

img2.save(r"c:\Users\marco.schmalz\Documents\informatik\info-material\math-quiz\typst-experiments\ui-mock.png")
print("saved")
