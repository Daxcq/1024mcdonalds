"""Use the configured image API and save base64 or URL responses as PNG."""
from __future__ import annotations

import argparse
import base64
from contextlib import ExitStack
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
import sys

import httpx
from openai import OpenAI
from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True)
    parser.add_argument("--prompt-file", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--image", type=Path, action="append", default=[])
    parser.add_argument("--size", default="1024x1024")
    parser.add_argument("--quality", default="high")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.out.exists():
        parser.error("Output already exists; choose a new filename.")
    prompt = args.prompt_file.read_text(encoding="utf-8")
    for path in args.image:
        if not path.is_file():
            parser.error("Reference image does not exist: " + str(path))
    if args.dry_run:
        print("Dry run: " + str(len(args.image)) + " reference(s), model=" + args.model)
        print("Output: " + str(args.out))
        return

    # Disable automatic retries so an ambiguous timeout does not repeat a paid request.
    client = OpenAI(timeout=240.0, max_retries=0)
    request = dict(model=args.model, prompt=prompt, n=1, size=args.size,
                   quality=args.quality, output_format="png", response_format="b64_json")
    print("Requesting one image using " + args.model + "...", flush=True)
    with ExitStack() as files:
        if args.image:
            images = [files.enter_context(path.open("rb")) for path in args.image]
            request["image"] = images[0] if len(images) == 1 else images
            result = client.images.edit(**request)
        else:
            result = client.images.generate(**request)

    # Preserve the successful response before decoding or downloading it.
    response_dir = Path(__file__).resolve().parents[1] / "tmp" / "imagegen"
    response_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    response_path = response_dir / (stamp + ".response.json")
    response_path.write_text(result.model_dump_json(exclude_none=True), encoding="utf-8")
    print("API response saved locally; credential values are not logged.", flush=True)
    if not result.data:
        raise ValueError("API response contains no image data.")
    item = result.data[0]
    if item.b64_json:
        image_bytes = base64.b64decode(item.b64_json)
        print("Response format: base64", flush=True)
    elif item.url:
        print("Response format: download URL", flush=True)
        # Image download URLs receive no API Authorization header.
        response = httpx.get(item.url, timeout=120.0, follow_redirects=True)
        response.raise_for_status()
        image_bytes = response.content
    else:
        raise ValueError("API response contains neither base64 image data nor a download URL.")
    image = Image.open(BytesIO(image_bytes))
    image.load()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    image.save(args.out, format="PNG")
    print("Saved: " + str(args.out), flush=True)
    print("Image dimensions: " + str(image.width) + " x " + str(image.height), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Image request or save failed: " + type(error).__name__
              + "; HTTP status=" + str(getattr(error, "status_code", "n/a")), file=sys.stderr)
        raise SystemExit(1)
