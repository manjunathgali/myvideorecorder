const { Room, RoomEvent, VideoPresets, Track } = LivekitClient;

let room;
let mediaRecorder;
let recordedChunks = [];

async function start() {
    try {
        const identity = "user-" + Math.floor(Math.random() * 1000);
        const response = await fetch(`/api/get-token?room=my-room&identity=${identity}`);
        if (!response.ok) throw new Error('Failed to get token');
        const { token } = await response.json();

        room = new Room({
            adaptiveStream: true,
            dynacast: true
        });

        room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
            if (track.kind === Track.Kind.Video) {
                track.attach(document.getElementById('remote-video'));
            }
            // Audio elements are often hidden but must be attached to hear them
            if (track.kind === Track.Kind.Audio) {
                track.attach(document.createElement('audio'));
            }
        });

        await room.connect('wss://my-first-app-mwgdyws7.livekit.cloud', token);

        await room.localParticipant.setCameraEnabled(true, {
            resolution: VideoPresets.h1080.resolution
        });
        await room.localParticipant.setMicrophoneEnabled(true);

        const localVideoTrack = room.localParticipant.getTrackPublication(Track.Source.Camera).videoTrack;
        localVideoTrack.attach(document.getElementById('local-video'));

    } catch (error) {
        console.error("Setup Error:", error);
        alert("Error: " + error.message);
    }
}

const startBtn = document.getElementById('start-btn');
if (startBtn) {
    const stopBtn = document.getElementById('stop-btn');

    startBtn.onclick = async () => {
        const localVid = document.getElementById('local-video');
        const remoteVid = document.getElementById('remote-video');

        // 1. SETUP CANVAS (VIDEO)
        const canvas = document.createElement('canvas');
        canvas.width = 1920; canvas.height = 1080;
        const ctx = canvas.getContext('2d', { alpha: false });

        // 2. SETUP AUDIO MIXER
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const dest = audioCtx.createMediaStreamDestination();

        // Add Local Audio
        const localStream = new MediaStream([room.localParticipant.getTrackPublication(Track.Source.Microphone).audioTrack.mediaStreamTrack]);
        const localSource = audioCtx.createMediaStreamSource(localStream);
        localSource.connect(dest);

        // Add Remote Audio (Loop through all remote participants)
        room.remoteParticipants.forEach(participant => {
            participant.getTrackPublications().forEach(pub => {
                if (pub.audioTrack && pub.isSubscribed) {
                    const remoteSource = audioCtx.createMediaStreamSource(new MediaStream([pub.audioTrack.mediaStreamTrack]));
                    remoteSource.connect(dest);
                }
            });
        });

        // 3. COMBINE VIDEO + AUDIO
        const videoStream = canvas.captureStream(30);
        const combinedStream = new MediaStream([
            ...videoStream.getVideoTracks(),
            ...dest.stream.getAudioTracks()
        ]);

        function drawFrame() {
            if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
            ctx.fillStyle = "black";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(localVid, 0, 270, 960, 540);
            ctx.drawImage(remoteVid, 960, 270, 960, 540);
            requestAnimationFrame(drawFrame);
        }

        const options = {
            mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm',
            videoBitsPerSecond: 8000000
        };

        mediaRecorder = new MediaRecorder(combinedStream, options);

        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `meeting-HD-with-audio-${Date.now()}.webm`;
            a.click();
            recordedChunks = [];
            audioCtx.close(); // Clean up audio context
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

start();