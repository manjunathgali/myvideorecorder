const { Room, RoomEvent, Track, VideoPresets } = LivekitClient;

let room;

window.room = null;

async function startParticipant() {
    try {
        const identity = "participant-" + Math.floor(Math.random() * 1000);
        const response = await fetch(`/api/get-token?room=my-room&identity=${identity}`);
        const { token } = await response.json();

        room = new Room({
            adaptiveStream: true,
            dynacast: true,
            expLowLatency: true,
            audioCaptureDefaults: {
                noiseSuppression: true,
                echoCancellation: true,
                autoGainControl: true
            },
            publishDefaults: {
                videoCodec: "vp9",
                backupCodec: { codec: "vp8" },
                videoSimulcastLayers: [
                    VideoPresets.h360,
                    VideoPresets.h720,
                    VideoPresets.h1080,
                    VideoPresets.h1440
                ],
                bitrateLimit: 0,
                videoEncoding: {
                    maxBitrate: 6000000,
                    maxFramerate: 30,
                    scalabilityMode: "L3T3"
                }
            }
        });

        window.room = room;

        room.on(RoomEvent.TrackSubscribed, (track) => {
            if (track.kind === Track.Kind.Video) {
                track.attach(document.getElementById("remote-video"));
            }
            if (track.kind === Track.Kind.Audio) {
                const audio = document.createElement("audio");
                audio.autoplay = true;
                audio.playsInline = true;
                track.attach(audio);
            }
        });

        await room.connect("wss://my-first-app-mwgdyws7.livekit.cloud", token);

        await switchCamera('user');  // Start with front camera

        await room.localParticipant.setMicrophoneEnabled(true);

        if (window.updateStatus) window.updateStatus("Connected – Max Quality");
        console.log("Participant connected");
    } catch (err) {
        console.error("Participant error:", err);
        alert("Connection failed: " + err.message);
        if (window.updateStatus) window.updateStatus("Error");
    }
}

window.switchCamera = async function(facingMode = 'user') {
    if (!room || !room.localParticipant) {
        console.warn("Room not ready");
        return false;
    }

    try {
        const constraints = {
            video: {
                facingMode: facingMode,
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        const newVideoTrack = stream.getVideoTracks()[0];

        const cameraPub = room.localParticipant.getTrackPublication(Track.Source.Camera);

        if (cameraPub && cameraPub.track) {
            await cameraPub.track.replaceTrack(newVideoTrack);
        } else {
            await room.localParticipant.publishTrack(newVideoTrack, {
                source: Track.Source.Camera
            });
        }

        const updatedPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (updatedPub?.videoTrack) {
            updatedPub.videoTrack.attach(document.getElementById("local-video"));
        }

        const localVideo = document.getElementById("local-video");
        if (facingMode === 'user') {
            localVideo.classList.remove('rear');
        } else {
            localVideo.classList.add('rear');
        }

        const btn = document.getElementById('camera-switch-btn');
        if (btn) {
            btn.textContent = facingMode === 'user' ? 'Switch to Rear Camera' : 'Switch to Front Camera';
        }

        return true;
    } catch (err) {
        console.error("Camera switch failed:", err);
        alert("Failed to switch camera");
        return false;
    }
};

startParticipant();