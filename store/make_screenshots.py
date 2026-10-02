"""Crop the provided in-app capture into Edge/Chrome store screenshot sizes."""
from pathlib import Path

from PIL import Image

SRC = Path(
    r"C:\Users\Administrator\.cursor\projects\d-twitter-downloader\assets"
    r"\c__Users_Administrator_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_image-e9d053b5-aa72-4fe9-b65f-921a1c828af9.png"
)
OUT = Path(__file__).resolve().parent


def cover(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    tw, th = size
    scale = max(tw / img.width, th / img.height)
    nw = max(1, int(img.width * scale))
    nh = max(1, int(img.height * scale))
    resized = img.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - tw) // 2
    top = (nh - th) // 2
    return resized.crop((left, top, left + tw, top + th))


def main() -> None:
    im = Image.open(SRC).convert("RGB")
    w, h = im.size
    # Keep the downloader panel and nearby feed download buttons.
    crop = im.crop((260, 16, w - 6, h - 16))

    outputs = {
        "screenshot-1280x800.png": (1280, 800),  # Edge / Chrome preferred
        "screenshot-640x480.png": (640, 480),    # Edge alternate
        "screenshot-640x400.png": (640, 400),    # Chrome alternate
    }
    for name, size in outputs.items():
        path = OUT / name
        cover(crop, size).save(path, "PNG", optimize=True)
        print(f"{name}: {size} -> {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
