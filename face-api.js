async function loadFaceMatcherFromJSON() {
    // 1. ดึงไฟล์ JSON มา
    const response = await fetch('/data/members.json');
    const data = await response.json();

    // 2. แปลงข้อมูล JSON กลับเป็น LabeledFaceDescriptors
    const labeledDescriptors = data.map(item => {
        const descriptors = item.descriptors.map(d => new Float32Array(d));
        return new faceapi.LabeledFaceDescriptors(item.label, descriptors);
    });

    // 3. สร้าง FaceMatcher พร้อมใช้งานทันที!
    const faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.6);
    return faceMatcher;
}