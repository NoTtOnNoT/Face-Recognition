// 1. Firebase Configuration & Initialization
const firebaseConfig = {
    apiKey: "AIzaSyDtIQFbkkS_9Va7N972fhZ-pQN9zN2i4uc",
    authDomain: "projectm5-69d17.firebaseapp.com",
    databaseURL: "https://projectm5-69d17-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "projectm5-69d17",
    storageBucket: "projectm5-69d17.firebasestorage.app",
    messagingSenderId: "480347312274",
    appId: "1:480347312274:web:20b70500dbf52f4f4d164b"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const video = document.getElementById("video");
const statusBadge = document.getElementById("status");

let faceMatcher = null;
let currentFacingMode = "user";
let lastUser = "";
let lastTime = 0;

/**
 * 2. System Initialization
 */
async function init() {
    try {
        statusBadge.innerText = "Loading AI Models...";
        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri('./models'),
            faceapi.nets.faceLandmark68Net.loadFromUri('./models'),
            faceapi.nets.faceRecognitionNet.loadFromUri('./models'),
        ]);

        statusBadge.innerText = "Connecting DB...";
        const labeledDescriptors = await loadDescriptorsFromJSON();
        faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.6);

        statusBadge.innerText = "System Live";
        statusBadge.classList.add("status-online");

        startVideo();
        listenToFirebase(); // ฟังข้อมูลจาก Firebase ครั้งเดียวที่นี่
    } catch (err) {
        console.error("Critical Error:", err);
        statusBadge.innerText = "System Error";
    }
}

async function loadDescriptorsFromJSON() {
    const response = await fetch("./descriptors.json");
    if (!response.ok) throw new Error("File not found: descriptors.json");
    const data = await response.json();

    return data.map((item) => {
        const float32Descriptors = item.descriptors.map((d) => new Float32Array(d));
        return new faceapi.LabeledFaceDescriptors(item.label, float32Descriptors);
    });
}

/**
 * 3. Camera Management
 */
function startVideo() {
    navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: currentFacingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 },
        }
    })
    .then((stream) => { video.srcObject = stream; })
    .catch((err) => {
        console.error("Camera Error: ", err);
        statusBadge.innerText = "Camera Error";
    });
}

// Flip Camera Logic
const flipBtn = document.getElementById("flipBtn");
if (flipBtn) {
    flipBtn.addEventListener("click", () => {
        currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
        if (video.srcObject) {
            video.srcObject.getTracks().forEach((track) => track.stop());
        }
        video.style.transform = currentFacingMode === "user" ? "scaleX(-1)" : "scaleX(1)";
        startVideo();
    });
}

/**
 * 4. Real-time Face Recognition
 */
video.addEventListener("play", () => {
    const container = document.querySelector(".camera-container");
    const existingCanvases = container.querySelectorAll("canvas");
    existingCanvases.forEach((c) => c.remove());

    const canvas = faceapi.createCanvasFromMedia(video);
    container.append(canvas);

    const setDisplaySize = () => {
        const displaySize = { width: video.offsetWidth, height: video.offsetHeight };
        faceapi.matchDimensions(canvas, displaySize);
        return displaySize;
    };

    let displaySize = setDisplaySize();
    window.addEventListener("resize", () => (displaySize = setDisplaySize()));

    async function onFrame() {
        if (video.paused || video.ended || !video.srcObject) return;

        const detections = await faceapi.detectAllFaces(video).withFaceLandmarks().withFaceDescriptors();
        const resizedDetections = faceapi.resizeResults(detections, displaySize);
        const results = resizedDetections.map((d) => faceMatcher.findBestMatch(d.descriptor));

        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        results.forEach((result, i) => {
            const box = resizedDetections[i].detection.box;
            const label = result.label;
            const confidence = Math.round((1 - result.distance) * 100);
            const color = label === "unknown" ? "#ff4d4d" : "#4ecca3";

            // Draw Detection Box
            ctx.save();
            if (currentFacingMode === "user") {
                ctx.translate(canvas.width, 0); ctx.scale(-1, 1);
                ctx.strokeStyle = color; ctx.lineWidth = 3;
                ctx.strokeRect(box.x, box.y, box.width, box.height);
            } else {
                ctx.strokeStyle = color; ctx.lineWidth = 3;
                ctx.strokeRect(box.x, box.y, box.width, box.height);
            }
            ctx.restore();

            // Draw Label
            ctx.fillStyle = color;
            ctx.font = "bold 16px Inter";
            let textX = currentFacingMode === "user" ? canvas.width - box.x - box.width : box.x;
            ctx.fillText(`${label} (${confidence}%)`, textX, box.y - 10);

            if (label !== "unknown" && confidence > 60) {
                saveLogToFirebase(label);
            }
        });
        requestAnimationFrame(onFrame);
    }
    onFrame();
});

