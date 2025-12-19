const { Room, RoomEvent, VideoPresets, Track } = LivekitClient;

let room;
let mediaRecorder;
let recordedChunks = [];
let audioCtx;
let timerInterval;
let secondsElapsed = 0;

// --- Network Stats Tracking ---
let prevHostBytes = 0;
let prevPartBytes = 0;

// 1. Audio Meter Logic
function createMeter(stream, meterId) {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const meterElement = document.getElementById(meterId);

    function update() {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
        let average = sum / bufferLength;
        if (meterElement) meterElement.value = average * 1.5;
        requestAnimationFrame(update);
    }
    update();
}

let lastSampleTime = performance.now();
let prevHostBytes = 0;
let prevPartBytes = 0;

function startNetworkMonitoring() {
    setInterval(async () => {
        if (!room) return;

        const now = performance.now();
        const deltaSeconds = (now - lastSampleTime) / 1000;
        lastSampleTime = now;

        // ---------- HOST (Outbound video bitrate) ----------
        let hostBytes = 0;
        let hostJitter = 0;
        let hostRtt = 0;

        const localStats = await room.localParticipant.getStats();
        localStats.forEach(stat => {
            if (stat.type === "outbound-rtp" && stat.kind === "video") {
                hostBytes += stat.bytesSent || 0;
            }
        });

        const hostMbps =
            ((hostBytes - prevHostBytes) * 8) / (deltaSeconds * 1_000_000);

        prevHostBytes = hostBytes;

        document.getElementById("h-bitrate").innerText =
            Math.max(hostMbps, 0).toFixed(2) + " Mbps";

        // ---------- PARTICIPANT (Inbound video bitrate) ----------
        for (const participant of room.remoteParticipants.values()) {
            let partBytes = 0;
            let jitterMs = 0;
            let rttMs = 0;

            const stats = await participant.getStats();
            stats.forEach(stat => {
                if (stat.type === "inbound-rtp" && stat.kind === "video") {
                    partBytes += stat.bytesReceived || 0;
                    jitterMs = (stat.jitter || 0) * 1000;
                    rttMs =
                        ((stat.roundTripTime || stat.currentRoundTripTime) || 0) * 1000;
                }
            });

            const partMbps =
                ((partBytes - prevPartBytes) * 8) / (deltaSeconds * 1_000_000);

            prevPartBytes = partBytes;

            document.getElementById("p-bitrate").innerText =
                Math.max(partMbps, 0).toFixed(2) + " Mbps";

            document.getElementById("p-jitter").innerText =
                jitterMs.toFixed(1) + " ms";

            document.getElementById("p-latency").innerText =
                rttMs.toFixed(0) + " ms";

            document.getElementById("h-latency").innerText =
                rttMs.toFixed(0) + " ms";
        }
    }, 1000);
}


// 3. Recording Timer Logic
function updateTimer() {
    secondsElapsed++;
    const mins = Math.floor(secondsElapsed / 60).toString().padStart(2, '0');
    const secs = (secondsElapsed % 60).toString().padStart(2, '0');
    const timerDisplay = document.getElementById('record-timer');
    if (timerDisplay) timerDisplay.innerText = `REC ${mins}:${secs}`;
}

async function start() {
    try {
        const identity = "host-" + Math.floor(Math.random() * 1000);
        const response = await fetch(`/api/get-token?room=my-room&identity=${identity}`);
        const { token } = await response.json();

        room = new Room({ adaptiveStream: true, dynacast: true });

        room.on(RoomEvent.TrackSubscribed, (track) => {
            if (track.kind === Track.Kind.Video) {
                track.attach(document.getElementById('remote-video'));
            }
            if (track.kind === Track.Kind.Audio) {
                track.attach(document.createElement('audio'));
                createMeter(new MediaStream([track.mediaStreamTrack]), 'remote-meter');
            }
        });

        await room.connect('wss://my-first-app-mwgdyws7.livekit.cloud', token);

        await room.localParticipant.setCameraEnabled(true, { resolution: VideoPresets.h1080.resolution });
        await room.localParticipant.setMicrophoneEnabled(true);

        const localVideo = room.localParticipant.getTrackPublication(Track.Source.Camera).videoTrack;
        localVideo.attach(document.getElementById('local-video'));

        const localAudio = room.localParticipant.getTrackPublication(Track.Source.Microphone).audioTrack;
        createMeter(new MediaStream([localAudio.mediaStreamTrack]), 'local-meter');

        startNetworkMonitoring();
    } catch (error) {
        alert("Setup Error: " + error.message);
    }
}

// --- Recording Execution ---
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');

if (startBtn) {
    startBtn.onclick = async () => {
        const localVid = document.getElementById('local-video');
        const remoteVid = document.getElementById('remote-video');

        const canvas = document.createElement('canvas');
        canvas.width = 1920; canvas.height = 1080;
        const ctx = canvas.getContext('2d', { alpha: false });

        const dest = audioCtx.createMediaStreamDestination();
        const localMic = room.localParticipant.getTrackPublication(Track.Source.Microphone).audioTrack;
        audioCtx.createMediaStreamSource(new MediaStream([localMic.mediaStreamTrack])).connect(dest);

        room.remoteParticipants.forEach(p => {
            p.getTrackPublications().forEach(pub => {
                if (pub.audioTrack?.isSubscribed) {
                    audioCtx.createMediaStreamSource(new MediaStream([pub.audioTrack.mediaStreamTrack])).connect(dest);
                }
            });
        });

        const combinedStream = new MediaStream([
            ...canvas.captureStream(30).getVideoTracks(),
            ...dest.stream.getAudioTracks()
        ]);

        function draw() {
            if (mediaRecorder?.state !== 'recording') return;
            ctx.fillStyle = "black";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(localVid, 0, 270, 960, 540);
            ctx.drawImage(remoteVid, 960, 270, 960, 540);
            requestAnimationFrame(draw);
        }

        mediaRecorder = new MediaRecorder(combinedStream, {
            mimeType: 'video/webm;codecs=vp9',
            videoBitsPerSecond: 8000000
        });

        mediaRecorder.ondataavailable = (e) => recordedChunks.push(e.data);
        mediaRecorder.onstop = () => {
            clearInterval(timerInterval);
            secondsElapsed = 0;
            document.getElementById('record-timer').innerText = "00:00";
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `Meeting-${Date.now()}.webm`;
            a.click();
            recordedChunks = [];
        };

        mediaRecorder.start(1000);
        draw();

        // Start Timer
        timerInterval = setInterval(updateTimer, 1000);

        startBtn.disabled = true;
        stopBtn.disabled = false;
    };

    stopBtn.onclick = () => mediaRecorder.stop();
}

start();