const { Room, RoomEvent, Track, VideoPresets } = LivekitClient;

let room;

async function startParticipant() {
    try {
        const identity = "participant-" + Math.floor(Math.random() * 1000);

        const response = await fetch(
            `/api/get-token?room=my-room&identity=${identity}`
        );
        const { token } = await response.json();

        room = new Room({
            adaptiveStream: true, // adaptive streaming based on bandwidth
            dynacast: true        // enables efficient simulcast
        });

        // --- Subscribe to Host tracks ---
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
        await room.localParticipant.setCameraEnabled(
            true,
            { resolution: VideoPresets.h1080.resolution,
                frameRate: 30 } // max frame rate for smooth video
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
