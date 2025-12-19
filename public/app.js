const { Room, RoomEvent, Track, VideoPresets } = LivekitClient;

let room;
let mediaRecorder;
let recordedChunks = [];
let audioCtx;
let timerInterval;
let secondsElapsed = 0;

// --- AUDIO CONTEXT ---
function ensureAudioContext() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

// --- AUDIO METER ---
function createMeter(stream, meterId) {
    ensureAudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const meter = document.getElementById(meterId);
    function update() {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        if (meter) meter.value = (sum / dataArray.length) * 1.5;
        requestAnimationFrame(update);
    }
    update();
}

// --- NETWORK MONITORING ---
let lastBytesSent = 0, lastBytesRecv = 0, lastTs = performance.now();

function classifyQuality({ bandwidth, latency, jitter, packetLoss }) {
    if (packetLoss > 2 || latency > 200 || jitter > 30 || bandwidth < 0.3) return { label: "Poor", color: "#ff4444" };
    if (packetLoss > 1 || latency > 100 || jitter > 20 || bandwidth < 1) return { label: "Warning", color: "#ffaa00" };
    return { label: "Good", color: "#00c853" };
}

function startNetworkMonitoring() {
    setInterval(async () => {
        if (!room?.engine?.pcManager) return;

        const now = performance.now();
        const deltaSec = (now - lastTs) / 1000;
        lastTs = now;

        let sent = 0, recv = 0, rttMs = 0, jitterMs = 0, packetsLost = 0, packetsTotal = 0;

        const pubPC = room.engine.pcManager.publisher?.pc;
        if (pubPC) {
            const stats = await pubPC.getStats();
            stats.forEach(stat => {
                if (stat.type === "candidate-pair" && stat.state === "succeeded") {
                    sent += stat.bytesSent || 0;
                    rttMs = (stat.currentRoundTripTime || 0) * 1000;
                }
                if (stat.type === "outbound-rtp" && stat.kind === "video") {
                    packetsTotal += stat.packetsSent || 0;
                    packetsLost += stat.packetsLost || 0;
                }
            });
        }

        const subPC = room.engine.pcManager.subscriber?.pc;
        if (subPC) {
            const stats = await subPC.getStats();
            stats.forEach(stat => {
                if (stat.type === "candidate-pair" && stat.state === "succeeded") recv += stat.bytesReceived || 0;
                if (stat.type === "inbound-rtp" && stat.kind === "video") {
                    jitterMs = (stat.jitter || 0) * 1000;
                    packetsTotal += stat.packetsReceived || 0;
                    packetsLost += stat.packetsLost || 0;
                }
            });
        }

        const hostMbps = ((sent - lastBytesSent) * 8) / (deltaSec * 1_000_000);
        const partMbps = ((recv - lastBytesRecv) * 8) / (deltaSec * 1_000_000);
        lastBytesSent = sent; lastBytesRecv = recv;
        const packetLossPct = packetsTotal > 0 ? (packetsLost / packetsTotal) * 100 : 0;
        const hostQuality = classifyQuality({ bandwidth: hostMbps, latency: rttMs, jitter: jitterMs, packetLoss: packetLossPct });

        document.getElementById("h-bitrate").innerText = hostMbps.toFixed(2) + " Mbps";
        document.getElementById("p-bitrate").innerText = partMbps.toFixed(2) + " Mbps";
        document.getElementById("h-latency").innerText = rttMs.toFixed(0) + " ms";
        document.getElementById("p-latency").innerText = rttMs.toFixed(0) + " ms";
        document.getElementById("h-jitter").innerText = jitterMs.toFixed(1) + " ms";
        document.getElementById("p-jitter").innerText = jitterMs.toFixed(1) + " ms";
        document.getElementById("h-packet-loss").innerText = packetLossPct.toFixed(2) + " %";
        document.getElementById("p-packet-loss").innerText = packetLossPct.toFixed(2) + " %";
        document.getElementById("h-network-quality").innerText = hostQuality.label;
        document.getElementById("h-network-quality").style.color = hostQuality.color;
        document.getElementById("p-network-quality").innerText = hostQuality.label;
        document.getElementById("p-network-quality").style.color = hostQuality.color;
    }, 1000);
}

