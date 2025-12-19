const { Room, RoomEvent, Track, VideoPresets, TrackPublishDefaults } = LivekitClient;

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

// --- AUDIO METER --- (unchanged)
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

// --- NETWORK MONITORING --- (minor accuracy improvements)
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
        if (deltaSec < 0.5) return; // skip if too soon
        lastTs = now;

        let sent = 0, recv = 0, rttMs = 0, jitterMs = 0, packetsLost = 0, packetsSent = 0, packetsRecv = 0;

        // Publisher (upload)
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
                    packetsLost += stat.packetsLost || 0; // remote lost (nack)
                }
            });
        }

        // Subscriber (download)
        const subPC = room.engine.pcManager.subscriber?.pc;
        if (subPC) {
            const stats = await subPC.getStats();
            stats.forEach(stat => {
                if (stat.type === "candidate-pair" && stat.nominated) recv += stat.bytesReceived || 0;
                if (stat.type === "inbound-rtp" && stat.kind === "video") {
                    jitterMs = (stat.jitter || 0) * 1000;
                    packetsRecv += stat.packetsReceived || 0;
                    packetsLost += stat.packetsLost || 0;
                }
            });
        }

        const uploadMbps = ((sent - lastBytesSent) * 8) / (deltaSec * 1_000_000);
        const downloadMbps = ((recv - lastBytesRecv) * 8) / (deltaSec * 1_000_000);
        lastBytesSent = sent; lastBytesRecv = recv;

        const totalPackets = packetsSent + packetsRecv;
        const packetLossPct = totalPackets > 0 ? (packetsLost / totalPackets) * 100 : 0;

        const quality = classifyQuality({ bandwidth: Math.max(uploadMbps, downloadMbps), latency: rttMs, jitter: jitterMs, packetLoss: packetLossPct });

        // Update UI elements (assuming you have separate upload/download if desired)
        document.getElementById("h-bitrate").innerText = uploadMbps.toFixed(2) + " Mbps ↑";
        document.getElementById("p-bitrate").innerText = downloadMbps.toFixed(2) + " Mbps ↓";
        // ... rest unchanged
    }, 1000);
}

// --- RECORD TIMER --- (unchanged)

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
                videoCodec: "vp9",                  // Best quality codec (SVC enabled automatically)
                backupCodec: { codec: "vp8" },      // Fallback for Safari/etc.
            } as TrackPublishDefaults,
        });

        room.on(RoomEvent.TrackSubscribed, track => {
            if (track.kind === Track.Kind.Video) track.attach(document.getElementById("remote-video"));
            if (track.kind === Track.Kind.Audio) createMeter(new MediaStream([track.mediaStreamTrack]), "remote-meter");
        });

        await room.connect("wss://my-first-app-mwgdyws7.livekit.cloud", token);

        // Higher resolution capture (try 4K, fallback naturally)
        await room.localParticipant.setCameraEnabled(true, {
            resolution: VideoPresets.h2160.resolution,  // or h1440 for less demanding
            frameRate: 30
        });
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

    // Higher canvas for better recorded quality (4K side-by-side)
    const canvas = document.createElement("canvas");
    canvas.width = 3840;   // 1920x2 for true side-by-side 1080p → upgrade to 4K total
    canvas.height = 2160;
    const ctx = canvas.getContext("2d");
    const dest = audioCtx.createMediaStreamDestination();

    // Mix local mic
    const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (micPub?.audioTrack) {
        audioCtx.createMediaStreamSource(new MediaStream([micPub.audioTrack.mediaStreamTrack])).connect(dest);
    }

    // Mix all remote participants' audio (in case multiple)
    room.remoteParticipants.forEach(participant => {
        participant.audioTracks.forEach(pub => {
            if (pub.audioTrack?.isSubscribed) {
                audioCtx.createMediaStreamSource(new MediaStream([pub.audioTrack.mediaStreamTrack])).connect(dest);
            }
        });
    });

    // Listen for new remote audio tracks
    room.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
        if (track.kind === Track.Kind.Audio && participant !== room.localParticipant) {
            audioCtx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack])).connect(dest);
        }
    });

    function draw() {
        if (mediaRecorder?.state !== "recording") return;
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Scale and position for best quality (full height, side-by-side)
        ctx.drawImage(localVid, 0, 0, 1920, 2160);
        ctx.drawImage(remoteVid, 1920, 0, 1920, 2160);

        requestAnimationFrame(draw);
    }

    const combinedStream = new MediaStream([
        ...canvas.captureStream(30).getVideoTracks(),
        ...dest.stream.getAudioTracks()
    ]);

    // Higher bitrate for excellent quality (adjust down if CPU struggles)
    mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: "video/webm;codecs=vp9,opus",
        videoBitsPerSecond: 15_000_000  // 15 Mbps – great for 4K composite
    });

    mediaRecorder.ondataavailable = e => recordedChunks.push(e.data);
    mediaRecorder.onstop = () => {
        // ... unchanged (download logic)
    };

    mediaRecorder.start(1000);
    draw();
    timerInterval = setInterval(updateTimer, 1000);

    startBtn.disabled = true;
    stopBtn.disabled = false;
};

stopBtn.onclick = () => mediaRecorder?.stop();

// --- BOOT ---
start();