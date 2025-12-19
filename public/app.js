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
let lastBytesSent = 0;
let lastBytesRecv = 0;
let lastTs = performance.now();

function classifyQuality({ bandwidth, latency, jitter, packetLoss }) {
    if (packetLoss > 2 || latency > 200 || jitter > 30 || bandwidth < 0.3) {
        return { label: "Poor", color: "#ff4444" };
    }
    if (packetLoss > 1 || latency > 100 || jitter > 20 || bandwidth < 1) {
        return { label: "Warning", color: "#ffaa00" };
    }
    return { label: "Good", color: "#00c853" };
}

function startNetworkMonitoring() {
    setInterval(async () => {
        if (!room?.engine?.pcManager) return;

        const now = performance.now();
        const deltaSec = (now - lastTs) / 1000;
        if (deltaSec < 0.5) return;
        lastTs = now;

        let sent = 0, recv = 0, rttMs = 0, jitterMs = 0;
        let packetsLost = 0, packetsSent = 0, packetsRecv = 0;

        const pubPC = room.engine.pcManager.publisher?.pc;
        if (pubPC) {
            const stats = await pubPC.getStats();
            stats.forEach(stat => {
                if (stat.type === "candidate-pair" && stat.nominated) {
                    sent += stat.bytesSent || 0;
                    rttMs = (stat.currentRoundTripTime || 0) * 1000;
                }
                if (stat.type === "outbound-rtp" && stat.kind === "video") {
                    packetsSent += stat.packetsSent || 0;
                    packetsLost += stat.packetsLost || 0;
                }
            });
        }

        const subPC = room.engine.pcManager.subscriber?.pc;
        if (subPC) {
            const stats = await subPC.getStats();
            stats.forEach(stat => {
                if (stat.type === "candidate-pair" && stat.nominated) {
                    recv += stat.bytesReceived || 0;
                }
                if (stat.type === "inbound-rtp" && stat.kind === "video") {
                    jitterMs = (stat.jitter || 0) * 1000;
                    packetsRecv += stat.packetsReceived || 0;
                    packetsLost += stat.packetsLost || 0;
                }
            });
        }

        const uploadMbps = ((sent - lastBytesSent) * 8) / (deltaSec * 1_000_000);
        const downloadMbps = ((recv - lastBytesRecv) * 8) / (deltaSec * 1_000_000);
        lastBytesSent = sent;
        lastBytesRecv = recv;

        const totalPackets = packetsSent + packetsRecv;
        const packetLossPct = totalPackets > 0 ? (packetsLost / totalPackets) * 100 : 0;

        const quality = classifyQuality({
            bandwidth: Math.max(uploadMbps, downloadMbps),
            latency: rttMs,
            jitter: jitterMs,
            packetLoss: packetLossPct
        });

        document.getElementById("h-bitrate").innerText = uploadMbps.toFixed(2) + " Mbps ↑";
        document.getElementById("p-bitrate").innerText = downloadMbps.toFixed(2) + " Mbps ↓";
        document.getElementById("h-latency").innerText = rttMs.toFixed(0) + " ms";
        document.getElementById("p-latency").innerText = rttMs.toFixed(0) + " ms";
        document.getElementById("h-jitter").innerText = jitterMs.toFixed(1) + " ms";
        document.getElementById("p-jitter").innerText = jitterMs.toFixed(1) + " ms";
        document.getElementById("h-packet-loss").innerText = packetLossPct.toFixed(2) + " %";
        document.getElementById("p-packet-loss").innerText = packetLossPct.toFixed(2) + " %";
        document.getElementById("h-network-quality").innerText = quality.label;
        document.getElementById("h-network-quality").style.color = quality.color;
        document.getElementById("p-network-quality").innerText = quality.label;
        document.getElementById("p-network-quality").style.color = quality.color;
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

        room = new Room({
            adaptiveStream: true,
            dynacast: true,
            publishDefaults: {
                videoCodec: "vp9",
                backupCodec: { codec: "vp8" },
            },
        });

        // Subscribe to remote (participant) tracks — ONLY HERE
        room.on(RoomEvent.TrackSubscribed, track => {
            if (track.kind === Track.Kind.Video) {
                track.attach(document.getElementById("remote-video"));
            }
            if (track.kind === Track.Kind.Audio) {
                createMeter(new MediaStream([track.mediaStreamTrack]), "remote-meter");
            }
        });

        await room.connect("wss://my-first-app-mwgdyws7.livekit.cloud", token);

        await room.localParticipant.setCameraEnabled(true, {
            resolution: VideoPresets.h1440.resolution,
            frameRate: 30
        });
        await room.localParticipant.setMicrophoneEnabled(true);

        const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (camPub?.videoTrack) {
            camPub.videoTrack.attach(document.getElementById("local-video"));
        }

        const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
        if (micPub?.audioTrack) {
            createMeter(new MediaStream([micPub.audioTrack.mediaStreamTrack]), "local-meter");
        }

        startNetworkMonitoring();

        if (window.updateStatus) window.updateStatus("Connected ✓");
        console.log("Host connected successfully");
    } catch (err) {
        console.error("Setup error:", err);
        alert("Setup Error: " + err.message);
        if (window.updateStatus) window.updateStatus("Error: " + err.message);
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
    canvas.width = 2560;
    canvas.height = 1440;
    const ctx = canvas.getContext("2d");
    const dest = audioCtx.createMediaStreamDestination();

    // Local mic
    const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (micPub?.audioTrack) {
        audioCtx.createMediaStreamSource(new MediaStream([micPub.audioTrack.mediaStreamTrack])).connect(dest);
    }

    // Current remote audio
    room.remoteParticipants.forEach(participant => {
        participant.audioTracks.forEach(pub => {
            if (pub.audioTrack?.isSubscribed) {
                audioCtx.createMediaStreamSource(new MediaStream([pub.audioTrack.mediaStreamTrack])).connect(dest);
            }
        });
    });

    // Future remote audio tracks (new participants or re-subscribes)
    room.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
        if (track.kind === Track.Kind.Audio && participant !== room.localParticipant) {
            audioCtx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack])).connect(dest);
        }
    });

    function draw() {
        if (mediaRecorder?.state !== "recording") return;
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(localVid, 0, 0, 1280, 1440);
        ctx.drawImage(remoteVid, 1280, 0, 1280, 1440);
        requestAnimationFrame(draw);
    }

    const combinedStream = new MediaStream([
        ...canvas.captureStream(30).getVideoTracks(),
        ...dest.stream.getAudioTracks()
    ]);

    let mimeType = "video/webm";
    if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")) mimeType = "video/webm;codecs=vp9,opus";
    else if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")) mimeType = "video/webm;codecs=vp8,opus";
    else if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) mimeType = "video/webm;codecs=vp9";

    mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: mimeType,
        videoBitsPerSecond: 12_000_000
    });

    recordedChunks = [];
    mediaRecorder.ondataavailable = e => recordedChunks.push(e.data);

    mediaRecorder.onstop = () => {
        clearInterval(timerInterval);
        secondsElapsed = 0;
        document.getElementById("record-timer").innerText = "00:00";

        const blob = new Blob(recordedChunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Meeting-${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);

        startBtn.disabled = false;
        stopBtn.disabled = true;
    };

    mediaRecorder.start(1000);
    draw();
    timerInterval = setInterval(updateTimer, 1000);

    startBtn.disabled = true;
    stopBtn.disabled = false;
};

stopBtn.onclick = () => {
    if (mediaRecorder) mediaRecorder.stop();
};

// --- BOOT ---
start();