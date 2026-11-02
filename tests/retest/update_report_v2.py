from __future__ import annotations

import csv
import hashlib
import json
import re
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt


ROOT = Path(__file__).resolve().parents[2]
OUTER = ROOT.parent
SOURCE = OUTER / "Báo cáo" / "Kiểm định full.docx"
TARGET = OUTER / "Báo cáo" / "kiem_dinh_full_v2.docx"
IMAGES = ROOT / "evidence" / "images"

FAILURE_REASONS = {
    "BB-02": "a) Lỗi sản phẩm, BUG-13.",
    "BB-07": "a) Lỗi sản phẩm, BUG-01.",
    "BB-08": "a) Lỗi sản phẩm, BUG-02.",
    "BB-10": "b) Chưa chứng minh được: giao diện không có điều khiển sắp xếp; đã khảo sát danh sách sản phẩm và vùng bộ lọc nhưng chưa có đặc tả được xác nhận để gọi API thay thế.",
    "BB-14": "a) Lỗi sản phẩm, BUG-03.",
    "BB-15": "a) Lỗi sản phẩm, BUG-12.",
    "BB-17": "a) Lỗi sản phẩm, BUG-04 và BUG-05.",
    "BB-20": "a) Lỗi sản phẩm, BUG-04 và BUG-05.",
    "BB-21": "a) Lỗi sản phẩm, BUG-06.",
    "BB-24": "a) Lỗi sản phẩm, BUG-07.",
    "BB-26": "a) Lỗi sản phẩm, BUG-11.",
    "WB-18": "a) Lỗi sản phẩm, BUG-06.",
    "UI-03": "a) Lỗi sản phẩm, BUG-01 và BUG-02.",
    "UI-05": "a) Lỗi sản phẩm, BUG-03.",
    "UI-06": "a) Lỗi sản phẩm, BUG-04 và BUG-05.",
    "API-08": "a) Lỗi sản phẩm, BUG-08.",
    "API-09": "a) Lỗi sản phẩm, BUG-03.",
    "API-11": "a) Lỗi sản phẩm, BUG-12.",
    "API-12": "a) Lỗi sản phẩm, BUG-09.",
    "API-13": "a) Lỗi sản phẩm, BUG-05.",
    "API-14": "a) Lỗi sản phẩm, BUG-06.",
    "API-15": "a) Lỗi sản phẩm, BUG-10.",
    "API-18": "a) Lỗi sản phẩm, BUG-07.",
    "API-20": "a) Lỗi sản phẩm, BUG-11.",
    "ADV-01": "a) Lỗi sản phẩm, BUG-05.",
    "ADV-02": "a) Lỗi sản phẩm, BUG-14.",
    "ADV-03": "a) Lỗi sản phẩm, BUG-15.",
    "ADV-04": "a) Lỗi sản phẩm, BUG-01 và BUG-16.",
    "ADV-05": "a) Lỗi sản phẩm, BUG-07.",
    "ADV-06": "a) Lỗi sản phẩm, BUG-17.",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file))


def iter_all_paragraphs(document: Document):
    yield from document.paragraphs
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                yield from cell.paragraphs


def set_text(paragraph, text: str) -> None:
    paragraph.text = text
    paragraph.paragraph_format.space_after = Pt(4)


def delete_paragraph(paragraph) -> None:
    element = paragraph._element
    element.getparent().remove(element)
    paragraph._p = paragraph._element = None


def add_toc(paragraph) -> None:
    paragraph.clear()
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar"); begin.set(qn("w:fldCharType"), "begin")
    instruction = OxmlElement("w:instrText"); instruction.set(qn("xml:space"), "preserve")
    instruction.text = ' TOC \\o "1-3" \\h \\z \\u '
    separate = OxmlElement("w:fldChar"); separate.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t"); text.text = "Mục lục sẽ được cập nhật khi mở tệp trong Word."
    end = OxmlElement("w:fldChar"); end.set(qn("w:fldCharType"), "end")
    for element in (begin, instruction, separate, text, end):
        run._r.append(element)


def status_counts(results: dict[str, str], prefix: str) -> tuple[int, int]:
    values = [status for case_id, status in results.items() if case_id.startswith(prefix)]
    return values.count("Đạt"), values.count("Chưa đạt")


def assertion_summary(case_id: str) -> tuple[int, int]:
    passed = total = 0
    if case_id.startswith("BB-"):
        for browser in ("chrome", "firefox"):
            data = json.loads((ROOT / "evidence" / "retest" / case_id / browser / "results.json").read_text(encoding="utf-8"))
            test = data["tests"][0]
            total += len(test.get("assertions", []))
            passed += sum(bool(item.get("passed")) for item in test.get("assertions", []))
    else:
        data = json.loads((ROOT / "evidence" / "retest" / case_id / "chrome-firefox" / "results.json").read_text(encoding="utf-8"))
        test = data["tests"][0]
        total = len(test.get("assertions", [])); passed = sum(bool(item.get("passed")) for item in test.get("assertions", []))
    return passed, total


