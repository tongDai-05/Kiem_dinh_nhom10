from __future__ import annotations

import csv
import json
import re
import shutil
from collections import Counter
from pathlib import Path

from docx import Document


ROOT = Path(__file__).resolve().parents[2]
OUTER = ROOT.parent
REPORT = OUTER / "Báo cáo" / "Kiểm định full.docx"
EVIDENCE = ROOT / "evidence"
BLACKBOX = ROOT / "tests" / "evidence" / "blackbox"
ADVANCED = ROOT / "tests" / "evidence" / "advanced"
RETEST = ["BB-02", "BB-23", "BB-26", "BB-29", "BB-30", "BB-33", "BB-35", "BB-36", "ADV-07"]


def parse_old_cases() -> dict[str, str]:
    document = Document(REPORT)
    paragraphs = [paragraph.text.strip() for paragraph in document.paragraphs]
    found: dict[str, str] = {}
    heading = re.compile(r"^(BB-\d{2}|WB-\d{2}|UI-\d{2}|API-\d{2}|ADV-\d{2})(?:\s*\(PM-API-\d{2}\))?:")
    for index, text in enumerate(paragraphs):
        match = heading.match(text)
        if not match or match.group(1) in found:
            continue
        case_id = match.group(1)
        status = ""
        for following in paragraphs[index + 1:index + 16]:
            status_match = re.search(r"Trạng thái:\s*([^|\n]+)", following)
            if status_match:
                status = status_match.group(1).strip()
                break
        found[case_id] = status
    return found


def selenium_runs() -> dict[tuple[str, str], list[dict]]:
    runs: dict[tuple[str, str], list[dict]] = {}
    for directory in sorted(BLACKBOX.glob("*")):
        result_file = directory / "results.json"
        if not result_file.exists():
            continue
        data = json.loads(result_file.read_text(encoding="utf-8"))
        browser_data = data.get("browser")
        browser = browser_data.get("name") if isinstance(browser_data, dict) else browser_data
        browser = browser or directory.name.rsplit("-", 1)[-1]
        for test in data.get("tests", []):
            key = (test["id"], browser)
            runs.setdefault(key, []).append({"directory": directory, "run": data, "test": test})
    return runs


def latest_valid(runs: dict[tuple[str, str], list[dict]], case_id: str, browser: str) -> dict:
    candidates = [item for item in runs.get((case_id, browser), []) if item["test"].get("status") in {"PASS", "FAIL"}]
    if not candidates:
        raise RuntimeError(f"Không có lượt hợp lệ cho {case_id} trên {browser}")
    return candidates[-1]


def latest_advanced(case_id: str) -> dict:
    candidates = []
    for directory in sorted(ADVANCED.glob("*")):
        result_file = directory / "results.json"
        if not result_file.exists():
            continue
        data = json.loads(result_file.read_text(encoding="utf-8"))
        for test in data.get("tests", []):
            if test.get("id") == case_id and test.get("status") in {"PASS", "FAIL"}:
                candidates.append({"directory": directory, "run": data, "test": test})
    if not candidates:
        raise RuntimeError(f"Không có lượt hợp lệ cho {case_id}")
    return candidates[-1]


def normalized(status: str) -> str:
    return "Đạt" if status.lower().startswith("đạt") else "Chưa đạt"


def copy_run(item: dict, case_id: str, browser: str) -> tuple[str, list[str]]:
    target = EVIDENCE / "retest" / case_id / browser
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(item["directory"], target)
    image_paths = []
    for number, screenshot in enumerate(item["test"].get("screenshots", []), start=1):
        source = item["directory"] / screenshot["path"]
        if not source.exists():
            continue
        image_name = f"MC-{case_id}-{browser}-{number:02d}.png"
        destination = EVIDENCE / "images" / image_name
        shutil.copy2(source, destination)
        image_paths.append(destination.relative_to(ROOT).as_posix())
    return target.relative_to(ROOT).as_posix() + "/results.json", image_paths


