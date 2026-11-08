"""Opening a picture somebody uploaded without letting it crash the server.

A tiny file can describe a picture with billions of pixels (a "decompression bomb"): decoding it needs gigabytes of memory and kills
the worker for everybody, in the middle of an exam. So the size in pixels is checked BEFORE the picture is decoded, and a JPEG is
decoded at reduced size (every use here shrinks it to at most 1280 pixels anyway).
"""
from PIL import Image, UnidentifiedImageError

MAX_PIXELS = 50_000_000  # about 8000 x 6000: bigger than any phone camera photo of a page, small enough for a small server


class BadImage(Exception):
    """The message is safe to show to the person who uploaded the file."""


def open_image(f, invalid="That file is not a valid image."):
    try:
        img = Image.open(f)  # reads only the header
        if img.width * img.height > MAX_PIXELS:
            raise BadImage("That picture is too large (more than 50 megapixels). Please choose a smaller one.")
        img.draft("RGB", (2560, 2560))  # JPEG only: decoded at a half, quarter or eighth of the size; other formats ignore it
        img.load()
        return img
    except BadImage:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError):
        raise BadImage(invalid)
