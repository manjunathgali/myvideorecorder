const { Room, RoomEvent, Track, VideoPresets } = LivekitClient;

let room;
let mediaRecorder;
let recordedChunks = [];
let audioCtx;
let timerInterval;
let secondsElapsed = 0;

/* ================= AUDIO CONTEXT ================= */
function ensureAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

/* ================= AUDIO METER ================= */
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

/* ================= NETWORK STATS ================= */
let lastBytesSent = 0;
let lastBytesRecv = 0;
let lastTs = performance.now();

function startNetworkMonitoring() {
    setInterval(async () => {
        if (!room?.engine?.pcManager) return;

        const now = performance.now();
        const deltaSec = (now - lastTs) / 1000;
        if (deltaSec < 0.5) return; // Avoid too frequent updates
        lastTs = now;

        let bytesSent = 0;
        let bytesRecv = 0;
        let rttMs = 0;
        let jitterMs = 0;

        try {
            const statsMap = await room.engine.pcManager.getStats();
            if (!statsMap) return;

            statsMap.forEach(stat => {
                if (stat.type === "candidate-pair" && stat.nominated && stat.state === "succeeded") {
                    bytesSent = Math.max(bytesSent, stat.bytesSent || 0);
                    bytesRecv = Math.max(bytesRecv, stat.bytesReceived || 0);
                    rttMs = (stat.currentRoundTripTime || 0) * 1000;
                }
                if (stat.type === "inbound-rtp" && stat.kind === "video") {
                    jitterMs = (stat.jitter || 0) * 1000;
                }
            });
        } catch (e) {
            console.warn("Stats error:", e);
        }

        const uploadMbps = ((bytesSent - lastBytesSent) * 8) / (deltaSec * 1_000_000);
        const downloadMbps = ((bytesRecv - lastBytesRecv) * 8) / (deltaSec * 1_000_000);

        lastBytesSent = bytesSent;
        lastBytesRecv = bytesRecv;

        document.getElementById("h-bitrate").innerText = Math.max(uploadMbps, 0).toFixed(2) + " Mbps ↑";
        document.getElementById("p-bitrate").innerText = Math.max(downloadMbps, 0).toFixed(2) + " Mbps ↓";
        document.getElementById("h-latency").innerText = rttMs.toFixed(0) + " ms";
        document.getElementById("p-latency").innerText = rttMs.toFixed(0) + " ms";
        document.getElementById("p-jitter").innerText = jitterMs.toFixed(1) + " ms";
    }, 1000);
}

/* ================= RECORD TIMER ================= */
function updateTimer() {
    secondsElapsed++;
    const mins = String(Math.floor(secondsElapsed / 60)).padStart(2, "0");
    const secs = String(secondsElapsed % 60).padStart(2, "0");
    document.getElementById("record-timer").innerText = `REC ${mins}:${secs}`;
}

/* ================= START HOST ================= */
async function start() {
    try {
        const identity = "host-" + Math.floor(Math.random() * 1000);
        const res = await fetch(`/api/get-token?room=my-room&identity=${identity}`);
        const { token } = await res.json();

        room = new Room({
            adaptiveStream: true,
            dynacast: true,
            publishDefaults: {
                videoCodec: "vp9",           // Better quality & efficiency
                backupCodec: { codec: "vp8" } // Safari fallback
            }
        });

        // Display remote video + audio meter
        room.on(RoomEvent.TrackSubscribed, track => {
            if (track.kind === Track.Kind.Video) {
                track.attach(document.getElementById("remote-video"));
            }
            if (track.kind === Track.Kind.Audio) {
                createMeter(new MediaStream([track.mediaStreamTrack]), "remote-meter");
            }
        });

        await room.connect("wss://my-first-app-mwgdyws7.livekit.cloud", token);

        // High quality camera (h1440 if supported, falls back gracefully)
        await room.localParticipant.setCameraEnabled(true, {
            resolution: VideoPresets.h1440.resolution,
            frameRate: 30
        });
        await room.localParticipant.setMicrophoneEnabled(true);

        // Attach local video
        const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (camPub?.videoTrack) {
            camPub.videoTrack.attach(document.getElementById("local-video"));
        }

        // Local mic meter
        const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
        if (micPub?.audioTrack) {
            createMeter(new MediaStream([micPub.audioTrack.mediaStreamTrack]), "local-meter");
        }

        startNetworkMonitoring();

        if (window.updateStatus) window.updateStatus("Connected ✓");
        console.log("Host connected – high-quality VP9 enabled");
    } catch (err) {
        console.error("Setup error:", err);
        alert("Setup Error: " + err.message);
        if (window.updateStatus) window.updateStatus("Error: " + err.message);
    }
}

/* ================= RECORDING ================= */
const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");

startBtn.onclick = async () => {
    ensureAudioContext();
    if (audioCtx.state === "suspended") await audioCtx.resume();

    const localVid = document.getElementById("local-video");
    const remoteVid = document.getElementById("remote-video");

    // Higher resolution composite (1440p side-by-side)
    const canvas = document.createElement("canvas");
    canvas.width = 2560;
    canvas.height = 1440;
    const ctx = canvas.getContext("2d");

    const dest = audioCtx.createMediaStreamDestination();

    // Host microphone
    const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (micPub?.audioTrack) {
        audioCtx.createMediaStreamSource(
            new MediaStream([micPub.audioTrack.mediaStreamTrack])
        ).connect(dest);
    }

    // Current remote participants' audio — using your working pattern
    room.remoteParticipants.forEach(participant => {
        participant.getTrackPublications().forEach(pub => {
            if (pub.kind === Track.Kind.Audio && pub.audioTrack?.isSubscribed) {
                audioCtx.createMediaStreamSource(
                    new MediaStream([pub.audioTrack.mediaStreamTrack])
                ).connect(dest);
            }
        });
    });

    // Future audio tracks (e.g., late joiners during recording)
    const audioListener = (track, publication, participant) => {
        if (track.kind === Track.Kind.Audio && participant !== room.localParticipant) {
            audioCtx.createMediaStreamSource(
                new MediaStream([track.mediaStreamTrack])
            ).connect(dest);
        }
    };
    room.on(RoomEvent.TrackSubscribed, audioListener);

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

    // Prefer VP9 for recording
    let mimeType = "video/webm";
    if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")) {
        mimeType = "video/webm;codecs=vp9,opus";
    } else if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) {
        mimeType = "video/webm;codecs=vp8";
    }

    mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: mimeType,
        videoBitsPerSecond: 12_000_000  // Higher quality recording
    });

    recordedChunks = [];
    mediaRecorder.ondataavailable = e => recordedChunks.push(e.data);

    mediaRecorder.onstop = () => {
        room.off(RoomEvent.TrackSubscribed, audioListener); // Clean up listener

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

/* ================= BOOT ================= */
start();