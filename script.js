const video = document.getElementById("video");
const statusBadge = document.getElementById("status");

// ตัวแปร Global
let faceMatcher = null;
let attendanceLogs = JSON.parse(localStorage.getItem("logs")) || [];
let currentFacingMode = "user";

/**
 * 1. ฟังก์ชันเริ่มต้นระบบ (โหลดโมเดล และ โหลดข้อมูลใบหน้าจาก JSON)
 */
async function init() {
  try {
    statusBadge.innerText = "Loading Models...";

    // โหลดโมเดล AI (SSD Mobilenet แม่นยำที่สุด)
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri("/models"),
      faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
    ]);

    console.log("AI Models Loaded");
    statusBadge.innerText = "Loading Database...";

    const labeledDescriptors = await loadDescriptorsFromJSON();
    
    // ระยะห่าง 0.6 คือค่ามาตรฐาน (น้อยกว่านี้จะเข้มงวดขึ้น)
    faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.6);

    statusBadge.innerText = "System Live";
    statusBadge.classList.add("status-online");

    renderLogs();
    startVideo();
  } catch (err) {
    console.error("Critical Error:", err);
    statusBadge.innerText = "System Error";
  }
}

/**
 * 2. ฟังก์ชันโหลด Descriptors
 */
async function loadDescriptorsFromJSON() {
  const response = await fetch("./descriptors.json");
  if (!response.ok) throw new Error("ไม่พบไฟล์ descriptors.json");
  const data = await response.json();

  return data.map((item) => {
    const float32Descriptors = item.descriptors.map((d) => new Float32Array(d));
    return new faceapi.LabeledFaceDescriptors(item.label, float32Descriptors);
  });
}

/**
 * 3. ระบบจัดการกล้อง
 */
