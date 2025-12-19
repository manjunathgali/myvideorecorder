const { Room, RoomEvent, Track, VideoPresets } = LivekitClient;  // Removed TrackPublishDefaults import (not needed in JS)

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

// --- NETWORK MONITORING --- (unchanged, minor fixes already good)

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
                videoCodec: "vp9",                  // Great quality where supported
                backupCodec: { codec: "vp8" },      // Auto-fallback for Safari/other browsers
            },  // <-- Removed "as TrackPublishDefaults"
        });

        room.on(RoomEvent.TrackSubscribed, track => {
            if (track.kind === Track.Kind.Video) track.attach(document.getElementById("remote-video"));
            if (track.kind === Track.Kind.Audio) createMeter(new MediaStream([track.mediaStreamTrack]), "remote-meter");
        });

        await room.connect("wss://my-first-app-mwgdyws7.livekit.cloud", token);

        // Safer resolution - h1440 usually works well; fallback to h1080 if needed
        await room.localParticipant.setCameraEnabled(true, {
            resolution: VideoPresets.h1440.resolution,
            frameRate: 30
        });
        await room.localParticipant.setMicrophoneEnabled(true);

        const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (camPub?.videoTrack) camPub.videoTrack.attach(document.getElementById("local-video"));

        const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
        if (micPub?.audioTrack) createMeter(new MediaStream([micPub.audioTrack.mediaStreamTrack]), "local-meter");

        startNetworkMonitoring();

        if (window.updateStatus) window.updateStatus("Connected ✓");
        console.log("Host connected and camera enabled");
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
    canvas.width = 2560;   // 1440p side-by-side (1280×2)
    canvas.height = 1440;
    const ctx = canvas.getContext("2d");
    const dest = audioCtx.createMediaStreamDestination();

    // Mix local + remote audio
    const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (micPub?.audioTrack) {
        audioCtx.createMediaStreamSource(new MediaStream([micPub.audioTrack.mediaStreamTrack])).connect(dest);
    }

    room.remoteParticipants.forEach(participant => {
        participant.audioTracks.forEach(pub => {
            if (pub.audioTrack?.isSubscribed) {
                audioCtx.createMediaStreamSource(new MediaStream([pub.audioTrack.mediaStreamTrack])).connect(dest);
            }
        });
    });

    // Dynamic new remote audio
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

    // Detect best supported MIME type
    let mimeType = "video/webm";
    if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")) mimeType = "video/webm;codecs=vp9,opus";
    else if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")) mimeType = "video/webm;codecs=vp8,opus";
    else if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) mimeType = "video/webm;codecs=vp9";

    mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: mimeType,
        videoBitsPerSecond: 12_000_000  // Good quality for 1440p composite
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

stopBtn.onclick = () => mediaRecorder?.stop();

// --- BOOT ---
start();