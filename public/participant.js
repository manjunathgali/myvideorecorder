const { Room, RoomEvent, Track, VideoPresets } = LivekitClient;

let room;

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

        await room.localParticipant.setCameraEnabled(true, {
            resolution: VideoPresets.h1440.resolution,
            frameRate: 30
        });

        await room.localParticipant.setMicrophoneEnabled(true);

        const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (camPub?.videoTrack) {
            camPub.videoTrack.attach(document.getElementById("local-video"));
        }

        if (window.updateStatus) window.updateStatus("Connected – Max Quality");
        console.log("Participant connected with maximum quality");
    } catch (err) {
        console.error("Participant error:", err);
        alert("Connection failed: " + err.message);
        if (window.updateStatus) window.updateStatus("Error");
    }
}

startParticipant();