function startVideo() {
  navigator.mediaDevices
    .getUserMedia({
      video: {
        facingMode: currentFacingMode,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
    })
    .then((stream) => {
      video.srcObject = stream;
    })
    .catch((err) => {
      console.error("Camera Error: ", err);
      statusBadge.innerText = "Camera Error";
    });
}

// สลับกล้อง
const flipBtn = document.getElementById("flipBtn");
if (flipBtn) {
  flipBtn.addEventListener("click", () => {
    currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
    if (video.srcObject) {
      video.srcObject.getTracks().forEach((track) => track.stop());
    }
    
    // จัดการ Mirroring ผ่าน CSS ตามโหมดกล้อง
    if (currentFacingMode === "user") {
        video.style.transform = "scaleX(-1)";
    } else {
        video.style.transform = "scaleX(1)";
    }
    
    startVideo();
  });
}

/**
 * 4. ระบบตรวจจับใบหน้าแบบ Real-time (ปรับปรุงการคำนวณขนาด)
 */
video.addEventListener('play', () => {
    const container = document.querySelector('.camera-container');
    
    // ล้าง Canvas เก่า
    const existingCanvases = container.querySelectorAll('canvas');
    existingCanvases.forEach(c => c.remove());

    const canvas = faceapi.createCanvasFromMedia(video);
    container.append(canvas);

    // ฟังก์ชันคำนวณขนาดที่แสดงผลจริง (Responsive)
    const setDisplaySize = () => {
        const displaySize = { 
            width: video.offsetWidth, 
            height: video.offsetHeight 
        };
        faceapi.matchDimensions(canvas, displaySize);
        return displaySize;
    };

    let displaySize = setDisplaySize();
    window.addEventListener('resize', () => displaySize = setDisplaySize());

  async function onFrame() {
    if (video.paused || video.ended || !video.srcObject) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const detections = await faceapi
      .detectAllFaces(video)
      .withFaceLandmarks()
      .withFaceDescriptors();

    const resizedDetections = faceapi.resizeResults(detections, displaySize);
    const results = resizedDetections.map((d) => faceMatcher.findBestMatch(d.descriptor));

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ปรับการสะท้อนของ Canvas ให้ตรงกับวิดีโอ
    ctx.save();
    if (currentFacingMode === "user") {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
    }

    results.forEach((result, i) => {
      const box = resizedDetections[i].detection.box;
      const label = result.label;
      const confidence = Math.round((1 - result.distance) * 100);
      const color = label === "unknown" ? "#ff4d4d" : "#4ecca3";

      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.strokeRect(box.x, box.y, box.width, box.height);

      // วาดตัวหนังสือ (ต้องวาดแบบไม่ Mirror เพื่อให้อ่านออก)
      ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform ชั่วคราว
      
      let textX = box.x;
      let textY = box.y - 10;
      
      // ถ้าเป็นกล้องหน้า ต้องคำนวณพิกัดตัวอักษรใหม่เพราะเรา Reset transform
      if (currentFacingMode === "user") {
          textX = canvas.width - box.x - box.width;
      }

      ctx.fillStyle = color;
      ctx.font = "bold 16px Inter";
      ctx.fillText(`${label} (${confidence}%)`, textX, textY);
      
      // กลับไปใช้ Mirror สำหรับวาดกรอบถัดไป (ถ้ามี)
      if (currentFacingMode === "user") {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }

      if (label !== "unknown" && confidence > 60) {
        saveLog(label);
      }
    });
    
    ctx.restore();
    requestAnimationFrame(onFrame);
  }
  onFrame();
});

/**
 * 5. ระบบบันทึกข้อมูลและ UI
 */
let lastUser = "";
let lastTime = 0;

function showScanNotification(name) {
    const notice = document.getElementById('scanNotice');
    const text = document.getElementById('noticeText');
    
    text.innerText = `เช็คอินสำเร็จ: ${name}`;
    notice.classList.add('show');

    // ให้หายไปเองหลังจากผ่านไป 3 วินาที
    setTimeout(() => {
        notice.classList.remove('show');
    }, 3000);
}

function saveLog(name) {
    const now = Date.now();
    // ป้องกันการบันทึกซ้ำ (15 วินาที)
    if (name !== lastUser || now - lastTime > 15000) {
        const entry = { name, time: new Date().toLocaleTimeString("th-TH") };
        attendanceLogs.unshift(entry);
        
        if (attendanceLogs.length > 20) attendanceLogs.pop();
        localStorage.setItem("logs", JSON.stringify(attendanceLogs));
        renderLogs();

        // --- เพิ่มบรรทัดนี้เพื่อแสดงแจ้งเตือนบนหน้าจอ ---
        showScanNotification(name); 
        // ----------------------------------------

        lastUser = name;
        lastTime = now;
    }
}

function toggleMobileLog() {
    const modal = document.getElementById('mobileLogModal');
    if (modal.style.display === "block") {
        modal.style.display = "none";
    } else {
        modal.style.display = "block";
        renderLogs(); // อัปเดตข้อมูลล่าสุดตอนเปิด
    }
}

function renderLogs() {
    const logHTML = attendanceLogs.length > 0 
        ? attendanceLogs.map(l => `
            <div class="log-item">
                <strong>${l.name}</strong>
                <span><i class="far fa-clock"></i> ${l.time}</span>
            </div>
        `).join('')
        : '<p style="text-align:center; color:#888; padding:20px;">ยังไม่มีประวัติการสแกน</p>';

    // วาดลงหน้า Desktop (ถ้ามี)
    const deskLog = document.getElementById('logListDesktop');
    if (deskLog) deskLog.innerHTML = logHTML;

    // วาดลงหน้า Mobile Pop-up
    const mobLog = document.getElementById('logListMobile');
    if (mobLog) mobLog.innerHTML = logHTML;
}

window.onclick = function(event) {
    const modal = document.getElementById('mobileLogModal');
    if (event.target == modal) {
        modal.style.display = "none";
    }
}

function clearLogs() {
  if (confirm("ต้องการลบประวัติทั้งหมดใช่หรือไม่?")) {
    attendanceLogs = [];
    localStorage.removeItem("logs");
    renderLogs();
    lastUser = "";
  }
}

init();