def main() -> None:
    old = parse_old_cases()
    expected = [*(f"BB-{i:02d}" for i in range(1, 37)), *(f"WB-{i:02d}" for i in range(1, 19)),
                *(f"UI-{i:02d}" for i in range(1, 9)), *(f"API-{i:02d}" for i in range(1, 25)),
                *(f"ADV-{i:02d}" for i in range(1, 9))]
    missing = [case_id for case_id in expected if case_id not in old]
    if missing:
        raise RuntimeError(f"Thiếu ca trong báo cáo gốc: {missing}")

    (EVIDENCE / "images").mkdir(parents=True, exist_ok=True)
    runs = selenium_runs()
    new_status: dict[str, str] = {case_id: normalized(old[case_id]) for case_id in expected}
    evidence: dict[str, list[str]] = {}
    timestamps: dict[str, str] = {}
    attempts: dict[str, int] = {}

    for case_id in RETEST[:-1]:
        selected = [latest_valid(runs, case_id, browser) for browser in ("chrome", "firefox")]
        new_status[case_id] = "Đạt" if all(item["test"]["status"] == "PASS" for item in selected) else "Chưa đạt"
        evidence[case_id] = []
        for browser, item in zip(("chrome", "firefox"), selected):
            report_path, image_paths = copy_run(item, case_id, browser)
            evidence[case_id].append(report_path)
            evidence[case_id].extend(image_paths)
        timestamps[case_id] = selected[-1]["run"].get("finishedAt", "")
        attempts[case_id] = sum(1 for browser in ("chrome", "firefox") for item in runs.get((case_id, browser), []) if item["test"].get("status") in {"PASS", "FAIL"})

    advanced = latest_advanced("ADV-07")
    new_status["ADV-07"] = "Đạt" if advanced["test"]["status"] == "PASS" else "Chưa đạt"
    advanced_target = EVIDENCE / "retest" / "ADV-07" / "chrome-firefox"
    if advanced_target.exists():
        shutil.rmtree(advanced_target)
    shutil.copytree(advanced["directory"], advanced_target)
    evidence["ADV-07"] = [(advanced_target / "results.json").relative_to(ROOT).as_posix()]
    timestamps["ADV-07"] = advanced["run"].get("finishedAt", "")
    attempts["ADV-07"] = 1

    plan_rows = []
    method = {
        "BB-02": "Selenium Chrome/Firefox + DB tạm", "BB-23": "Selenium Chrome/Firefox + API trong phiên + DB tạm",
        "BB-26": "Selenium Chrome/Firefox + DB tạm", "BB-29": "Selenium Chrome/Firefox + DB tạm",
        "BB-30": "Selenium Chrome/Firefox + API Admin + DB tạm", "BB-33": "Selenium Chrome/Firefox + API trong phiên + DB tạm",
        "BB-35": "Selenium Chrome/Firefox + hai yêu cầu đồng thời + DB tạm", "BB-36": "Selenium Chrome/Firefox + API trong phiên + DB tạm",
        "ADV-07": "Selenium: 8 ca UI trên Chrome và Firefox",
    }
    missing_scope = {
        "BB-02": "Biên 3/4, 6/7, email sai, xác nhận lệch, họ tên rỗng/dấu cách",
        "BB-23": "Đơn shipping/cancelled và hủy lặp", "BB-26": "Trùng, giá/tồn âm, lẻ, 0 và sai kiểu",
        "BB-29": "Tạo Shipper, trùng tài khoản, xác nhận mật khẩu sai", "BB-30": "Duyệt lặp và ma trận hủy",
        "BB-33": "shipping/cancelled và biến thể phiên", "BB-35": "Hai yêu cầu giao đồng thời", "BB-36": "Người thứ hai hủy sai chủ",
        "ADV-07": "Chạy lại bắt buộc và bổ sung ảnh",
    }
    for case_id in expected:
        rerun = case_id in RETEST
        plan_rows.append({
            "ma_ca": case_id, "trang_thai_cu": old[case_id], "phan_con_thieu": missing_scope.get(case_id, "Không - giữ kết quả cũ"),
            "cach_chay": method.get(case_id, "Không chạy lại theo quy tắc"),
            "dieu_kien_tien_quyet": "DB tạm, cổng ngẫu nhiên, dữ liệu fixture" if rerun else "Không áp dụng",
            "can_chay_lai": "Có" if rerun else "Không",
        })
    with (ROOT / "retest_plan.csv").open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=plan_rows[0].keys())
        writer.writeheader(); writer.writerows(plan_rows)

    causes = {
        "BB-02": ("a", "BUG-13", "Họ tên chỉ có dấu cách không tạo tài khoản nhưng không hiển thị thông báo từ chối."),
        "BB-26": ("a", "BUG-11", "Admin App vẫn lưu giá âm, tồn kho âm/lẻ và dữ liệu chữ bị chuyển thành 0."),
    }
    result_rows = []
    for case_id in RETEST:
        cause_type, bug, cause = causes.get(case_id, ("", "", "Toàn bộ bước và dữ liệu thử khớp mong đợi."))
        result_rows.append({
            "ma_ca": case_id, "trang_thai_cu": old[case_id], "trang_thai_moi": new_status[case_id],
            "loai_nguyen_nhan": cause_type, "ma_bug": bug, "nguyen_nhan": cause,
            "minh_chung": "; ".join(evidence[case_id]), "thoi_diem_chay": timestamps[case_id], "so_luot_hop_le": attempts[case_id],
        })
    with (ROOT / "results_retest.csv").open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=result_rows[0].keys())
        writer.writeheader(); writer.writerows(result_rows)

    all_rows = [{"ma_ca": case_id, "trang_thai_cu": old[case_id], "trang_thai_chuan_hoa": new_status[case_id]} for case_id in expected]
    with (ROOT / "all_cases_results.csv").open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=all_rows[0].keys())
        writer.writeheader(); writer.writerows(all_rows)
    print(json.dumps({"old": Counter(normalized(old[x]) for x in expected), "new": Counter(new_status.values()), "retested": result_rows}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