def normalize_language(text: str) -> str:
    replacements = [
        (r"Không đạt", "Chưa đạt"), (r"không đạt", "chưa đạt"),
        (r"KHÔNG ĐẠT", "CHƯA ĐẠT"),
        (r"THỰC HIỆN MỘT PHẦN", "CHƯA ĐẠT"), (r"Thực hiện một phần", "Chưa đạt"), (r"thực hiện một phần", "chưa đạt"),
        (r"Chưa thực thi", "Chưa đạt"), (r"chưa thực thi", "chưa đạt"),
        (r"Bị chặn", "Chưa đạt"), (r"bị chặn", "bị từ chối"),
        (r"Đạt một phần", "Chưa đạt"), (r"đạt một phần", "chưa đạt"),
        (r"toàn diện", "theo phạm vi đã nêu"), (r"Toàn diện", "Theo phạm vi đã nêu"),
        (r"tuyệt đối", "nhất quán"), (r"Tuyệt đối", "Nhất quán"),
        (r"tối ưu hóa", "cải thiện"), (r"Tối ưu hóa", "Cải thiện"),
        (r"không chỉ", ""), (r"Không chỉ", ""), (r"mà còn", "đồng thời"),
        (r"tài xế", "nhân viên giao hàng"), (r"Tài xế", "Nhân viên giao hàng"),
        (r"script fuzzing", "gửi dữ liệu dị thường thủ công (ADV-04)"),
        (r"hoàn kho", "hoàn trả tồn kho"), (r"trừ kho", "trừ tồn kho"), (r"kho cỡ", "tồn kho biến thể cỡ"),
        (r"thêm giỏ", "thêm vào giỏ hàng"),
    ]
    for old, new in replacements:
        text = re.sub(old, new, text)
    return re.sub(r" {2,}", " ", text)


def shorten_field(text: str, label: str, limit: int) -> str:
    body = text.split(":", 1)[1].strip() if ":" in text else text.strip()
    words = body.split()
    if len(words) <= limit:
        return f"{label}: {body}"
    compact = " ".join(words[:limit]).rstrip(",;:")
    return f"{label}: {compact}."


