# Workforce Manager

ระบบจัดการพนักงาน งาน คลัง Item และเช็คชื่อ
ทำงานเป็น static web app ไม่ต้องมี server

## โครงสร้างไฟล์

```
workforce-manager/
├── index.html   HTML structure + data store
├── style.css    Stylesheet ทั้งหมด (21 sections)
├── app.js       Application logic (14 sections)
└── README.md    ไฟล์นี้
```

## วิธีใช้งาน

เปิด `index.html` ในเบราว์เซอร์ หรือ deploy ขึ้น GitHub Pages ได้เลย

## การบันทึกข้อมูล

กดปุ่ม **💾 บันทึก & ดาวน์โหลด**
ระบบจะ bundle index.html + style.css + app.js เป็นไฟล์เดียว
แล้ว download เป็น `workforce_YYYY-MM-DD_HH-MM.html`

เปิดไฟล์นั้นทีหลังข้อมูลยังครบ ใช้เป็น backup หรือแชร์ให้คนอื่นได้

## การนำเข้าข้อมูลจากไฟล์เก่า

กดปุ่ม **📥 นำเข้าไฟล์เก่า** แล้วเลือก `.html` ที่เคย save ไว้
รองรับทั้ง **Merge** (รวมข้อมูล) และ **Replace** (แทนที่ทั้งหมด)

## ฟีเจอร์

| ส่วน | ฟีเจอร์ |
|------|---------|
| คลังพนักงาน | เพิ่ม / แก้ไข / ลบ พร้อมรูปภาพ |
| รายการงาน | สร้างงาน มอบหมายพนักงานและ Item |
| คลัง Item | จัดการอุปกรณ์ ติดตามสถานะ ว่าง / ถูกใช้ / เสียหาย |
| เช็คชื่อ | เครื่องรูดบัตร + ตารางเช็คชื่อ + บันทึกรายละเอียด |

## Schema version

| Version | เพิ่มเติม |
|---------|-----------|
| v1 | employees · missions (comment-injected) |
| v2 | เปลี่ยนมาใช้ JSON data tag |
| v3 | attendanceDays · attendance per employee |
| v4 | items · mission.items[] |
