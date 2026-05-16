async function loadFaceMatcherFromJSON() {
    try {
        // 1. ดึงไฟล์ JSON มา
        const response = await fetch('/data/members.json');
        if (!response.ok) {
            throw new Error(`ไม่สามารถโหลดไฟล์ได้:รหัสสถานะ ${response.status}`);
        }
        const data = await response.json();

        // 2. แปลงข้อมูล JSON กลับเป็น LabeledFaceDescriptors
        const labeledDescriptors = data.map(item => {
            // ป้องกันกรณีที่บางรายชื่อไม่มีข้อมูล descriptors
            const descriptors = (item.descriptors || []).map(d => new Float32Array(d));
            return new faceapi.LabeledFaceDescriptors(item.label, descriptors);
        });

        // 3. สร้าง FaceMatcher พร้อมใช้งานทันที!
        // (สามารถปรับ 0.65 ลงมาเป็น 0.60 ได้ถ้าต้องการให้ระบบสแกนตรวจสอบคนหน้าคล้ายเข้มงวดขึ้น)
        const faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.65);
        return faceMatcher;

    } catch (error) {
        console.error("❌ เกิดข้อผิดพลาดในการโหลด FaceMatcher:", error);
        // คุณสามารถใส่โค้ดเตือนบนหน้าจอตรงนี้ได้ เช่น statusBadge.innerText = "โหลดฐานข้อมูลไม่สำเร็จ";
        return null;
    }
}