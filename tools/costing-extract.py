#!/usr/bin/env python3
"""สกัดข้อมูลจาก Costing Mech.xlsx เพื่อขึ้น Dashboard ตั้งเบิกทำจ่าย

รันด้วย:  python3 tools/costing-extract.py <ไฟล์.xlsx> [-o ไฟล์ผลลัพธ์.json]

กติกาตามที่ทีมกำหนด
  1. อ่านชีตแรกสุดเท่านั้น
  2. PO Payment Term ว่าง -> "UNKNOWN"  (กันระบบพัง ไม่ใช่ทิ้งแถว)
  3. ตัดแถวที่ Payment Term มี LC / L/C ออก (ไม่สนตัวพิมพ์)
  4. ตรวจ 4 ฟิลด์  PO Number · Supplier · Price · Due Date  -> Payment_Status
  5. ส่งออก 7 คอลัมน์ + ธงความเสี่ยงยอดศูนย์

หลักที่ยึด: ไฟล์เพี้ยนได้ แต่สคริปต์ต้องไม่ตาย — คอลัมน์หายก็บอกว่าหายอะไร
ไม่ใช่ traceback ยาวเป็นหน้า
"""
import argparse, json, re, sys
from collections import Counter, OrderedDict

try:
    import openpyxl
except ImportError:
    sys.exit("ต้องติดตั้ง openpyxl ก่อน:  pip install openpyxl")

# คอลัมน์ที่ต้องใช้ — ชื่อทางเลือกเผื่อไฟล์รอบหน้าเปลี่ยนหัวคอลัมน์เล็กน้อย
COLS = OrderedDict([
    ("PO Number",       ["po number", "po no", "po_no", "เลขที่ po"]),
    ("Supplier",        ["supplier", "vendor", "ผู้ขาย"]),
    ("PO Payment Term", ["po payment term", "payment term", "term", "เงื่อนไขชำระ"]),
    ("Price",           ["price", "unit price", "ราคา"]),
    ("Currency",        ["currency", "cur", "สกุลเงิน"]),
    ("Due Date",        ["due date", "duedate", "วันครบกำหนด"]),
])
KEY_FIELDS = ["PO Number", "Supplier", "Price", "Due Date"]   # 4 ฟิลด์ที่ตัดสินความครบ
LC_RE = re.compile(r"l\s*/?\s*c", re.IGNORECASE)              # จับ LC · L/C · l / c
UNKNOWN = "UNKNOWN"


def norm(s):
    return re.sub(r"\s+", " ", str(s or "")).strip().lower()


def is_blank(v):
    """ว่างจริง ๆ เท่านั้น — เลข 0 ไม่ใช่ค่าว่าง (ยอดศูนย์เป็นคนละเรื่อง ดู zero_price)"""
    return v is None or str(v).strip() == "" or norm(v) in ("nan", "none", "null", "-")


def map_columns(header):
    """จับคู่หัวคอลัมน์จริงกับที่ต้องใช้ · เจอชื่อซ้ำให้ใช้คอลัมน์แรก (ไฟล์นี้มี Import duty ซ้ำ)"""
    seen, idx, missing = {}, {}, []
    for i, h in enumerate(header):
        k = norm(h)
        if k and k not in seen:
            seen[k] = i
    for want, aliases in COLS.items():
        for a in [norm(want)] + aliases:
            if a in seen:
                idx[want] = seen[a]
                break
        else:
            missing.append(want)
    return idx, missing


def parse_due(v):
    """คืน ISO ไว้เรียงลำดับ — ไฟล์นี้เขียนแบบ dd.mm.yyyy · รองรับ / และ - ด้วย
    แปลงไม่ได้ก็คืนค่าว่าง ไม่ใช่ทำให้ทั้งแถวตก"""
    if hasattr(v, "strftime"):
        return v.strftime("%Y-%m-%d")
    m = re.match(r"^\s*(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s*$", str(v or ""))
    if m:
        d, mo, y = m.groups()
        return "%s-%02d-%02d" % (y, int(mo), int(d))
    m = re.match(r"^\s*(\d{4})-(\d{1,2})-(\d{1,2})", str(v or ""))
    if m:
        y, mo, d = m.groups()
        return "%s-%02d-%02d" % (y, int(mo), int(d))
    return ""


