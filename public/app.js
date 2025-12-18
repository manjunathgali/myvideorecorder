const { Room, RoomEvent, VideoPresets, Track } = LivekitClient;

let room;
let mediaRecorder;
let recordedChunks = [];

async function start() {
    try {
        const identity = "user-" + Math.floor(Math.random() * 1000);

        // 1. Fetch token
        const response = await fetch(`/api/get-token?room=my-room&identity=${identity}`);
        if (!response.ok) throw new Error('Failed to get token from API');
        const { token } = await response.json();

        // 2. Initialize Room with Quality Presets
        room = new Room({
            adaptiveStream: true, // Scales quality based on bandwidth
            dynacast: true        // Stops sending video if tile is hidden
        });

        // 3. Handle Remote Video (High Quality Subscription)
        room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
            if (track.kind === Track.Kind.Video) {
                const remoteEl = document.getElementById('remote-video');
                track.attach(remoteEl);
                // Ensure the video element plays at the highest possible resolution
                remoteEl.style.objectFit = "contain";
            }
        });

        // 4. Connect to LiveKit Cloud
        await room.connect('wss://my-first-app-mwgdyws7.livekit.cloud', token);

        // 5. Publish Local Camera in 1080p
        // VideoPresets.h1080 ensures the browser tries to capture 1920x1080
        await room.localParticipant.setCameraEnabled(true, {
            resolution: VideoPresets.h1080.resolution,
            simulcast: true // Provides better stability for the remote person
        });
        await room.localParticipant.setMicrophoneEnabled(true);

        // 6. Attach Local Video
        const localPublication = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (localPublication && localPublication.videoTrack) {
            localPublication.videoTrack.attach(document.getElementById('local-video'));
        }

    } catch (error) {
        console.error("Setup Error:", error);
        alert("Error: " + error.message);
    }
}

// --- High-Quality Recording Logic ---
const startBtn = document.getElementById('start-btn');
if (startBtn) {
    const stopBtn = document.getElementById('stop-btn');

    startBtn.onclick = () => {
        const localVid = document.getElementById('local-video');
        const remoteVid = document.getElementById('remote-video');

        // USE 1080p CANVAS: Setting this to 1920x1080 ensures no detail is lost
        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext('2d', { alpha: false }); // Better performance

        function drawFrame() {
            if (!mediaRecorder || mediaRecorder.state !== 'recording') return;

            // Clear with black background
            ctx.fillStyle = "black";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw side-by-side (960px width each for a 1920px canvas)
            // Center the 16:9 videos vertically in their 1080p height
            ctx.drawImage(localVid, 0, 270, 960, 540);
            ctx.drawImage(remoteVid, 960, 270, 960, 540);

            requestAnimationFrame(drawFrame);
        }

        const stream = canvas.captureStream(30); // Capture at 30 FPS

        // FORCE HIGH BITRATE & VP9: This is the biggest quality jump
        // VP9 is ~50% more efficient than VP8, leading to much sharper files.
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
            ? 'video/webm;codecs=vp9'
            : 'video/webm;codecs=vp8';

        const options = {
            mimeType: mimeType,
            videoBitsPerSecond: 8000000 // 8 Mbps for crisp HD video
        };

        mediaRecorder = new MediaRecorder(stream, options);

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `meeting-HD-${new Date().toISOString()}.webm`;
            a.click();
            recordedChunks = [];
        };

        mediaRecorder.start(1000); // Slices data every 1s for safety
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