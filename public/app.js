const { Room, RoomEvent } = LivekitClient;

let room;
let mediaRecorder;
let recordedChunks = [];

async function start() {
    // 1. Get token from your Node.js server
    // Note: Use a random identity so the two users don't kick each other out
    const identity = "user-" + Math.floor(Math.random() * 1000);
    const response = await fetch(`/api/get-token?room=my-room&identity=${identity}`);
    const { token } = await response.json();

    room = new Room();

    // 2. Handle Remote Video (The other person)
    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === 'video') {
            const remoteEl = document.getElementById('remote-video');
            track.attach(remoteEl);
        }
    });

    // 3. Connect to LiveKit
    // REPLACE WITH YOUR ACTUAL LIVEKIT URL (from your dashboard)
    await room.connect('wss://my-first-app-mwgdyws7.livekit.cloud', token);

    // 4. Publish Local Camera
    await room.localParticipant.setCameraEnabled(true);
    await room.localParticipant.setMicrophoneEnabled(true);

    // 5. Attach Local Video to tile
    const localTrack = Array.from(room.localParticipant.videoTracks.values())[0].track;
    localTrack.attach(document.getElementById('local-video'));
}

// --- Recording Code (Only runs on host.html) ---
const startBtn = document.getElementById('start-btn');
if (startBtn) {
    const stopBtn = document.getElementById('stop-btn');

    startBtn.onclick = () => {
        const localVid = document.getElementById('local-video');
        const remoteVid = document.getElementById('remote-video');

        const canvas = document.createElement('canvas');
        canvas.width = 800; canvas.height = 400; // Side-by-side layout
        const ctx = canvas.getContext('2d');

        function drawFrame() {
            ctx.fillStyle = "black";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(localVid, 0, 50, 400, 300);   // Local on left
            ctx.drawImage(remoteVid, 400, 50, 400, 300); // Remote on right
            if (mediaRecorder?.state === 'recording') requestAnimationFrame(drawFrame);
        }

        const stream = canvas.captureStream(30);
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });

        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'livekit-recording.webm';
            a.click();
            recordedChunks = [];
        };

        mediaRecorder.start();
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

start();