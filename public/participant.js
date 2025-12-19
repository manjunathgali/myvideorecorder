const { Room, RoomEvent, Track, VideoPresets, TrackPublishDefaults } = LivekitClient;

let room;

async function startParticipant() {
    try {
        const identity = "participant-" + Math.floor(Math.random() * 1000);

        const response = await fetch(
            `/api/get-token?room=my-room&identity=${identity}`
        );
        const { token } = await response.json();

        room = new Room({
            adaptiveStream: true,
            dynacast: true,
            // Prefer VP9 for better video quality (falls back if unsupported)
            publishDefaults: {
                videoCodec: "vp9",  // Key improvement: higher quality codec
                // Optional: custom simulcast layers (low and mid; high is auto from capture)
                // videoSimulcastLayers: [VideoPresets.h360, VideoPresets.h720],
            } as TrackPublishDefaults,
        });

        // --- Subscribe to Host tracks (unchanged, but adaptiveStream helps received quality) ---
        room.on(RoomEvent.TrackSubscribed, (track) => {
            if (track.kind === Track.Kind.Video) {
                track.attach(document.getElementById("remote-video"));
            }
            if (track.kind === Track.Kind.Audio) {
                const audio = document.createElement("audio");
                audio.autoplay = true;
                track.attach(audio);
            }
        });

        // --- Connect ---
        await room.connect(
            "wss://my-first-app-mwgdyws7.livekit.cloud",
            token
        );

        // --- Enable camera & mic with highest quality preset ---
        // Try h2160 (4K) first; fallback to h1440 or h1080 if device can't handle
        await room.localParticipant.setCameraEnabled(
            true,
            {
                resolution: VideoPresets.h2160.resolution,  // Or h1440 for 1440p
                frameRate: 30
            }
        );

        await room.localParticipant.setMicrophoneEnabled(true);

        // --- Show participant’s own camera ---
        const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (camPub?.videoTrack) {
            camPub.videoTrack.attach(document.getElementById("local-video"));
        }

        console.log("Participant connected");
        console.log("Camera enabled:", room.localParticipant.isCameraEnabled);

    } catch (err) {
        console.error("Participant error:", err);
        alert(err.message);
    }
}

startParticipant();