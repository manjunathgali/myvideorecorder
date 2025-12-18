const { Room, RoomEvent, Track } = LivekitClient;

let room;
let mediaRecorder;
let recordedChunks = [];

async function start() {
    try {
        const identity = "user-" + Math.floor(Math.random() * 1000);

        // 1. Fetch token from your secure Vercel API
        const response = await fetch(`/api/get-token?room=my-room&identity=${identity}`);
        if (!response.ok) throw new Error('Failed to get token from API');

        const { token } = await response.json();

        room = new Room();

        // 2. Handle Remote Video (The other person)
        room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
            if (track.kind === Track.Kind.Video) {
                const remoteEl = document.getElementById('remote-video');
                track.attach(remoteEl);
                console.log("Remote video attached");
            }
        });

        // 3. Connect to LiveKit Cloud
        await room.connect('wss://my-first-app-mwgdyws7.livekit.cloud', token);
        console.log("Connected to room:", room.name);

        // 4. Enable Camera and Mic
        // This triggers the browser permission popup
        await room.localParticipant.setCameraEnabled(true);
        await room.localParticipant.setMicrophoneEnabled(true);

        // 5. Attach Local Video to the 'local-video' tile
        // We find the published camera track and attach it
        const localPublication = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (localPublication && localPublication.videoTrack) {
            localPublication.videoTrack.attach(document.getElementById('local-video'));
        }

    } catch (error) {
        console.error("Setup Error:", error);
        alert("Error: " + error.message); // Helpful for debugging on mobile
    }
}

// --- Recording Logic (Unchanged but ensuring IDs exist) ---
const startBtn = document.getElementById('start-btn');
if (startBtn) {
    const stopBtn = document.getElementById('stop-btn');

    startBtn.onclick = () => {
        const localVid = document.getElementById('local-video');
        const remoteVid = document.getElementById('remote-video');

        const canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 400;
        const ctx = canvas.getContext('2d');

        function drawFrame() {
            if (!mediaRecorder || mediaRecorder.state !== 'recording') return;

            ctx.fillStyle = "black";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw both videos side-by-side on the canvas
            ctx.drawImage(localVid, 0, 50, 400, 300);
            ctx.drawImage(remoteVid, 400, 50, 400, 300);

            requestAnimationFrame(drawFrame);
        }

        const stream = canvas.captureStream(30); // 30 FPS

        // Use a supported video format
        const options = { mimeType: 'video/webm;codecs=vp8' };
        mediaRecorder = new MediaRecorder(stream, options);

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'meeting-recording.webm';
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