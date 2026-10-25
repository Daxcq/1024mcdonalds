"""Normalize the fixed 4x4 food sheet to 64px cells and export transparent sprites."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

NAMES = [
    ("bun_top", "面包上层"), ("bun_bottom", "面包下层"),
    ("beef_patty", "牛肉饼"), ("chicken_patty", "鸡肉饼"),
    ("cheese", "芝士片"), ("lettuce", "生菜"),
    ("tomato", "番茄片"), ("pickles", "酸黄瓜"),
    ("onion", "洋葱"), ("ketchup", "番茄酱"),
    ("mustard", "芥末酱"), ("mayonnaise", "蛋黄酱"),
    ("beef_burger", "牛肉汉堡"), ("chicken_burger", "鸡肉汉堡"),
    ("fries", "薯条"), ("cola", "可乐"),
]
PALETTE = [
    "3a2210", "643219", "934e25", "be7636",
    "a64e12", "df841f", "ffc14a", "ffe09a",
    "a84b0a", "e18a15", "ffc23c", "b56c08", "efae16", "ffe261",
    "31541a", "679c22", "b2ce35", "4c5d16", "8c9c24", "cad951",
    "912719", "df3b1b", "ff8233", "8a2115", "d6381c", "ff6b29",
    "a87341", "e4bd7f", "fff1c4",
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    raw = Image.open(args.input).convert("RGBA")
    # Recover the actual four row bands before making the grid exact.
    # AI output may shift row spacing even when equal cells are requested.
    mask = Image.new("L", raw.size)
    mask.putdata([255 if a >= 128 and not (min(r, b) > 80 and min(r, b) - g > 50) else 0
                  for r, g, b, a in raw.get_flattened_data()])
    raw.putalpha(mask)
    bands = []
    start = None
    for y in range(raw.height + 1):
        occupied = y < raw.height and mask.crop((0, y, raw.width, y + 1)).getbbox() is not None
        if occupied and start is None:
            start = y
        elif not occupied and start is not None:
            bands.append((start, y))
            start = None
    if len(bands) != 4:
        raise ValueError("Expected four separate food rows; found " + str(len(bands)))
    colors = [tuple(bytes.fromhex(value)) for value in PALETTE]
    tiles = []
    for index, (name, label) in enumerate(NAMES):
        col, row = index % 4, index // 4
        top, bottom = bands[row]
        tile = raw.crop((round(col * raw.width / 4), top, round((col + 1) * raw.width / 4), bottom))
        bounds = tile.getchannel("A").getbbox()
        if bounds is None:
            raise ValueError("Empty sprite cell: " + name)
        tiles.append((name, label, tile.crop(bounds)))
    # Apply one scale to every item so their physical sizes stay consistent.
    scale = min(48 / max(tile.width for _, _, tile in tiles),
                56 / max(tile.height for _, _, tile in tiles))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    sprite_dir = args.output_dir / "sprites"
    sprite_dir.mkdir(exist_ok=True)
    sheet = Image.new("RGBA", (256, 256))
    manifest = {"cell_size": [64, 64], "grid": [4, 4], "display_scale": 4,
                "outline": "#3A2210", "background_key": "#FF00FF", "sprites": []}
    ingredient_colors = [
        [0, 4, 5, 6, 28], [0, 4, 5, 6], [0, 1, 2, 3], [0, 8, 9, 10],
        [0, 11, 12, 13], [0, 14, 15, 16], [0, 20, 21, 22], [0, 17, 18, 19],
        [0, 26, 27, 28], [0, 20, 21, 22], [0, 11, 12, 13], [0, 26, 27, 28],
    ]
    for index, (name, label, item) in enumerate(tiles):
        if scale != 1:
            item = item.resize((max(1, round(item.width * scale)), max(1, round(item.height * scale))), Image.Resampling.NEAREST)
        a = item.getchannel("A")
        allowed = [colors[i] for i in ingredient_colors[index]] if index < 12 else colors
        palette = Image.new("P", (1, 1))
        palette.putpalette([channel for color in allowed for channel in color]
                           + list(allowed[-1]) * (256 - len(allowed)))
        item = item.convert("RGB").quantize(palette=palette, dither=Image.Dither.NONE).convert("RGBA")
        item.putalpha(a)
        # Transparent padding makes erosion detect all four outer edges.
        padded = Image.new("L", (item.width + 2, item.height + 2))
        padded.paste(a, (1, 1))
        eroded = padded.filter(ImageFilter.MinFilter(3)).crop((1, 1, item.width + 1, item.height + 1))
        edge = ImageChops.subtract(a, eroded)
        item.paste((58, 34, 16, 255), mask=edge)
        tile = Image.new("RGBA", (64, 64))
        tile.paste(item, ((64 - item.width) // 2, (64 - item.height) // 2))
        filename = str(index + 1).zfill(2) + "_" + name
        tile.save(sprite_dir / (filename + "_64.png"))
        tile.resize((256, 256), Image.Resampling.NEAREST).save(sprite_dir / (filename + "_256.png"))
        x, y = index % 4 * 64, index // 4 * 64
        sheet.paste(tile, (x, y))
        manifest["sprites"].append({"id": name, "name": label, "rect": [x, y, 64, 64],
                                    "bounds": list(tile.getchannel("A").getbbox()), "file": filename})
    sheet.save(args.output_dir / "food-sheet-logical.png")
    enlarged = sheet.resize((1024, 1024), Image.Resampling.NEAREST)
    enlarged.save(args.output_dir / "food-sheet-transparent.png")
    magenta = Image.new("RGBA", enlarged.size, "#FF00FF")
    magenta.alpha_composite(enlarged)
    magenta.convert("RGB").save(args.output_dir / "food-sheet-magenta.png")
    (args.output_dir / "sprites.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Exported 16 sprites in 64px and 256px sizes, with transparent and magenta sheets.")
    print("Logical palette colors: " + str(len(colors)))
    print("Output: " + str(args.output_dir))


if __name__ == "__main__":
    main()
