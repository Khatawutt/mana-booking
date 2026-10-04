# Mana Booking — หน้าเว็บจองโต๊ะ + สั่งอาหารล่วงหน้า (Mana Garden / Mana Ratchayothin)

เว็บหน้าเดียว (static) โฮสต์บน **GitHub Pages** ดีไซน์ Light Luxe v3 (พื้นขาว + ทอง #d4af37 + ปุ่มดำ, การ์ดเมนูแบบกริด) ใช้บนมือถือเป็นหลัก
หลังบ้านคือ **Google Apps Script Web App** ที่ทำหน้าที่เป็น JSON API: ตรวจรอบว่าง, ล็อกคิวกันจองซ้ำ,
เขียนลงชีต Master Database, และส่ง LINE แจ้งทีมงาน (ฟอร์ม Google เดิมยังใช้งานได้ตามปกติ)

| สาขา | ลิงก์ |
|---|---|
| Mana Garden | https://khatawutt.github.io/mana-booking/ |
| Mana Ratchayothin | https://khatawutt.github.io/mana-booking/ratch/ (ลิงก์เดิม `?b=ratch` ยังใช้ได้) |

> แนะนำให้แชร์ลิงก์ Ratchayothin เป็น `/ratch/` เพราะตัวอย่างลิงก์ใน LINE/Facebook จะแสดงโลโก้ถูกสาขา

## โครงสร้าง

```
index.html              หน้าเว็บ Mana Garden (โครง HTML)
ratch/index.html        หน้า Mana Ratchayothin (สร้างจาก index.html ด้วย tools/build_pages.py)
css/app.css             ธีม Light Luxe v3 (ขาว-ทอง, การ์ดเมนู 2/3 คอลัมน์, รองรับ reduced-motion)
js/config.js            ตั้งค่า: API_URL, timeout, ไฟล์โลโก้ของแต่ละสาขา
js/app.js               ตรรกะหน้าเว็บ + เรียก API
data/garden.json        เมนู + ตั้งค่าสาขา Mana Garden (16 หมวด 139 รายการ)
data/ratch.json         เมนู + ตั้งค่าสาขา Mana Ratchayothin (20 หมวด 165 รายการ)
assets/mana-qr.jpg      QR พร้อมเพย์สำหรับโอนมัดจำ
assets/logo-*.webp      โลโก้พื้นโปร่งใส (garden / ratch) · mark-*.webp = ไอคอน M ใน header
assets/favicon-*.png, apple-touch-*.png, og-*.png   ไอคอนแท็บ / หน้าจอโฮม / รูปตัวอย่างตอนแชร์
backend/                โค้ด Google Apps Script (ไม่มี token/รหัสลับใดๆ)
  WebApp.gs             doGet/API, ตรวจข้อมูล, ล็อก, เขียนชีต, ส่ง LINE, rate-limit
  WebMenuData.gs        เมนู+ราคาฝั่งเซิร์ฟเวอร์ (สร้างจาก data/*.json — ห้ามแก้มือ)
  WebQr.gs              QR แบบ base64 (ใช้กับหน้าเว็บเก่าใน Apps Script เท่านั้น)
  Index.html            หน้าเว็บเก่าแบบ Apps Script (ยังใช้ได้ ลิงก์เดิมไม่เสีย)
  Ratchayothin_doPost_patch.md   วิธีแก้ doPost 5 บรรทัด
tools/build_backend_menu.py      data/*.json -> backend/WebMenuData.gs
tools/build_pages.py             index.html -> ratch/index.html (รันทุกครั้งที่แก้ index.html)
```

## ความปลอดภัย

* รีโปนี้เป็น **public** (GitHub Pages แพ็กเกจฟรีต้องเป็น public) ห้ามใส่ token / รหัสลับ
  `LINE_CHANNEL_ACCESS_TOKEN`, `TARGET_GROUP_ID`, `RT_SHEET_ID` ฯลฯ อยู่ใน **Script Properties** ของ Apps Script เท่านั้น
* เซิร์ฟเวอร์ไม่เชื่อราคา/ยอดรวมจากหน้าเว็บ: รับแค่รหัสเมนูกับจำนวน แล้วคำนวณยอดอาหารและขั้นต่ำใหม่เองจาก `WebMenuData.gs`
* ตรวจความจุซ้ำภายใน `LockService` (กันจองชนกัน), กันสูตรชีต (`= + - @`), ช่อง honeypot,
  กันกดซ้ำ 5 นาที, และ rate-limit ด้วย CacheService (ต่อเบอร์โทร 5 ครั้ง/10 นาที, รวมทุกคน 20 การจอง/นาที)

## วิธีแก้เมนู / ราคา

1. แก้ `data/garden.json` หรือ `data/ratch.json` (รูปแบบรายการ: `["รหัส","ชื่อไทย","ชื่ออังกฤษ","ชื่อจีน",ราคา]`
   — รหัสต้องไม่ซ้ำ ห้ามเปลี่ยนรหัสของรายการเดิมถ้าไม่จำเป็น)
2. รัน `python3 tools/build_backend_menu.py` (สร้าง `backend/WebMenuData.gs` และอัปเดต `menuVersion`)
3. commit + push → หน้าเว็บอัปเดตเอง (รอ 1–2 นาที)
4. เปิด Apps Script วางเนื้อหา `backend/WebMenuData.gs` ทับไฟล์ `WebMenuData` แล้ว Deploy เวอร์ชันใหม่
   (ราคาที่ใช้คิดเงินจริงคือฝั่ง Apps Script ถ้าสองฝั่งไม่ตรง หน้าเว็บจะขึ้นแถบเตือนให้โหลดใหม่)

## วิธี deploy หลังบ้าน (Apps Script)

ไฟล์ในโปรเจกต์ Apps Script (วางด้วยการ copy-paste):

| ไฟล์ในโปรเจกต์ | เนื้อหา |
|---|---|
| `WebMenuData` (Script) | `backend/WebMenuData.gs` |
| `WebQr` (Script) | `backend/WebQr.gs` |
| `WebApp` (Script) | `backend/WebApp.gs` |
| `Index` (HTML) | `backend/Index.html` (เฉพาะหน้าเก่า — ไม่จำเป็นสำหรับ API) |
| `Ratchayothin` (Script) | ไฟล์เดิม แก้ `doPost` ตาม `backend/Ratchayothin_doPost_patch.md` |

Deploy → **Manage deployments → Edit (ดินสอ) → Version: New version → Deploy** (URL เดิมไม่เปลี่ยน)
ตั้งค่า: Execute as **Me**, Who has access **Anyone**

ทดสอบ: เปิด `<API_URL>?api=ping` ต้องได้ JSON `{"ok":true,...}`

ถ้าเปลี่ยน URL ของ Web App ให้แก้ค่า `API_URL` บนสุดของสคริปต์ใน `index.html`

## เปลี่ยนโลโก้

แทนที่ไฟล์ใน `assets/` ด้วยชื่อเดิม (`logo-garden.webp`, `logo-ratch.webp` ใช้พื้นโปร่งใส กว้างราว 640px) แล้ว push
ถ้าแก้ `index.html` ให้รัน `python3 tools/build_pages.py` ก่อน commit ด้วย
(เมื่อแก้ css/js ให้เปลี่ยนเลข `?v=2` ใน index.html เพื่อให้มือถือโหลดไฟล์ใหม่)

## หมายเหตุ

* หน้าเว็บเรียก API แบบ "simple CORS request": ตรวจรอบว่างด้วย GET, ส่งการจองด้วย POST `Content-Type: text/plain`
  (ไม่มี preflight) Apps Script จะ redirect ไปยัง googleusercontent ซึ่งเบราว์เซอร์ตามให้เอง
* ถ้าส่งการจองแล้วเน็ตหลุด ลูกค้ากด "ยืนยันการจอง" ซ้ำได้ เซิร์ฟเวอร์จะคืนรหัสเดิม ไม่สร้างแถวซ้ำ
* ฟอนต์ Inter + Noto Sans Thai โหลดจาก Google Fonts (ถ้าโหลดไม่ได้ใช้ฟอนต์สำรองของเครื่อง) · การ์ดเมนูใช้ช่อง "Photo coming soon" จนกว่าจะมีรูปอาหาร

## แยกเมนู อาหาร / เครื่องดื่ม (v4)
หน้าเมนูมีปุ่มสลับ **อาหาร | เครื่องดื่ม** (แสดงจำนวนรายการที่เลือกในแต่ละฝั่ง) แท็บหมวดด้านล่างจะแสดงเฉพาะหมวดของฝั่งที่เลือก
การจัดหมวดอยู่ที่ฟิลด์ `"type": "food" | "drink"` ของแต่ละหมวดใน `data/garden.json` / `data/ratch.json` (ไม่มี type = food) · การค้นหาค้นทั้งสองฝั่ง
