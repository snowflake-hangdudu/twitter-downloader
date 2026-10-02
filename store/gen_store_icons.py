"""Generate Edge store logo 300x300 from icons/icon-source.png."""
from pathlib import Path
import sys

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from gen_kit_icons import crop_opaque, knockout_corner_background, resize_icon

STORE = ROOT / "store"
SOURCE = ROOT / "icons" / "icon-source.png"


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit("Missing " + str(SOURCE))
    STORE.mkdir(parents=True, exist_ok=True)
    mark = crop_opaque(knockout_corner_background(Image.open(SOURCE)))
    icon = resize_icon(mark, 300)
    canvas = Image.new("RGB", (300, 300), (255, 255, 255))
    canvas.paste(icon, (0, 0), icon)
    path = STORE / "logo-300.png"
    canvas.save(path, "PNG", optimize=True)
    print("OK", path)


if __name__ == "__main__":
    main()