def condense_editorial_content(document: Document, results: dict[str, str]) -> None:
    replacements = {
        "Kiểm thử hộp đen (Black-box Testing)": "Kiểm thử hộp đen đánh giá hành vi quan sát được theo yêu cầu nghiệp vụ, dữ liệu nhập và kết quả xuất, không dựa vào cấu trúc mã nguồn.",
        "Bộ kiểm thử hộp đen của đề tài gồm 36 ca": "Bộ 36 ca BB bao phủ đăng ký, đăng nhập, sản phẩm, giỏ hàng, đặt hàng, quản trị và giao hàng. Môi trường và tài khoản dùng chung được khai báo tại mục 1.6.",
        "Kỹ thuật phân lớp tương đương chia": "Phân lớp tương đương chọn giá trị đại diện cho lớp hợp lệ và không hợp lệ. Báo cáo chỉ kết luận trên các lớp và dữ liệu đã nêu trong từng ca.",
        "Căn cứ vào ràng buộc xác thực": "Đăng ký được chia theo họ tên, tên đăng nhập, email, mật khẩu và xác nhận mật khẩu; các lớp biên được ánh xạ tới BB-01, BB-02 và BB-03.",
        "Ánh xạ tới ca kiểm thử thực tế": "Ánh xạ: BB-01 kiểm tra đăng ký hợp lệ; BB-02 kiểm tra biên và dữ liệu rỗng; BB-03 kiểm tra trùng tên đăng nhập hoặc email.",
        "Theo logic xử lý giỏ hàng": "Số lượng mua được thử ở lớp số nguyên dương trong tồn kho, tại biên và ngoài tồn kho; BB-15 ghi kết quả chi tiết.",
        "Tại phân hệ quản trị cổng 3001": "Biểu mẫu sản phẩm được thử với tên, danh mục, ảnh, giá và tồn kho hợp lệ hoặc sai kiểu; BB-26 ghi các sai lệch.",
        "Quy trình tạo đơn hàng phụ thuộc": "Bảng quyết định đặt hàng kết hợp trạng thái đăng nhập, biến thể, tồn kho và thông tin nhận hàng; từng tổ hợp có ca BB tương ứng.",
        "Toàn bộ 36 ca kiểm thử hộp đen được thực hiện": "Các ca BB dùng cùng DB tạm, dữ liệu nền và tài khoản mục 1.6; ca tái kiểm thử chạy trên Chrome và Firefox, có log JSON và ảnh trong evidence/retest.",
        "Kiểm thử hộp trắng (White-box Testing)": "Kiểm thử hộp trắng dùng Jest và dữ liệu mô phỏng để kiểm tra nhánh điều kiện, vòng lặp, xử lý lỗi và thay đổi trạng thái trong các hàm nghiệp vụ đã chọn.",
        "Môi trường kiểm thử hộp trắng của đề tài": "Mười bảy ca WB dùng Jest với mock; WB-18 dùng MongoDB tạm để kiểm tra tính nguyên tử. Lượt cuối đạt 134/134 test, dòng 100%, câu lệnh 99,92%, hàm 99,44% và nhánh 82,62%.",
        "Đồ thị dòng điều khiển (Control Flow Graph - CFG)": "CFG biểu diễn khối lệnh bằng nút và chuyển điều khiển bằng cạnh. Độ phức tạp được đối chiếu theo V(G)=E-N+2P và số điểm quyết định +1. Do Graphviz chưa cài hoàn tất, các số cũ được giữ và đánh dấu cần xác nhận bằng đồ thị kết xuất từ mã hiện tại.",
        "A. Hàm thêm sản phẩm vào giỏ hàng addToCart": "Hàm addToCart được ghi nhận 10 nút, 12 cạnh và ba điểm quyết định, V(G)=4. Các đường cơ sở gồm: chưa đăng nhập; không tìm thấy người dùng; cập nhật dòng đã có; thêm dòng mới. [CẦN XÁC NHẬN: kết xuất Graphviz từ mã hiện tại.]",
        "Mô tả nghiệp vụ: Hàm điều phối luồng đặt mua": "Luồng đặt giỏ duyệt từng mặt hàng, kiểm tra tồn kho, tính tiền và cập nhật biến thể. Ca vòng lặp bao phủ giỏ rỗng, một dòng, nhiều dòng hợp lệ và dừng khi gặp dòng thiếu tồn; WB-18 kiểm tra việc hoàn tác khi lượt đặt thất bại.",
        "Từ kết quả thực nghiệm 18 ca kiểm thử hộp trắng": "Jest đạt 134/134 test. Độ phủ dòng 100%, câu lệnh 99,92% và hàm 99,44%; độ phủ nhánh 82,62% chưa đạt mục tiêu 85%. WB-18 Chưa đạt vì cập nhật tồn kho không được hoàn tác khi một dòng hết hàng (BUG-06).",
        "Kiểm thử tự động (Automated Testing)": "Chương này trình bày kiểm thử giao diện bằng Selenium và API bằng Newman trên DB tạm, kèm đối chiếu dữ liệu sau bước quyết định.",
        "Mục tiêu kỹ thuật cụ thể gồm ba trọng tâm": "Mục tiêu: kiểm tra luồng giao diện, xác nhận thay đổi trong DB tạm và so sánh hành vi trên Chrome với Firefox.",
        "Trong kế hoạch ban đầu (nhánh m3/ui-playwright": "Kế hoạch ban đầu dự kiến Playwright; lượt chạy thực tế dùng Selenium WebDriver nên báo cáo chỉ dùng kết quả Selenium đã lưu.",
        "Môi trường chạy kiểm thử tự động được thiết lập": "Selenium dùng hai ứng dụng cổng riêng và MongoDB tạm. BASE_URL_CLIENT, BASE_URL_ADMIN và MONGO_URI là các tham số cấu hình duy nhất cần đổi.",
        "Để đáp ứng tiêu chuẩn chất lượng ISO/IEC 25010": "Tám ca UI được chạy trên Chrome 156 và Firefox 159; kết quả từng ca và sai lệch được ghi tại Bảng 4.1.",
        "Tổng hợp đợt chạy 8 kịch bản Selenium": "Selenium ghi 94/110 phép đối chiếu khớp mong đợi (85,45%); 16 phép sai lệch thuộc các ca UI Chưa đạt. Kết luận theo ca dùng quy tắc mục 1.7.",
        "Kiểm thử API tự động hóa được nhóm thiết kế": "Newman gọi trực tiếp API của User App và Admin App, sau đó đối chiếu phản hồi với dữ liệu MongoDB tạm.",
        "Cấu trúc và quy trình kiểm thử API": "Collection gồm 24 ca API, 71 yêu cầu HTTP và dữ liệu nền độc lập. Mỗi ca kiểm tra phản hồi, trạng thái lưu và ảnh hưởng phụ liên quan.",
        "Thống kê tổng hợp kết quả chạy bộ API": "Lượt Newman cuối chạy 24 ca: 15 Đạt, 9 Chưa đạt, không có lỗi thực thi; 181 Postman assertions và 68 phép đối chiếu DB.",
        "Lượt chạy trực quan trên Postman Desktop": "API-13 được đối chiếu ở cả phản hồi và DB: yêu cầu trả thành công nhưng trừ nhầm tồn kho cỡ M thay vì cỡ L (BUG-05).",
        "Quan sát trực tiếp trên giao diện Runner": "Các assertion phản hồi của API-13 báo xanh, nhưng đối chiếu DB phát hiện sai lệch nghiệp vụ; vì vậy trạng thái ca là Chưa đạt.",
        "Ý nghĩa phương pháp luận kiểm thử": "Kết quả API-13 cho thấy HTTP 200 chưa đủ để kết luận Đạt; ca mua hàng phải đối chiếu thêm đơn, giỏ hàng và tồn kho biến thể.",
        "Hồ sơ kết quả kiểm thử tự động được nhóm lưu trữ": "Hồ sơ Newman gồm HTML, JSON và ảnh tổng hợp trong evidence/postman; dữ liệu DB đối chiếu được lưu cùng lần chạy.",
        "Hướng mở rộng kiểm thử tự động": "Có thể đưa Selenium, Jest và Newman vào CI sau khi chuẩn hóa fixture và biến môi trường; nội dung này nằm ngoài kết quả hiện tại.",
        "Kiểm thử nâng cao và bảo mật (Advanced & Security Testing)": "Chương 5 kiểm tra tranh chấp đồng thời, tính lặp an toàn, dữ liệu dị thường, phân quyền, yêu cầu khác nguồn và tương thích trình duyệt.",
        "Phạm vi kiểm thử bao trùm năm nhóm nội dung": "Phạm vi gồm tám ca ADV-01 đến ADV-08; điều kiện, mong đợi, thực tế và giới hạn kết luận được ghi ngay tại từng ca.",
        "Trong tài liệu kế hoạch (mục 4.3 của File B)": "ADV-01 gửi hai yêu cầu mua gần đồng thời cho sản phẩm còn một chiếc; cả hai tạo đơn và cập nhật nhầm biến thể, liên quan BUG-05.",
        "Nghiệp vụ giao vận yêu cầu tính bất biến": "ADV-03 xác nhận giao lặp tuần tự chỉ cộng 12.000 đồng một lần, nhưng hai yêu cầu đồng thời cộng 24.000 đồng (BUG-15).",
        "Tài liệu kế hoạch của File B đề xuất phương án Fuzzing": "ADV-04 gửi các mẫu rỗng, sai kiểu, âm, 0, số lẻ, mã sai, chuỗi dài và dấu HTML bất hoạt; từ khóa đặc biệt gây 5xx và số lượng 1,5 vẫn được lưu.",
        "Hai ca kiểm thử bảo mật nâng cao ADV-05 và ADV-06": "ADV-05 phát hiện lộ thông tin xác nhận đơn ngoài chủ sở hữu (BUG-07); ADV-06 cho phép yêu cầu thay đổi khác nguồn làm tăng giỏ hàng (BUG-17).",
        "Hai ca kiểm thử tương thích ADV-07 và ADV-08": "ADV-07 Đạt 8/8 phép so sánh Chrome và Firefox; ADV-08 Đạt ở các kích thước đã thử. Kết luận chỉ áp dụng dữ liệu và vùng hiển thị đã ghi.",
        "Thiết kế kịch bản thử nghiệm tải": "JMeter mô phỏng chuỗi mở trang chủ, danh sách và chi tiết sản phẩm ở 20, 50, 100, 200 và 500 người dùng đồng thời.",
        "Phân tích chi tiết kết quả thực nghiệm": "Các mức 20 đến 200 người dùng không ghi nhận lỗi; mức 500 xuất hiện suy giảm rõ về thời gian phản hồi. Số liệu chi tiết giữ tại Bảng 5.2 và tệp kết quả JMeter.",
        "Nhóm nhấn mạnh các giới hạn kỹ thuật cần lưu ý": "Kết quả tải phản ánh máy cục bộ, DB và cấu hình tại thời điểm chạy; chưa đại diện cho hạ tầng triển khai thực tế hoặc tải kéo dài.",
    }
    for paragraph in list(document.paragraphs):
        stripped = paragraph.text.strip()
        for prefix, replacement in replacements.items():
            if stripped.startswith(prefix):
                set_text(paragraph, replacement)
                break

    positions: list[tuple[str, int]] = []
    for index, paragraph in enumerate(document.paragraphs):
        match = re.match(r"^((?:BB|UI|API)-\d{2})(?:\s*\(PM-API-\d{2}\))?:", paragraph.text.strip())
        if match:
            positions.append((match.group(1), index))
    for ordinal, (case_id, start) in enumerate(positions):
        if results.get(case_id) != "Đạt":
            continue
        end = positions[ordinal + 1][1] if ordinal + 1 < len(positions) else len(document.paragraphs)
        for paragraph in document.paragraphs[start + 1:min(end, start + 18)]:
            stripped = paragraph.text.strip()
            if stripped.startswith("• Mục tiêu:"):
                set_text(paragraph, shorten_field(stripped, "• Mục tiêu", 28))
            elif stripped.startswith("• Kết quả thực tế:"):
                set_text(paragraph, shorten_field(stripped, "• Kết quả thực tế", 42))
            elif stripped.startswith("• Thực tế:"):
                set_text(paragraph, shorten_field(stripped, "• Thực tế", 42))


