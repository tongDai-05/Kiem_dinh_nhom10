from __future__ import annotations

import re
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn


ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT.parent / "Báo cáo" / "kiem_dinh_full_v2.docx"
OUTPUT = ROOT / "evidence" / "images"


def main() -> None:
    document = Document(REPORT)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    saved = skipped = 0
    for index, paragraph in enumerate(document.paragraphs):
        blips = paragraph._element.xpath(".//a:blip")
        if not blips:
            continue
        caption = ""
        for candidate in document.paragraphs[index + 1:index + 4]:
            if candidate.text.strip().startswith("Hình "):
                caption = candidate.text.strip()
                break
        match = re.search(r"\b(MC-[A-Za-z0-9-]+)", caption)
        if not match:
            skipped += 1
            continue
        evidence_id = match.group(1).rstrip("-")
        relationship_id = blips[0].get(qn("r:embed"))
        part = document.part.related_parts.get(relationship_id)
        if part is None:
            skipped += 1
            continue
        extension = Path(part.partname).suffix or ".png"
        target = OUTPUT / f"{evidence_id}{extension.lower()}"
        if not target.exists():
            target.write_bytes(part.blob)
            saved += 1
    print(f"saved={saved} skipped_without_mc={skipped} image_files={len(list(OUTPUT.glob('*')))}")


if __name__ == "__main__":
    main()
