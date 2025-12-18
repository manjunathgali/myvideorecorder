const { Room, RoomEvent, VideoPresets, Track } = LivekitClient;

let room;
let mediaRecorder;
let recordedChunks = [];
let audioCtx;

// Helper to create an audio meter
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
        if (meterElement) meterElement.value = average * 1.5; // Scale for visibility
        requestAnimationFrame(update);
    }
    update();
}

async function start() {
    try {
        const identity = "user-" + Math.floor(Math.random() * 1000);
        const response = await fetch(`/api/get-token?room=my-room&identity=${identity}`);
        const { token } = await response.json();

        room = new Room({ adaptiveStream: true, dynacast: true });

        // Handle Remote Video & Audio
        room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
            if (track.kind === Track.Kind.Video) {
                track.attach(document.getElementById('remote-video'));
            }
            if (track.kind === Track.Kind.Audio) {
                const el = track.attach(); // Hidden audio element
                createMeter(new MediaStream([track.mediaStreamTrack]), 'remote-meter');
            }
        });

        await room.connect('wss://my-first-app-mwgdyws7.livekit.cloud', token);

        // Publish & Attach Local
        await room.localParticipant.setCameraEnabled(true, { resolution: VideoPresets.h1080.resolution });
        await room.localParticipant.setMicrophoneEnabled(true);

        const localVideo = room.localParticipant.getTrackPublication(Track.Source.Camera).videoTrack;
        localVideo.attach(document.getElementById('local-video'));

        const localAudio = room.localParticipant.getTrackPublication(Track.Source.Microphone).audioTrack;
        createMeter(new MediaStream([localAudio.mediaStreamTrack]), 'local-meter');
        startNetworkMonitoring();
    } catch (error) {
        alert("Error: " + error.message);
    }
}

// --- Recording Logic ---
const startBtn = document.getElementById('start-btn');
if (startBtn) {
    const stopBtn = document.getElementById('stop-btn');

    startBtn.onclick = async () => {
        const localVid = document.getElementById('local-video');
        const remoteVid = document.getElementById('remote-video');

        // 1. Setup HD Canvas
        const canvas = document.createElement('canvas');
        canvas.width = 1920; canvas.height = 1080;
        const ctx = canvas.getContext('2d', { alpha: false });

        // 2. Setup Audio Mixer
        const dest = audioCtx.createMediaStreamDestination();

        // Local Source
        const localTrack = room.localParticipant.getTrackPublication(Track.Source.Microphone).audioTrack;
        audioCtx.createMediaStreamSource(new MediaStream([localTrack.mediaStreamTrack])).connect(dest);

        // Remote Source
        room.remoteParticipants.forEach(p => {
            p.getTrackPublications().forEach(pub => {
                if (pub.audioTrack?.isSubscribed) {
                    audioCtx.createMediaStreamSource(new MediaStream([pub.audioTrack.mediaStreamTrack])).connect(dest);
                }
            });
        });

        // 3. Combine Video + Mixed Audio
        const combinedStream = new MediaStream([
            ...canvas.captureStream(30).getVideoTracks(),
            ...dest.stream.getAudioTracks()
        ]);

        function drawFrame() {
            if (mediaRecorder?.state !== 'recording') return;
            ctx.fillStyle = "black";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(localVid, 0, 270, 960, 540);
            ctx.drawImage(remoteVid, 960, 270, 960, 540);
            requestAnimationFrame(drawFrame);
        }

        mediaRecorder = new MediaRecorder(combinedStream, {
            mimeType: 'video/webm;codecs=vp9',
            videoBitsPerSecond: 8000000
        });

        mediaRecorder.ondataavailable = (e) => recordedChunks.push(e.data);
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `HD-Meeting-Recording-${Date.now()}.webm`;
            a.click();
            recordedChunks = [];
        };

        mediaRecorder.start(1000);
        drawFrame();
        startBtn.disabled = true;
        stopBtn.disabled = false;
    };

    stopBtn.onclick = () => {
        mediaRecorder.stop();
        startBtn.disabled = false;
        stopBtn.disabled = true;
    };
}


// --- Network Monitoring Logic ---
function startNetworkMonitoring() {
    setInterval(async () => {
        if (!room) return;

        // 1. Get Host (Local) Stats
        const localStats = await room.localParticipant.getStats();
        localStats.forEach(stat => {
            // We look for the outgoing video track
            if (stat.type === 'outbound-rtp' && stat.kind === 'video') {
                const bitrate = (stat.bytesSent * 8) / 1000000; // Convert to Mbps
                document.getElementById('h-bitrate').innerText = bitrate.toFixed(2) + " Mbps";
            }
        });

        // 2. Get Participant (Remote) Stats
        room.remoteParticipants.forEach(async (participant) => {
            const stats = await participant.getStats();
            stats.forEach(stat => {
                // Look for inbound video from the participant
                if (stat.type === 'inbound-rtp' && stat.kind === 'video') {
                    document.getElementById('p-bitrate').innerText = ((stat.bytesReceived * 8) / 1000000).toFixed(2) + " Mbps";
                    document.getElementById('p-jitter').innerText = (stat.jitter * 1000).toFixed(1) + " ms";
                }
                // Look for round-trip-time (Latency)
                if (stat.type === 'remote-outbound-rtp') {
                    document.getElementById('p-latency').innerText = (stat.roundTripTime * 1000).toFixed(0) + " ms";
                    // For the host, latency to server is usually similar
                    document.getElementById('h-latency').innerText = (stat.roundTripTime * 1000).toFixed(0) + " ms";
                }
            });
        });
    }, 1000); // Update every second
}

// Call this at the end of your start() function


start();