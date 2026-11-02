from __future__ import annotations

import csv
import json
import re
import zipfile
from collections import Counter
from pathlib import Path

from docx import Document


ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT.parent / "Báo cáo" / "kiem_dinh_full_v2.docx"
OUT_JSON = ROOT / "evidence" / "report-validation.json"
OUT_MD = ROOT / "evidence" / "report-validation.md"
CASE_RE = re.compile(r"^(BB|WB|UI|API|ADV)-(\d{2})(?:\s*\(PM-API-\d{2}\))?:")
EXPECTED_GROUPS = {"BB": 36, "WB": 18, "UI": 8, "API": 24, "ADV": 8}
EXPECTED_RESULTS = {
    "BB": {"Đạt": 25, "Chưa đạt": 11},
    "WB": {"Đạt": 17, "Chưa đạt": 1},
    "UI": {"Đạt": 5, "Chưa đạt": 3},
    "API": {"Đạt": 15, "Chưa đạt": 9},
    "ADV": {"Đạt": 2, "Chưa đạt": 6},
}


def read_expected() -> dict[str, str]:
    with (ROOT / "all_cases_results.csv").open(encoding="utf-8-sig", newline="") as file:
        return {row["ma_ca"]: row["trang_thai_chuan_hoa"] for row in csv.DictReader(file)}