// --- RECORD TIMER ---
function updateTimer() {
    secondsElapsed++;
    const mins = String(Math.floor(secondsElapsed / 60)).padStart(2, "0");
    const secs = String(secondsElapsed % 60).padStart(2, "0");
    document.getElementById("record-timer").innerText = `REC ${mins}:${secs}`;
}

// --- START HOST ---
async function start() {
    try {
        const identity = "host-" + Math.floor(Math.random() * 1000);
        const res = await fetch(`/api/get-token?room=my-room&identity=${identity}`);
        const { token } = await res.json();

        room = new Room({ adaptiveStream: true, dynacast: true });

        room.on(RoomEvent.TrackSubscribed, track => {
            if (track.kind === Track.Kind.Video) track.attach(document.getElementById("remote-video"));
            if (track.kind === Track.Kind.Audio) createMeter(new MediaStream([track.mediaStreamTrack]), "remote-meter");
        });

        await room.connect("wss://my-first-app-mwgdyws7.livekit.cloud", token);

        await room.localParticipant.setCameraEnabled(true, { resolution: VideoPresets.h1080.resolution, frameRate: 30 });
        await room.localParticipant.setMicrophoneEnabled(true);

        const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        camPub?.videoTrack?.attach(document.getElementById("local-video"));

        const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
        if (micPub?.audioTrack) createMeter(new MediaStream([micPub.audioTrack.mediaStreamTrack]), "local-meter");

        startNetworkMonitoring();
    } catch (err) {
        alert("Setup Error: " + err.message);
    }
}

// --- RECORDING ---
const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");

startBtn.onclick = async () => {
    ensureAudioContext();
    if (audioCtx.state === "suspended") await audioCtx.resume();

    const localVid = document.getElementById("local-video");
    const remoteVid = document.getElementById("remote-video");

    const canvas = document.createElement("canvas");
    canvas.width = 1920; canvas.height = 1080;
    const ctx = canvas.getContext("2d");
    const dest = audioCtx.createMediaStreamDestination();

    const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (micPub?.audioTrack) audioCtx.createMediaStreamSource(new MediaStream([micPub.audioTrack.mediaStreamTrack])).connect(dest);

    room.remoteParticipants.forEach(p => {
        p.getTrackPublications().forEach(pub => {
            if (pub.audioTrack?.isSubscribed) audioCtx.createMediaStreamSource(new MediaStream([pub.audioTrack.mediaStreamTrack])).connect(dest);
        });
    });

    function draw() {
        if (mediaRecorder?.state !== "recording") return;
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(localVid, 0, 270, 960, 540);
        ctx.drawImage(remoteVid, 960, 270, 960, 540);
        requestAnimationFrame(draw);
    }

    const combinedStream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);

    mediaRecorder = new MediaRecorder(combinedStream, { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 8_000_000 });
    mediaRecorder.ondataavailable = e => recordedChunks.push(e.data);

    mediaRecorder.onstop = () => {
        clearInterval(timerInterval);
        secondsElapsed = 0;
        document.getElementById("record-timer").innerText = "00:00";

        const blob = new Blob(recordedChunks, { type: "video/webm" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `Meeting-${Date.now()}.webm`;
        a.click();
        recordedChunks = [];

        startBtn.disabled = false;
        stopBtn.disabled = true;
    };

    mediaRecorder.start(1000);
    draw();
    timerInterval = setInterval(updateTimer, 1000);

    startBtn.disabled = true;
    stopBtn.disabled = false;
};

stopBtn.onclick = () => mediaRecorder.stop();

// --- BOOT ---
start();