def to_num(v):
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def extract(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[wb.sheetnames[0]]                       # กติกาข้อ 1 — ชีตแรกสุด
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return {"error": "ชีตแรกไม่มีข้อมูลเลย", "sheet": ws.title}

    idx, missing = map_columns(rows[0])
    if missing:
        return {"error": "ไม่พบคอลัมน์ที่ต้องใช้: " + ", ".join(missing),
                "sheet": ws.title, "headers": [str(h) for h in rows[0] if h]}

    get = lambda r, k: r[idx[k]] if idx[k] < len(r) else None
    out, stats = [], Counter()
    terms = Counter()

    for n, r in enumerate(rows[1:], start=2):
        if all(is_blank(c) for c in r):             # แถวว่างล้วน = ท้ายตาราง ข้ามไป
            continue
        stats["read"] += 1

        # กติกาข้อ 2 — ว่างแปลว่า UNKNOWN ไม่ใช่แปลว่าทิ้ง
        term_raw = get(r, "PO Payment Term")
        term = UNKNOWN if is_blank(term_raw) else str(term_raw).strip()
        if term == UNKNOWN:
            stats["unknown_term"] += 1
        terms[term] += 1

        # กติกาข้อ 3 — LC จ่ายผ่านธนาคาร ไม่เข้ากระบวนการตั้งเบิกนี้
        if LC_RE.search(term):
            stats["excluded_lc"] += 1
            continue

        # กติกาข้อ 4 — ครบ 4 ฟิลด์หรือไม่ และถ้าไม่ครบ ขาดอะไรบ้าง
        miss = [f for f in KEY_FIELDS if is_blank(get(r, f))]
        status = ("🟢 พร้อมทำจ่าย (Complete)" if not miss
                  else "🔴 ข้อมูลไม่ครบ (" + ", ".join(miss) + ")")
        stats["complete" if not miss else "incomplete"] += 1

        price = to_num(get(r, "Price"))
        zero = price is not None and price == 0        # มุมมองความเสี่ยง — กันตั้งเบิกยอดศูนย์
        if zero:
            stats["zero_price"] += 1

        out.append({
            "row":             n,
            "PO Number":       "" if is_blank(get(r, "PO Number")) else str(get(r, "PO Number")).strip(),
            "Supplier":        "" if is_blank(get(r, "Supplier")) else str(get(r, "Supplier")).strip(),
            "PO Payment Term": term,
            "Price":           price,
            "Currency":        "" if is_blank(get(r, "Currency")) else str(get(r, "Currency")).strip(),
            "Due Date":        "" if is_blank(get(r, "Due Date")) else str(get(r, "Due Date")).strip(),
            "Due_ISO":         parse_due(get(r, "Due Date")),
            "Payment_Status":  status,
            "Missing":         miss,
            "Zero_Price":      zero,
        })

    return {"sheet": ws.title, "rows": out, "stats": dict(stats),
            "terms": terms.most_common()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx")
    ap.add_argument("-o", "--out", default="")
    a = ap.parse_args()

    res = extract(a.xlsx)
    if "error" in res:
        print("หยุดการประมวลผล — " + res["error"])
        if res.get("headers"):
            print("หัวคอลัมน์ที่เจอในไฟล์: " + " | ".join(res["headers"][:40]))
        sys.exit(1)

    s = res["stats"]
    print("ชีตที่อ่าน: " + res["sheet"])
    print("อ่านมา %d แถว | ตัด LC ออก %d | เหลือเข้ากระบวนการ %d"
          % (s.get("read", 0), s.get("excluded_lc", 0), len(res["rows"])))
    print("  🟢 พร้อมทำจ่าย %d   🔴 ข้อมูลไม่ครบ %d"
          % (s.get("complete", 0), s.get("incomplete", 0)))
    print("  เงื่อนไขจ่ายว่าง (นับเป็น UNKNOWN) %d | ราคาเป็นศูนย์ %d"
          % (s.get("unknown_term", 0), s.get("zero_price", 0)))

    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False, indent=1)
        print("เขียนผลลัพธ์ที่ " + a.out)


if __name__ == "__main__":
    main()
