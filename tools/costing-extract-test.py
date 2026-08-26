#!/usr/bin/env python3
"""ชุดทดสอบของ costing-extract.py — รันด้วย:  python3 tools/costing-extract-test.py

ทดสอบทางที่ไฟล์จริงไม่ได้เดินผ่าน (ไฟล์ Costing Mech รอบนี้ข้อมูลครบทุกแถว
สถานะ 🔴 จึงไม่เคยถูกใช้เลย) — ถ้าไม่ทดสอบตรงนี้จะไม่มีอะไรยืนยันว่ากฎข้อ 4 ทำงานจริง
"""
import os, subprocess, sys, tempfile, json

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "costing-extract.py")

try:
    import openpyxl
except ImportError:
    sys.exit("ต้องติดตั้ง openpyxl ก่อน:  pip install openpyxl")

HEAD = ["ROW_NUM", "Supplier", "PO Number", "Price", "Currency", "Due Date",
        "PO Payment Term", "Import duty", "Import duty"]   # ชื่อซ้ำจงใจ เหมือนไฟล์จริง
ROWS = [
    [1, "A Co", "PO-1", 100, "USD", "09.01.2026", "LC 90 days after BL date", 0, 0],
    [2, "B Co", "PO-2", 200, "THB", "10.01.2026", "l/c at sight", 0, 0],
    [3, "C Co", "PO-3", 300, "THB", "11.01.2026", "L / C 30 days", 0, 0],
    [4, "D Co", "PO-4", 400, "THB", "12.01.2026", None, 0, 0],
    [5, "",     "PO-5", None, "THB", "",          "100% advance", 0, 0],
    [6, "F Co", "",     0,   "USD", "14.01.2026", "100% advance", 0, 0],
    [7, "G Co", "PO-7", 0,   "USD", "2026-01-15", "100% advance", 0, 0],
    [None] * 9,
]

bad = []


def run(path, out=None):
    cmd = [sys.executable, SCRIPT, path] + (["-o", out] if out else [])
    return subprocess.run(cmd, capture_output=True, text=True)


def main():
    tmp = tempfile.mkdtemp()
    xl, js = os.path.join(tmp, "edge.xlsx"), os.path.join(tmp, "edge.json")
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Sheet1"
    ws.append(HEAD)
    for r in ROWS:
        ws.append(r)
    wb.save(xl)

    p = run(xl, js)
    if p.returncode != 0:
        bad.append("สคริปต์ตายกับไฟล์ปกติ: " + p.stderr.strip()[:200])
        return report()
    d = json.load(open(js, encoding="utf-8"))
    s, rows = d["stats"], d["rows"]
    by = {r["PO Number"] or "(ว่าง)": r for r in rows}

    ck = lambda cond, msg: bad.append(msg) if not cond else None
    ck(s.get("read") == 7, "นับแถวว่างล้วนเป็นข้อมูลด้วย (ต้องข้าม)")
    ck(s.get("excluded_lc") == 3, "ตัด LC ไม่ครบ 3 รูปแบบ (LC / l/c / L / C)")
    ck(len(rows) == 4, "จำนวนแถวที่เหลือไม่ถูกต้อง")
    ck(s.get("unknown_term") == 1, "เงื่อนไขจ่ายว่างไม่ได้ถูกนับเป็น UNKNOWN")
    ck(by.get("PO-4", {}).get("PO Payment Term") == "UNKNOWN",
       "เงื่อนไขจ่ายว่างไม่ได้แปลงเป็น UNKNOWN")
    ck(by.get("PO-4", {}).get("Payment_Status", "").startswith("🟢"),
       "UNKNOWN ถูกตัดทิ้งทั้งที่ควรเก็บไว้ทำจ่าย")
    ck("Supplier" in by.get("PO-5", {}).get("Missing", []) and
       "Price" in by.get("PO-5", {}).get("Missing", []) and
       "Due Date" in by.get("PO-5", {}).get("Missing", []),
       "ไม่ได้ระบุชื่อฟิลด์ที่ขาดครบทุกฟิลด์")
    ck(by.get("PO-5", {}).get("Payment_Status", "").startswith("🔴"),
       "แถวข้อมูลไม่ครบไม่ได้สถานะ 🔴")
    ck(by.get("(ว่าง)", {}).get("Missing") == ["PO Number"],
       "PO Number ว่างไม่ถูกจับว่าขาด")
    ck(by.get("(ว่าง)", {}).get("Zero_Price") is True and
       by.get("PO-7", {}).get("Zero_Price") is True and s.get("zero_price") == 2,
       "ยอดศูนย์ไม่ถูกติดธง")
    ck(by.get("PO-7", {}).get("Payment_Status", "").startswith("🟢"),
       "ยอดศูนย์ไม่ควรทำให้สถานะกลายเป็นไม่ครบ — เป็นคนละเรื่องกัน")
    ck(by.get("PO-4", {}).get("Due_ISO") == "2026-01-12", "แปลงวันที่ dd.mm.yyyy ไม่ถูก")
    ck(by.get("PO-7", {}).get("Due_ISO") == "2026-01-15", "แปลงวันที่ yyyy-mm-dd ไม่ถูก")

    # ไฟล์ที่ไม่มีคอลัมน์ที่ต้องใช้ ต้องบอกว่าขาดอะไร ไม่ใช่ traceback
    xl2 = os.path.join(tmp, "bad.xlsx")
    wb2 = openpyxl.Workbook(); wb2.active.append(["A", "B"]); wb2.active.append([1, 2]); wb2.save(xl2)
    p2 = run(xl2)
    ck(p2.returncode == 1 and "ไม่พบคอลัมน์ที่ต้องใช้" in p2.stdout,
       "ไฟล์ผิดโครงสร้างแล้วไม่ได้บอกว่าขาดคอลัมน์อะไร")
    ck("Traceback" not in p2.stderr, "ไฟล์ผิดโครงสร้างแล้วสคริปต์พังแบบ traceback")
    report()


def report():
    if bad:
        print("พบปัญหา %d:" % len(bad))
        for b in bad:
            print("  - " + b)
        sys.exit(1)
    print("ทดสอบ costing-extract ผ่านทั้งหมด (ตัด LC 3 แบบ · UNKNOWN · 🔴 ระบุฟิลด์ที่ขาด · "
          "ธงยอดศูนย์ · วันที่ 2 รูปแบบ · ไฟล์ผิดโครงสร้าง)")


if __name__ == "__main__":
    main()
