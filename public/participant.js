const { Room, RoomEvent, Track, VideoPresets } = LivekitClient;

let room;

// Global for HTML access
window.room = null;

async function startParticipant() {
    try {
        const identity = "participant-" + Math.floor(Math.random() * 1000);
        const response = await fetch(`/api/get-token?room=my-room&identity=${identity}`);
        const { token } = await response.json();

        room = new Room({
            adaptiveStream: true,
            dynacast: true,
            publishDefaults: {
                videoCodec: "vp9",
                backupCodec: { codec: "vp8" },
                videoSimulcastLayers: [
                    VideoPresets.h360,
                    VideoPresets.h720,
                    VideoPresets.h1080,
                    VideoPresets.h1440
                ],
                bitrateLimit: 0
            }
        });

        window.room = room;  // Make room accessible from HTML

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

        // Start with front camera (user)
        await switchCamera('user');

        await room.localParticipant.setMicrophoneEnabled(true);

        if (window.updateStatus) window.updateStatus("Connected – Camera Ready");
        console.log("Participant connected successfully");
    } catch (err) {
        console.error("Participant error:", err);
        alert("Connection failed: " + err.message);
        if (window.updateStatus) window.updateStatus("Error");
    }
}

// Function to switch camera (front/rear)
window.switchCamera = async function(facingMode = 'user') {
    if (!room || !room.localParticipant) {
        console.warn("Room not ready yet");
        return false;
    }

    try {
        // Get new stream with desired camera
        const constraints = {
            video: {
                facingMode: facingMode,  // 'user' = front, 'environment' = rear
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        const videoTrack = stream.getVideoTracks()[0];

        // Replace the existing camera track
        const cameraPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (cameraPub) {
            await cameraPub.track.replaceWith(videoTrack);
        } else {
            // First time enabling
            await room.localParticipant.publishTrack(videoTrack, {
                source: Track.Source.Camera,
                videoEncoding: {
                    maxBitrate: 5000000,  // High quality
                    maxFramerate: 30
                }
            });
        }

        // Re-attach to local preview
        const newCamPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (newCamPub?.videoTrack) {
            newCamPub.videoTrack.attach(document.getElementById("local-video"));
        }

        // Update mirror class
        const localVideo = document.getElementById("local-video");
        if (facingMode === 'user') {
            localVideo.classList.remove('rear');
        } else {
            localVideo.classList.add('rear');
        }

        // Update button text
        const btn = document.getElementById('camera-switch-btn');
        if (btn) {
            btn.textContent = facingMode === 'user' ? 'Switch to Rear Camera' : 'Switch to Front Camera';
        }

        console.log("Switched to", facingMode === 'user' ? 'front' : 'rear', "camera");
        return true;
    } catch (err) {
        console.error("Camera switch failed:", err);
        alert("Failed to access camera: " + err.message);
        return false;
    }
};

startParticipant();