const video = document.getElementById('video');
const logList = document.getElementById('logList');
const statusBadge = document.getElementById('status');

let faceMatcher = null;
const displaySize = { width: 720, height: 540 };
let attendanceLogs = JSON.parse(localStorage.getItem('logs')) || [];

// 1. โหลดโมเดลทั้งหมด (ใช้ SSD เพื่อความเป๊ะตามที่ Error ฟ้อง)
async function init() {
    try {
        // ต้องมั่นใจว่า path /models ถูกต้องและมีไฟล์ ssd_mobilenetv1 อยู่จริง
        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
            faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
            faceapi.nets.faceRecognitionNet.loadFromUri('/models')
        ]);
        
        console.log("AI Models Loaded");
        statusBadge.innerText = "Scanning Database...";
        
        const labeledDescriptors = await loadLabeledImages();
        faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.6); // ค่าความแม่นยำ (น้อย=เป๊ะมาก)
        
        statusBadge.innerText = "System Live";
        statusBadge.classList.add('status-online');
        
        renderLogs();
        startVideo();
    } catch (err) {
        console.error("Critical Error:", err);
        statusBadge.innerText = "Model Load Failed";
    }
}

// 2. โหลดรูปภาพต้นแบบ (ปรับชื่อ fino, not ตามไฟล์จริง)
async function loadLabeledImages() {
    // รายชื่อโฟลเดอร์ (ชื่อคน)
    const labels = ['Kittipat', 'Sangarun', 'Jiragrit']; 
    
    return Promise.all(
        labels.map(async label => {
            const descriptions = [];
            
            // วนลูปโหลดรูปภาพที่อยู่ในโฟลเดอร์นั้นๆ (เช่น 1.jpg ถึง 3.jpg)
            for (let i = 1; i <= 3; i++) {
                try {
                    // เปลี่ยน Path ให้ชี้เข้าไปในโฟลเดอร์ชื่อ label
                    const img = await faceapi.fetchImage(`/labeled_images/${label}/${i}.jpg`);
                    
                    const detections = await faceapi.detectSingleFace(img)
                        .withFaceLandmarks()
                        .withFaceDescriptor();
                        
                    if (detections) {
                        descriptions.push(detections.descriptor);
                        console.log(`โหลดรูป ${label} ใบที่ ${i} สำเร็จ`);
                    }
                } catch (e) {
                    // ถ้าหาไฟล์ไม่เจอ (เช่น มีแค่ 2 รูป) ก็ให้ข้ามไป
                    console.warn(`ไม่พบไฟล์ /labeled_images/${label}/${i}.jpg`);
                }
            }

            if (descriptions.length > 0) {
                // รวม Descriptor ทั้งหมด (ทั้งแบบใส่แว่นและไม่ใส่) ไว้ภายใต้ชื่อเดียวกัน
                return new faceapi.LabeledFaceDescriptors(label, descriptions);
            }
            return null;
        })
    ).then(res => {
        const filtered = res.filter(d => d !== null);
        if (filtered.length === 0) throw new Error("ไม่สามารถโหลดรูปจากโฟลเดอร์ได้");
        return filtered;
    });
}

let currentFacingMode = 'user'; // เริ่มต้นที่กล้องหน้า

// ค้นหาปุ่มและแอด Event
const flipBtn = document.getElementById('flipBtn');
flipBtn.addEventListener('click', () => {
    // สลับค่าระหว่าง user กับ environment
    currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
    
    // หยุดกล้องเดิมก่อนเริ่มใหม่
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
    }
    
    // ปรับการสะท้อนของหน้าจอ (ถ้าเป็นกล้องหลังไม่ต้อง Mirror)
    if (currentFacingMode === 'environment') {
        video.style.transform = "scaleX(1)";
        // อย่าลืมปรับ Canvas ด้วยถ้ามีการวาด
    } else {
        video.style.transform = "scaleX(-1)";
    }
    
    startVideo(); // เริ่มกล้องใหม่ด้วย mode ที่เลือก
});

// 3. เริ่มกล้อง
function startVideo() {
    navigator.mediaDevices.getUserMedia({ 
        video: { 
            facingMode: currentFacingMode, // ใช้ตัวแปรนี้ควบคุม
            width: 720, 
            height: 540 
        } 
    })
    .then(stream => {
        video.srcObject = stream;
    })
    .catch(err => {
        console.error("สลับกล้องไม่ได้: ", err);
        alert("ไม่พบกล้องที่ต้องการสลับ");
    });
}

// 4. ระบบประมวลผลหลัก (Loop)
video.addEventListener('play', () => {
    const canvas = faceapi.createCanvasFromMedia(video);
    document.querySelector('.camera-container').append(canvas);
    faceapi.matchDimensions(canvas, displaySize);

    async function onFrame() {
        if (video.paused || video.ended) return;

        // ตรวจจับใบหน้า
        const detections = await faceapi.detectAllFaces(video)
            .withFaceLandmarks()
            .withFaceDescriptors();

        const resizedDetections = faceapi.resizeResults(detections, displaySize);
        const results = resizedDetections.map(d => faceMatcher.findBestMatch(d.descriptor));

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        results.forEach((result, i) => {
            const box = resizedDetections[i].detection.box;
            const label = result.label;
            const confidence = Math.round((1 - result.distance) * 100);

            // วาด UI
            const color = label === 'unknown' ? '#ff4d4d' : '#4ecca3';
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.strokeRect(box.x, box.y, box.width, box.height);

            ctx.fillStyle = color;
            ctx.font = 'bold 16px Arial';
            ctx.fillText(`${label} ${confidence}%`, box.x, box.y - 10);

            // บันทึก Log เมื่อเจอคนรู้จัก
            if (label !== 'unknown' && confidence > 60) {
                saveLog(label);
            }
        });

        // ใช้ RequestAnimationFrame เพื่อแก้ปัญหาเครื่องค้าง/แลค
        requestAnimationFrame(onFrame);
    }
    onFrame();
});

// 5. ระบบบันทึกข้อมูล
let lastUser = "";
let lastTime = 0;
function saveLog(name) {
    const now = Date.now();
    if (name !== lastUser || now - lastTime > 15000) { // เว้นระยะ 15 วินาที
        const entry = { name, time: new Date().toLocaleTimeString('th-TH') };
        attendanceLogs.unshift(entry);
        if (attendanceLogs.length > 20) attendanceLogs.pop();
        localStorage.setItem('logs', JSON.stringify(attendanceLogs));
        renderLogs();
        lastUser = name;
        lastTime = now;
    }
}

function renderLogs() {
    logList.innerHTML = attendanceLogs.map(l => `
        <div class="log-item">
            <strong>${l.name}</strong>
            <span><i class="far fa-clock"></i> บันทึกเมื่อ ${l.time}</span>
        </div>
    `).join('');
}

function clearLogs() {
    attendanceLogs = [];
    localStorage.removeItem('logs');
    renderLogs();
}

init();