def main() -> None:
    document = Document(REPORT)
    paragraphs = document.paragraphs
    body_text = "\n".join(p.text for p in paragraphs)
    table_text = "\n".join(cell.text for table in document.tables for row in table.rows for cell in row.cells)
    full_text = body_text + "\n" + table_text
    expected = read_expected()
    case_positions: dict[str, int] = {}
    duplicate_headings: list[str] = []
    for index, paragraph in enumerate(paragraphs):
        match = CASE_RE.match(paragraph.text.strip())
        if not match:
            continue
        case_id = f"{match.group(1)}-{match.group(2)}"
        if case_id in case_positions:
            duplicate_headings.append(case_id)
        else:
            case_positions[case_id] = index

    actual: dict[str, str] = {}
    missing_status: list[str] = []
    unclassified_failures: list[str] = []
    sorted_positions = sorted(case_positions.items(), key=lambda item: item[1])
    for ordinal, (case_id, start) in enumerate(sorted_positions):
        end = sorted_positions[ordinal + 1][1] if ordinal + 1 < len(sorted_positions) else len(paragraphs)
        block = "\n".join(p.text for p in paragraphs[start + 1:min(end, start + 24)])
        status_match = re.search(r"Trạng thái:\s*(Đạt|Chưa đạt)", block)
        if not status_match:
            missing_status.append(case_id)
            continue
        status = status_match.group(1)
        actual[case_id] = status
        if status == "Chưa đạt":
            has_bug = bool(re.search(r"BUG-\d{2}", block))
            has_unproven = bool(re.search(r"chưa chứng minh được|trở ngại|cách đã thử", block, re.I))
            if not (has_bug or has_unproven):
                unclassified_failures.append(case_id)

    group_counts: dict[str, Counter] = {group: Counter() for group in EXPECTED_GROUPS}
    for case_id, status in actual.items():
        group_counts[case_id.split("-")[0]][status] += 1

    forbidden = [
        "Không đạt", "Thực hiện một phần", "Chưa thực thi", "Bị chặn",
        "toàn diện", "tuyệt đối", "tối ưu hóa", "không chỉ", "mà còn",
        "tài xế", "script fuzzing",
        "[CẦN", "cần xác nhận", "cần người thực hiện", "chưa thực hiện",
        "chưa đánh giá", "chưa chứng minh", "chưa thử", "chưa chạy",
        "Thực hiện một phần", "Bị chặn", "Chưa thực thi", "điểm tự chấm",
    ]
    forbidden_hits = {term: len(re.findall(re.escape(term), full_text, re.I)) for term in forbidden}
    forbidden_hits = {term: count for term, count in forbidden_hits.items() if count}

    headings = Counter(p.style.name for p in paragraphs if p.style and p.style.name.startswith("Heading"))
    captions = [p.text for p in paragraphs if p.style and p.style.name == "Caption"]
    caption_errors = [text for text in captions if text and not re.match(r"^(Hình|Bảng)\s+\d+\.\d+:\s+", text)]
    caption_sequences: dict[str, list[int]] = {}
    for text in captions:
        match = re.match(r"^(Hình|Bảng)\s+(\d+)\.(\d+):", text)
        if match:
            caption_sequences.setdefault(f"{match.group(1)} {match.group(2)}", []).append(int(match.group(3)))
    caption_sequence_errors = {
        key: values for key, values in caption_sequences.items()
        if values != list(range(1, len(values) + 1))
    }
    missing_figure_images: list[str] = []
    missing_evidence_files: list[str] = []
    evidence_stems = {path.stem for path in (ROOT / "evidence" / "images").glob("*") if path.is_file()}
    for index, paragraph in enumerate(paragraphs):
        if not (paragraph.style and paragraph.style.name == "Caption" and paragraph.text.strip().startswith("Hình ")):
            continue
        nearby = paragraphs[max(0, index - 3):index]
        if not any(candidate._element.xpath(".//a:blip") for candidate in nearby):
            if "CẦN NGƯỜI THỰC HIỆN" not in paragraph.text and "CẦN XÁC NHẬN" not in paragraph.text:
                missing_figure_images.append(paragraph.text)
        evidence_match = re.search(r"\b(MC-[A-Za-z0-9-]+)", paragraph.text)
        if evidence_match and evidence_match.group(1).rstrip("-") not in evidence_stems:
            missing_evidence_files.append(evidence_match.group(1).rstrip("-"))
    with zipfile.ZipFile(REPORT) as archive:
        document_xml = archive.read("word/document.xml").decode("utf-8")
        settings_xml = archive.read("word/settings.xml").decode("utf-8")
        media_count = len([name for name in archive.namelist() if name.startswith("word/media/")])

    words = re.findall(r"\b[\wÀ-ỹ]+\b", body_text, re.UNICODE)
    chapter_words: dict[str, int] = {}
    current_chapter = "Mở đầu"
    for paragraph in paragraphs:
        chapter_match = re.match(r"^(\d+)\s+", paragraph.text.strip()) if paragraph.style and paragraph.style.name == "Heading 1" else None
        if chapter_match:
            current_chapter = chapter_match.group(1)
        chapter_words[current_chapter] = chapter_words.get(current_chapter, 0) + len(re.findall(r"\b[\wÀ-ỹ]+\b", paragraph.text, re.UNICODE))
    errors: list[str] = []
    if len(case_positions) != 94:
        errors.append(f"Số tiêu đề ca: {len(case_positions)}/94")
    if set(case_positions) != set(expected):
        errors.append("Danh sách mã ca trong báo cáo không khớp CSV")
    if duplicate_headings:
        errors.append(f"Tiêu đề ca trùng: {', '.join(duplicate_headings)}")
    if missing_status:
        errors.append(f"Thiếu trạng thái: {', '.join(missing_status)}")
    mismatches = {case_id: {"expected": expected[case_id], "actual": actual.get(case_id)} for case_id in expected if actual.get(case_id) != expected[case_id]}
    if mismatches:
        errors.append(f"Sai trạng thái ở {len(mismatches)} ca")
    if unclassified_failures:
        errors.append(f"Chưa phân loại nguyên nhân: {', '.join(unclassified_failures)}")
    if forbidden_hits:
        errors.append("Còn cụm từ/trạng thái bị cấm")
    if {group: dict(group_counts[group]) for group in group_counts} != EXPECTED_RESULTS:
        errors.append("Tổng theo nhóm không khớp")
    if "TOC \\o" not in document_xml:
        errors.append("Thiếu trường mục lục tự động")
    if caption_errors:
        errors.append(f"Có {len(caption_errors)} chú thích sai mẫu")
    if caption_sequence_errors:
        errors.append("Đánh số hình/bảng chưa liên tục")
    bad_caption_punctuation = [text for text in captions if "–" in text or "—" in text or "--" in text]
    if bad_caption_punctuation:
        errors.append(f"Có {len(bad_caption_punctuation)} chú thích còn gạch ngang bị cấm")
    if missing_figure_images:
        errors.append(f"Có {len(missing_figure_images)} chú thích hình không có ảnh nhúng gần kề")
    if missing_evidence_files:
        errors.append(f"Thiếu {len(missing_evidence_files)} tệp MC trong evidence/images")
    if not 28000 <= len(words) <= 30000:
        errors.append(f"Số từ {len(words)} ngoài mục tiêu 28.000-30.000")
    expected_summary = {
        "BB": "25 Đạt, 11 Chưa đạt",
        "WB": "17 Đạt, 1 Chưa đạt",
        "UI": "Chrome và Firefox: 5 Đạt, 3 Chưa đạt",
        "API": "15 Đạt, 9 Chưa đạt, 0 lỗi thực thi",
        "ADV": "2 Đạt, 6 Chưa đạt",
    }
    summary_table = next(table for table in document.tables if table.rows and table.rows[0].cells[0].text.strip() == "Phương pháp kiểm thử")
    summary_rows = {"BB": 1, "WB": 2, "UI": 3, "API": 4, "ADV": 5}
    for group, expected_text in expected_summary.items():
        actual_text = summary_table.cell(summary_rows[group], 2).text.strip()
        if actual_text != expected_text:
            errors.append(f"Bảng 6.1 sai tổng {group}")
    status_table = next(table for table in document.tables if table.rows and table.rows[0].cells[0].text.strip() == "Trạng thái")
    if len(status_table.rows) != 3:
        errors.append("Bảng quy ước trạng thái không chỉ còn hai dòng dữ liệu")
    for bug_number in range(1, 19):
        if f"BUG-{bug_number:02d}" not in full_text:
            errors.append(f"Thiếu BUG-{bug_number:02d}")

    result = {
        "report": str(REPORT),
        "valid": not errors,
        "errors": errors,
        "case_heading_count": len(case_positions),
        "case_status_count": Counter(actual.values()),
        "group_counts": {group: dict(group_counts[group]) for group in group_counts},
        "mismatches": mismatches,
        "unclassified_failures": unclassified_failures,
        "forbidden_hits": forbidden_hits,
        "heading_counts": dict(headings),
        "caption_count": len(captions),
        "caption_errors": caption_errors,
        "caption_sequence_errors": caption_sequence_errors,
        "bad_caption_punctuation": bad_caption_punctuation,
        "missing_figure_images": missing_figure_images,
        "missing_evidence_files": missing_evidence_files,
        "embedded_media_count": media_count,
        "word_count": len(words),
        "chapter_word_counts": chapter_words,
        "toc_field": "TOC \\o" in document_xml,
        "update_fields": "updateFields" in settings_xml,
    }
    OUT_JSON.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# Kiểm tra tự động báo cáo v2", "",
        f"- Kết quả: {'ĐẠT' if result['valid'] else 'CHƯA ĐẠT'}",
        f"- Tiêu đề ca kiểm thử: {len(case_positions)}/94",
        f"- Trạng thái: {dict(Counter(actual.values()))}",
        f"- Heading: {dict(headings)}",
        f"- Chú thích hình/bảng: {len(captions)}",
        f"- Ảnh nhúng: {media_count}",
        f"- Số từ ước tính: {len(words)}", "",
        "## Lỗi còn lại", "",
    ]
    lines.extend([f"- {error}" for error in errors] or ["- Không có."])
    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=True, indent=2))
    raise SystemExit(0 if result["valid"] else 1)


if __name__ == "__main__":
    main()
