# แก้ doPost ใน Ratchayothin.gs (แก้เพียงจุดเดียว)

`doPost` เดิมของ `Ratchayothin.gs` เป็น webhook ของ LINE ต้องเพิ่ม 5 บรรทัดแรกนี้
ไว้ **บนสุดของฟังก์ชัน** เพื่อส่งคำขอจองจากหน้าเว็บ (GitHub Pages) ไปที่ `webApiPost_` ส่วนที่เหลือคงเดิม:

```js
function doPost(e) {
  // booking API call from the GitHub Pages web page (see WebApp.gs); anything else is the LINE webhook
  try {
    if (typeof webIsApiPost_ === 'function' && webIsApiPost_(e)) return webApiPost_(e);
  } catch (errApi) {
    Logger.log('doPost api delegate error: ' + errApi);
  }
  try {
    var body = JSON.parse(e.postData.contents);
    // ... (โค้ดเดิมของ LINE webhook ไม่เปลี่ยน)
```

ถ้า Apps Script ไม่มีฟังก์ชัน `doPost` เลย ให้สร้างใหม่แบบนี้:

```js
function doPost(e) {
  return webApiPost_(e);
}
```
