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

/* ================= NETWORK STATS - IMPROVED & MORE ACCURATE ================= */
let lastBytesSent = 0;
let lastBytesRecv = 0;
let lastPacketsLost = 0;
let lastTotalPackets = 0;
let lastTimestamp = performance.now();

function startNetworkMonitoring() {
    setInterval(async () => {
        if (!room?.engine?.pcManager) return;

        const now = performance.now();
        const deltaTime = (now - lastTimestamp) / 1000;
        if (deltaTime < 0.8) return;
        lastTimestamp = now;

        let totalBytesSent = 0;
        let totalBytesReceived = 0;
        let rtt = 0;
        let jitter = 0;
        let packetsLost = 0;
        let totalPackets = 0;

        try {
            // Publisher (upload)
            if (room.engine.pcManager.publisher?.pc) {
                const stats = await room.engine.pcManager.publisher.pc.getStats();
                stats.forEach(report => {
                    if (report.type === 'outbound-rtp' && report.kind === 'video') {
                        totalBytesSent += report.bytesSent || 0;
                        packetsLost += report.packetsLost || 0;
                        totalPackets += report.packetsSent || 0;
                    }
                    if (report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded') {
                        rtt = Math.max(rtt, (report.currentRoundTripTime || 0) * 1000);
                    }
                });
            }

            // Subscriber (download)
            if (room.engine.pcManager.subscriber?.pc) {
                const stats = await room.engine.pcManager.subscriber.pc.getStats();
                stats.forEach(report => {
                    if (report.type === 'inbound-rtp' && report.kind === 'video') {
                        totalBytesReceived += report.bytesReceived || 0;
                        jitter = Math.max(jitter, (report.jitter || 0) * 1000);
                        packetsLost += report.packetsLost || 0;
                        totalPackets += report.packetsReceived || 0;
                    }
                });
            }
        } catch (err) {
            console.warn("Stats fetch error:", err);
            return;
        }

        const uploadMbps = ((totalBytesSent - lastBytesSent) * 8) / (deltaTime * 1_000_000);
        const downloadMbps = ((totalBytesReceived - lastBytesRecv) * 8) / (deltaTime * 1_000_000);

        lastBytesSent = totalBytesSent;
        lastBytesRecv = totalBytesReceived;

        const currentPacketLoss = totalPackets - lastTotalPackets > 0
            ? ((packetsLost - lastPacketsLost) / (totalPackets - lastTotalPackets)) * 100
            : 0;

        lastPacketsLost = packetsLost;
        lastTotalPackets = totalPackets;

        const packetLossPct = currentPacketLoss.toFixed(2);

        // Update UI
        document.getElementById("h-bitrate").innerText = uploadMbps.toFixed(2) + " Mbps ↑";
        document.getElementById("p-bitrate").innerText = downloadMbps.toFixed(2) + " Mbps ↓";
        document.getElementById("h-latency").innerText = rtt.toFixed(0) + " ms";
        document.getElementById("p-latency").innerText = rtt.toFixed(0) + " ms";
        document.getElementById("h-jitter").innerText = "—";  // Outbound jitter not available
        document.getElementById("p-jitter").innerText = jitter.toFixed(1) + " ms";
        document.getElementById("h-packet-loss").innerText = packetLossPct + " %";
        document.getElementById("p-packet-loss").innerText = packetLossPct + " %";

        // ================= REALISTIC 5-TIER QUALITY CLASSIFICATION =================
        let quality = "Excellent";
        let qualityColor = "#4caf50";  // Rich green for Excellent

        if (uploadMbps >= 4 && downloadMbps >= 3 && rtt < 50 && jitter < 10 && parseFloat(packetLossPct) < 0.5) {
            quality = "Excellent";
            qualityColor = "#4caf50";
        }
        else if (uploadMbps >= 2 && downloadMbps >= 1 && rtt < 100 && jitter < 25 && parseFloat(packetLossPct) < 1) {
            quality = "Good";
            qualityColor = "#00c853";  // Bright green
        }
        else if (uploadMbps >= 1 && downloadMbps >= 0.5 && rtt < 200 && jitter < 40 && parseFloat(packetLossPct) < 3) {
            quality = "Fair";
            qualityColor = "#ffaa00";  // Orange
        }
        else if (uploadMbps >= 0.5 && downloadMbps >= 0.2 && rtt < 300 && jitter < 80 && parseFloat(packetLossPct) < 8) {
            quality = "Poor";
            qualityColor = "#ff4444";  // Red
        }
        else {
            quality = "Bad";
            qualityColor = "#d32f2f";  // Dark red
        }

        document.getElementById("h-network-quality").innerText = quality;
        document.getElementById("p-network-quality").innerText = quality;
        document.getElementById("h-network-quality").style.color = qualityColor;
        document.getElementById("p-network-quality").style.color = qualityColor;
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
                videoCodec: "vp9",
                backupCodec: { codec: "vp8" }
            }
        });

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
        console.log("Host connected – network monitoring active");
    } catch (err) {
        console.error("Setup error:", err);
        alert("Setup Error: " + err.message);
        if (window.updateStatus) window.updateStatus("Error: " + err.message);
    }
}

/* ================= RECORDING (UNCHANGED - STILL WORKING) ================= */
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

    const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (micPub?.audioTrack) {
        audioCtx.createMediaStreamSource(
            new MediaStream([micPub.audioTrack.mediaStreamTrack])
        ).connect(dest);
    }

    room.remoteParticipants.forEach(participant => {
        participant.getTrackPublications().forEach(pub => {
            if (pub.kind === Track.Kind.Audio && pub.audioTrack?.isSubscribed) {
                audioCtx.createMediaStreamSource(
                    new MediaStream([pub.audioTrack.mediaStreamTrack])
                ).connect(dest);
            }
        });
    });

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

    let mimeType = "video/webm";
    if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")) {
        mimeType = "video/webm;codecs=vp9,opus";
    } else if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) {
        mimeType = "video/webm;codecs=vp8";
    }

    mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: mimeType,
        videoBitsPerSecond: 12_000_000
    });

    recordedChunks = [];
    mediaRecorder.ondataavailable = e => recordedChunks.push(e.data);

    mediaRecorder.onstop = () => {
        room.off(RoomEvent.TrackSubscribed, audioListener);

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