/**
 * 5. Firebase Data & UI
 */
function saveLogToFirebase(name) {
    const now = Date.now();
    // ป้องกันการบันทึกซ้ำภายใน 15 วินาที
    if (name !== lastUser || now - lastTime > 15000) {
        const captureCanvas = document.createElement("canvas");
        captureCanvas.width = video.videoWidth;
        captureCanvas.height = video.videoHeight;
        const ctx = captureCanvas.getContext("2d");
        
        if (currentFacingMode === "user") {
            ctx.translate(captureCanvas.width, 0); ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
        const imageData = captureCanvas.toDataURL("image/jpeg", 0.4);

        const logData = {
            name: name,
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            timeDisplay: new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }),
            image: imageData
        };

        db.ref('attendance').push(logData).then(() => {
            showScanNotification(name);
        }).catch(err => console.error("Firebase Push Error:", err));

        lastUser = name;
        lastTime = now;
    }
}

function listenToFirebase() {
    // ดึง 20 รายการล่าสุดและอัปเดตแบบ Real-time
    db.ref('attendance').limitToLast(20).on('value', (snapshot) => {
        const data = snapshot.val();
        const logs = [];
        for (let id in data) { logs.unshift(data[id]); }
        renderLogs(logs);
    });
}

function renderLogs(logs = []) {
    const logHTML = logs.length > 0 ? logs.map(l => `
        <div class="log-item" style="display: flex; align-items: center; gap: 12px; background: rgba(255,255,255,0.05); padding: 10px; border-radius: 12px; margin-bottom: 8px; border: 1px solid var(--glass-border);">
            <div style="display: flex; flex-direction: column;">
                <strong style="color: var(--primary); font-size: 14px;">${l.name}</strong>
                <span style="font-size: 11px; color: var(--text-dim);"><i class="far fa-clock"></i> ${l.timeDisplay}</span>
            </div>
        </div>
    `).join('') : '<p style="text-align:center; color:var(--text-dim); padding: 20px;">No history found</p>';

    ['logListDesktop', 'logListMobile'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = logHTML;
    });
}

function showScanNotification(name) {
    const notice = document.getElementById("scanNotice");
    const text = document.getElementById("noticeText");
    if (!notice || !text) return;
    text.innerText = `เช็คอินสำเร็จ: ${name}`;
    notice.classList.add("show");
    setTimeout(() => notice.classList.remove("show"), 3000);
}

function toggleMobileLog() {
    const modal = document.getElementById("mobileLogModal");
    if (modal) modal.style.display = modal.style.display === "block" ? "none" : "block";
}

function clearLogs() {
    if (confirm("ต้องการล้างประวัติทั้งหมดจาก Cloud ใช่หรือไม่?")) {
        db.ref('attendance').remove().then(() => {
            alert("Database Cleared");
            lastUser = "";
        });
    }
}

// Global click to close modal
window.onclick = (e) => {
    const modal = document.getElementById("mobileLogModal");
    if (e.target === modal) modal.style.display = "none";
};

// Start the engine
init();