def main() -> None:
    original_hash = sha256(SOURCE)
    document = Document(SOURCE)
    all_cases = read_csv(ROOT / "all_cases_results.csv")
    retest = {row["ma_ca"]: row for row in read_csv(ROOT / "results_retest.csv")}
    results = {row["ma_ca"]: row["trang_thai_chuan_hoa"] for row in all_cases}

    # Mục lục tự động và cập nhật field khi mở tệp.
    if len(document.paragraphs) > 14:
        add_toc(document.paragraphs[14])
    settings = document.settings._element
    update = settings.find(qn("w:updateFields"))
    if update is None:
        update = OxmlElement("w:updateFields"); settings.append(update)
    update.set(qn("w:val"), "true")

    # Trạng thái và nội dung tái kiểm thử theo từng khối ca.
    headings = {}
    for index, paragraph in enumerate(document.paragraphs):
        match = re.match(r"^(BB-\d{2}|WB-\d{2}|UI-\d{2}|API-\d{2}|ADV-\d{2})(?:\s*\(PM-API-\d{2}\))?:", paragraph.text.strip())
        if match and match.group(1) not in headings:
            headings[match.group(1)] = index
    for case_id, start in headings.items():
        end = min([value for value in headings.values() if value > start] or [len(document.paragraphs)])
        for paragraph in document.paragraphs[start + 1:min(end, start + 18)]:
            if "Trạng thái:" in paragraph.text:
                prefix = "• Trạng thái:"
                suffix = f" | Nguyên nhân: {FAILURE_REASONS[case_id]}" if results[case_id] == "Chưa đạt" else ""
                set_text(paragraph, f"{prefix} {results[case_id]}{suffix}")
                break
        if case_id in retest:
            passed, total = assertion_summary(case_id)
            row = retest[case_id]
            for paragraph in document.paragraphs[start + 1:min(end, start + 18)]:
                stripped = paragraph.text.strip()
                if stripped.startswith("• Thực tế:") or stripped.startswith("• Kết quả thực tế:"):
                    detail = f"Đã chạy lại trong phiên 01/11/2026; {passed}/{total} phép đối chiếu khớp mong đợi."
                    if results[case_id] == "Chưa đạt": detail += " " + row["nguyen_nhan"]
                    set_text(paragraph, "• Thực tế: " + detail)
                if stripped.startswith("• Minh chứng:") or "Đối chiếu minh chứng:" in stripped:
                    set_text(paragraph, f"• Minh chứng: evidence/retest/{case_id}/ và evidence/images/MC-{case_id}-*; danh sách tệp gốc trong results_retest.csv.")

    # Cách đọc trạng thái chỉ còn hai giá trị.
    for idx, paragraph in enumerate(document.paragraphs):
        if paragraph.text.strip().startswith("1.7 Quy ước"):
            if idx + 1 < len(document.paragraphs):
                set_text(document.paragraphs[idx + 1], "Báo cáo chỉ dùng hai trạng thái. Đạt nghĩa là toàn bộ bước và dữ liệu thử khớp mong đợi và có minh chứng. Chưa đạt áp dụng khi có sai lệch hoặc chưa chứng minh được; nguyên nhân phải ghi rõ a) lỗi sản phẩm kèm mã BUG, hoặc b) chưa chứng minh được kèm trở ngại và các cách đã thử.")
            break

    # Bảng quy ước: giữ hai dòng trạng thái.
    status_table = document.tables[4]
    status_table.cell(1, 0).text = "Đạt"
    status_table.cell(1, 1).text = "Mọi bước và dữ liệu thử khớp mong đợi, có đủ minh chứng."
    status_table.cell(2, 0).text = "Chưa đạt"
    status_table.cell(2, 1).text = "Có sai lệch, hoặc chưa chứng minh được. Ghi nguyên nhân loại a kèm BUG hoặc loại b kèm trở ngại và các cách đã thử."
    for row in list(status_table.rows)[3:]:
        status_table._tbl.remove(row._tr)

    # Cập nhật các bảng có mã ca.
    for table in document.tables:
        for row in table.rows:
            row_text = " ".join(cell.text for cell in row.cells)
            case_ids = re.findall(r"(?:BB|WB|UI|API|ADV)-\d{2}", row_text)
            unique = list(dict.fromkeys(case_ids))
            if len(unique) == 1:
                case_id = unique[0]
                for cell in row.cells:
                    if re.search(r"(?:Thực hiện một phần|Không đạt|Chưa đạt|Đạt)", cell.text, re.I):
                        # Giữ số bước trong ngoặc nếu có, nhưng chuẩn hóa nhãn.
                        extra = re.search(r"\([^)]*\)", cell.text)
                        cell.text = results.get(case_id, "Chưa đạt") + (f" {extra.group(0)}" if extra else "")

    # Ma trận RTM BB: tính lại số Đạt/Chưa đạt và xóa cột một phần về 0.
    rtm = document.tables[8]
    for row in rtm.rows[1:]:
        ids = re.findall(r"BB-\d{2}", row.cells[2].text)
        row.cells[3].text = str(len(ids))
        row.cells[4].text = str(sum(results.get(case_id) == "Đạt" for case_id in ids))
        row.cells[5].text = str(sum(results.get(case_id) == "Chưa đạt" for case_id in ids))
        row.cells[6].text = "0"
    rtm.cell(0, 5).text = "Số ca Chưa đạt"; rtm.cell(0, 6).text = "Chưa đánh giá"

    # Bảng tổng hợp 6.1.
    summary = document.tables[15]
    summary.cell(1, 2).text = "25 Đạt, 11 Chưa đạt"
    summary.cell(1, 3).text = "69,44% Đạt"
    summary.cell(2, 2).text = "17 Đạt, 1 Chưa đạt"
    summary.cell(3, 2).text = "Chrome và Firefox: 5 Đạt, 3 Chưa đạt"
    summary.cell(4, 2).text = "15 Đạt, 9 Chưa đạt, 0 lỗi thực thi"
    summary.cell(5, 2).text = "2 Đạt, 6 Chưa đạt"

    # Thêm các BUG mới theo cùng mẫu bảng khiếm khuyết.
    bugs = document.tables[16]
    new_bugs = [
        ["BUG-13", "Họ tên chỉ có dấu cách không hiển thị thông báo từ chối", "BB-02", "P2 (Major)", "Kiểm tra giá trị sau trim và trả thông báo trường bắt buộc trên biểu mẫu."],
        ["BUG-14", "Hai nhân viên giao hàng cùng được báo nhận thành công một đơn", "ADV-02", "P1 (Critical)", "Nhận đơn bằng cập nhật nguyên tử có điều kiện trạng thái và chưa có người nhận."],
        ["BUG-15", "Hai yêu cầu giao đồng thời cộng thù lao hai lần", "ADV-03", "P1 (Critical)", "Chuyển trạng thái và cộng thù lao trong một giao dịch nguyên tử, có khóa chống lặp."],
        ["BUG-16", "Giỏ hàng chấp nhận số lượng lẻ 1,5", "ADV-04", "P2 (Major)", "Kiểm tra số nguyên dương ở máy chủ trước khi ghi giỏ hàng."],
        ["BUG-17", "Yêu cầu thay đổi khác nguồn làm tăng giỏ hàng", "ADV-06", "P1 (Critical)", "Bổ sung CSRF token và chính sách SameSite phù hợp cho các yêu cầu thay đổi."],
    ]
    for values in new_bugs:
        new_row = bugs.add_row().cells
        for cell, value in zip(new_row, values): cell.text = value

    # Cập nhật các đoạn tổng hợp chính.
    for paragraph in document.paragraphs:
        text = paragraph.text
        if text.startswith("Sau khi hoàn thành thực nghiệm 36 ca kiểm thử hộp đen"):
            set_text(paragraph, "Kết quả cuối của 36 ca hộp đen là 25 Đạt (69,44%) và 11 Chưa đạt (30,56%). Tám ca từng chưa hoàn tất đã được chạy lại; BB-02 và BB-26 Chưa đạt do BUG-13 và BUG-11, sáu ca còn lại Đạt.")
        text = paragraph.text.replace("58 ca Đạt", "64 ca Đạt").replace("36 ca Chưa đạt", "30 ca Chưa đạt")
        text = text.replace("61,70%", "68,09%").replace("38,30%", "31,91%")
        text = text.replace("19 ca", "25 ca") if "hộp đen" in text and "19 ca" in text else text
        if text != paragraph.text: set_text(paragraph, text)

    # Xóa câu dẫn lặp trước Bảng 6.1.
    for paragraph in list(document.paragraphs):
        if paragraph.text.strip().startswith("Bảng 6.1 tổng hợp số lượng ca"):
            delete_paragraph(paragraph)

    condense_editorial_content(document, results)

    # Chuẩn hóa ngôn ngữ trên toàn văn và bảng.
    for paragraph in iter_all_paragraphs(document):
        revised = normalize_language(paragraph.text)
        if revised != paragraph.text:
            set_text(paragraph, revised)

    # Gán Heading 1-3 đúng cấp.
    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if re.match(r"^\d+\.\d+\.\d+\s+", text): paragraph.style = document.styles["Heading 3"]
        elif re.match(r"^\d+\.\d+\s+", text): paragraph.style = document.styles["Heading 2"]
        elif re.match(r"^\d+\s+", text) or text in {"KẾT LUẬN", "TÀI LIỆU THAM KHẢO"}: paragraph.style = document.styles["Heading 1"]

    # Renumber hình/bảng liên tục theo chương, dùng dấu hai chấm.
    chapter = None; figure_counts = {}; table_counts = {}
    for paragraph in document.paragraphs:
        heading_match = re.match(r"^(\d+)\s+", paragraph.text.strip())
        if heading_match: chapter = int(heading_match.group(1))
        text = paragraph.text.strip()
        if chapter and re.match(r"^Hình\s+", text):
            figure_counts[chapter] = figure_counts.get(chapter, 0) + 1
            rest = re.sub(r"^Hình\s+(?:\d+(?:\.\d+)?)(?:\s*[:\-\u2013\u2014]?\s*)", "", text)
            rest = rest.replace("–", ":").replace("—", ":").replace(" -- ", " - ")
            mc = re.match(r"(MC-[A-Z]+-\d+(?:-\d+)?)(?:\s*[:\-]?\s*)(.*)", rest)
            if mc: rest = f"{mc.group(1)}: {mc.group(2)}"
            set_text(paragraph, f"Hình {chapter}.{figure_counts[chapter]}: {rest}")
            paragraph.style = document.styles["Caption"]
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        elif chapter and re.match(r"^Bảng\s+", text):
            table_counts[chapter] = table_counts.get(chapter, 0) + 1
            rest = re.sub(r"^Bảng\s+(?:\d+(?:\.\d+)?)(?:\s*[:\-\u2013\u2014]?\s*)", "", text)
            set_text(paragraph, f"Bảng {chapter}.{table_counts[chapter]}: {rest}")
            paragraph.style = document.styles["Caption"]
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER

    # Phụ lục tái kiểm thử và minh chứng mới.
    document.add_page_break()
    heading = document.add_paragraph("7 Tái kiểm thử cuối và minh chứng bổ sung", style="Heading 1")
    document.add_paragraph("Phần này ghi kết quả chạy thật trong phiên 01/11/2026. Tất cả lượt Selenium dùng MongoDB tạm và hai cổng localhost ngẫu nhiên; không thay đổi mã nguồn website.")
    document.add_paragraph("7.1 Kết quả chạy lại", style="Heading 2")
    table = document.add_table(rows=1, cols=6)
    table.style = "Table Grid"
    for cell, text in zip(table.rows[0].cells, ["Mã ca", "Cũ", "Mới", "Nguyên nhân", "BUG", "Minh chứng"]): cell.text = text
    for case_id in ["BB-02", "BB-23", "BB-26", "BB-29", "BB-30", "BB-33", "BB-35", "BB-36", "ADV-07"]:
        row = retest[case_id]; cells = table.add_row().cells
        values = [case_id, row["trang_thai_cu"], row["trang_thai_moi"], row["nguyen_nhan"], row["ma_bug"] or "-", row["minh_chung"].split(";")[0]]
        for cell, value in zip(cells, values): cell.text = value
    document.add_paragraph("Tổng 94 ca sau chuẩn hóa: 64 Đạt (68,09%) và 30 Chưa đạt (31,91%). Theo nhóm: BB 25/36 Đạt; WB 17/18; UI 5/8; API 15/24; ADV 2/8.")

    document.add_paragraph("7.2 Khiếm khuyết mới", style="Heading 2")
    bug_details = [
        ("BUG-13", "Họ tên chỉ có dấu cách không hiển thị thông báo từ chối", "Mở biểu mẫu đăng ký, nhập họ tên ba dấu cách; các trường khác hợp lệ.", "Không tạo tài khoản và hiển thị thông báo họ tên bắt buộc.", "Không tạo tài khoản nhưng không hiển thị thông báo; tái hiện trên Chrome và Firefox.", "MC-BB-02-chrome-20 và MC-BB-02-firefox-20", "P2"),
        ("BUG-14", "Hai nhân viên giao hàng cùng được báo nhận thành công một đơn", "Hai phiên nhân viên giao hàng gửi nhận cùng một đơn đang chờ gần đồng thời.", "Chỉ một yêu cầu thành công; lịch sử chỉ ghi người được gán.", "Cả hai yêu cầu báo thành công và lịch sử của cả hai đều ghi nhận, dù dữ liệu cuối chỉ gán một người.", "MC-ADV-02", "P1"),
        ("BUG-15", "Hai yêu cầu giao đồng thời cộng thù lao hai lần", "Gửi hai yêu cầu xác nhận giao gần đồng thời cho cùng đơn đang giao.", "Đơn hoàn tất và thù lao 12.000 đồng chỉ được ghi một lần.", "Hai yêu cầu cùng thành công, thù lao tăng 24.000 đồng và lưu hai sự kiện.", "MC-ADV-03", "P1"),
        ("BUG-16", "Giỏ hàng chấp nhận số lượng lẻ", "Gửi số lượng 1,5 cho sản phẩm còn hàng trong DB tạm.", "Máy chủ từ chối vì số lượng phải là số nguyên dương.", "Giá trị 1,5 được chấp nhận và lưu trong giỏ hàng.", "MC-ADV-04", "P2"),
        ("BUG-17", "Yêu cầu thay đổi khác nguồn làm tăng giỏ hàng", "Người dùng đăng nhập mở trang thử khác cổng và gửi yêu cầu thay đổi giỏ.", "Yêu cầu không có bằng chứng nguồn hợp lệ bị từ chối; giỏ giữ nguyên.", "Yêu cầu được chấp nhận và giỏ tăng từ 0 lên 1.", "MC-ADV-06-1 và MC-ADV-06-2", "P1"),
    ]
    for bug_id, name, condition, expected, actual, evidence, priority in bug_details:
        document.add_paragraph(f"{bug_id}: {name}", style="Heading 3")
        document.add_paragraph(f"Điều kiện: {condition}")
        document.add_paragraph(f"Mong đợi: {expected}")
        document.add_paragraph(f"Thực tế: {actual}")
        document.add_paragraph(f"Minh chứng: {evidence}. Mức ưu tiên: {priority}.")

    document.add_paragraph("7.3 Minh chứng tổng hợp", style="Heading 2")
    image_items = [
        ("MC-HOME-01.png", "Trang chủ khách hàng sau đăng nhập"),
        ("MC-ADMIN-01.png", "Danh sách đơn trên Admin App"),
        ("MC-SHIPPER-01.png", "Bảng điều khiển và thù lao nhân viên giao hàng"),
        ("MC-DB-01.png", "Các collection trong MongoDB tạm, kết xuất bằng MongoDB Node.js client"),
        ("MC-WB-JEST-1.png", "Kết quả Jest 134/134"),
        ("MC-WB-COVERAGE-1.png", "Tổng hợp độ phủ Istanbul"),
        ("MC-WB-CART-1.png", "Chi tiết độ phủ cartController.js"),
        ("MC-PM-SUMMARY-1.png", "Tổng hợp Newman 24 ca API"),
        ("MC-SELENIUM-CHROME-1.png", "Báo cáo Selenium Chrome"),
        ("MC-SELENIUM-FIREFOX-1.png", "Báo cáo Selenium Firefox"),
        ("MC-ADV-07-1.png", "ADV-07: 8/8 phép so sánh Chrome và Firefox đúng"),
        ("MC-BB-02-chrome-20.png", "BB-02: họ tên dấu cách không có thông báo"),
        ("MC-BB-23-chrome-01.png", "BB-23: khóa hủy đơn đã giao"),
        ("MC-BB-26-chrome-20.png", "BB-26: kết quả dữ liệu chữ trong ô số"),
        ("MC-BB-29-chrome-12.png", "BB-29: từ chối xác nhận mật khẩu sai"),
        ("MC-BB-30-chrome-04.png", "BB-30: trạng thái sau duyệt và hủy"),
        ("MC-BB-33-chrome-03.png", "BB-33: chỉ đơn waiting còn có thể nhận"),
        ("MC-BB-35-chrome-03.png", "BB-35: thu nhập sau hai yêu cầu giao đồng thời"),
        ("MC-BB-36-chrome-07.png", "BB-36: thu nhập không tăng sau hủy"),
        ("MC-GIT-LOG-01.png", "Git log nhánh retest-final và các commit"),
    ]
    for number, (filename, caption) in enumerate(image_items, start=1):
        path = IMAGES / filename
        if not path.exists():
            continue
        paragraph = document.add_paragraph(); paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.add_run().add_picture(str(path), width=Inches(6.2))
        cap = document.add_paragraph(f"Hình 7.{number}: {filename.removesuffix('.png')}: {caption}", style="Caption")
        cap.alignment = WD_ALIGN_PARAGRAPH.CENTER

    document.add_paragraph("7.4 Nội dung cần người thực hiện", style="Heading 2")
    document.add_paragraph("[CẦN NGƯỜI THỰC HIỆN: ảnh GitHub Pull Request, review chéo và Issues do cần đăng nhập tài khoản nhóm.]")
    document.add_paragraph("[CẦN NGƯỜI THỰC HIỆN: điền bảng phân công, tỷ lệ đóng góp, chữ ký và điểm tự chấm rubric.]")
    document.add_paragraph("CFG Graphviz chưa kết xuất do gói Graphviz không cài hoàn tất. Bảng 3.1 giữ các giá trị V(G) cũ và các ô [CẦN XÁC NHẬN]; không tự ý sửa số khi chưa có đồ thị đối chiếu.")

    # Bỏ in đậm trong ô trạng thái; giữ tiêu đề và tên trường.
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                if cell.text.strip() in {"Đạt", "Chưa đạt", "P1", "P2", "P1 (Critical)", "P2 (Major)"}:
                    for paragraph in cell.paragraphs:
                        for run in paragraph.runs: run.bold = False

    document.core_properties.title = "Báo cáo đánh giá và kiểm định chất lượng phần mềm - bản tái kiểm thử cuối"
    document.core_properties.subject = "Website bán quần áo trực tuyến"
    document.save(TARGET)
    assert sha256(SOURCE) == original_hash, "Báo cáo gốc đã bị thay đổi"
    print(json.dumps({"source_sha256": original_hash, "target": str(TARGET), "target_sha256": sha256(TARGET)}, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
