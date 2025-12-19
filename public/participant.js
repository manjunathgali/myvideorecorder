const { Room, RoomEvent, Track, VideoPresets } = LivekitClient;  // Removed TrackPublishDefaults

let room;

async function startParticipant() {
    try {
        const identity = "participant-" + Math.floor(Math.random() * 1000);

        const response = await fetch(
            `/api/get-token?room=my-room&identity=${identity}`
        );
        const { token } = await response.json();

        room = new Room({
            adaptiveStream: true,   // Adjusts received quality based on network & viewport
            dynacast: true,         // Efficient bandwidth usage with simulcast
            publishDefaults: {
                videoCodec: "vp9",                  // Best quality + efficiency (SVC enabled)
                backupCodec: { codec: "vp8" },      // Fallback for browsers that don't support VP9 (e.g. Safari)
            },
            // No "as TrackPublishDefaults" — that's TypeScript only!
        });

        // Subscribe to host's video and audio
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

        // Connect to the room
        await room.connect(
            "wss://my-first-app-mwgdyws7.livekit.cloud",
            token
        );

        console.log("Connected to room as participant");

        // Enable camera with high quality — h1440 is reliable and sharp on most devices
        // (h2160 often fails or heavily downscales on laptops/phones)
        await room.localParticipant.setCameraEnabled(true, {
            resolution: VideoPresets.h1440.resolution,  // Great balance: sharp but achievable
            frameRate: 30
        });

        await room.localParticipant.setMicrophoneEnabled(true);

        // Show your own camera preview
        const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (camPub?.videoTrack) {
            camPub.videoTrack.attach(document.getElementById("local-video"));
        }

        console.log("Participant camera and mic enabled");
        console.log("Camera active:", room.localParticipant.isCameraEnabled);

        // Optional: Update status on participant page if you have it
        if (window.updateStatus) {
            window.updateStatus("Connected ✓");
        }

    } catch (err) {
        console.error("Participant error:", err);
        alert("Connection failed: " + err.message);

        if (window.updateStatus) {
            window.updateStatus("Error: " + err.message);
        }
    }
}

startParticipant();