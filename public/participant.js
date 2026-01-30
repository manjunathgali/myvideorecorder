const { Room, RoomEvent, Track, VideoPresets } = LivekitClient;

let room;
let currentModeConfig = null;

window.room = null;

const MODES = {
    high: {
        label: "Premium",
        codec: "vp9",
        width: 1920,
        height: 1080,
        maxBitrate: 6_000_000,
        simulcast: true,
        dynacast: true
    },
    balanced: {
        label: "Balanced",
        codec: "vp8",
        width: 1280,
        height: 720,
        maxBitrate: 2_500_000,
        simulcast: true,
        dynacast: true
    },
    performance: {
        label: "Performance",
        codec: "vp8",
        width: 640,
        height: 360,
        maxBitrate: 500_000,
        simulcast: false, // Save CPU
        dynacast: false
    }
};

window.startParticipant = async function (modeName = 'balanced') {
    try {
        currentModeConfig = MODES[modeName] || MODES.balanced;
        console.log(`Starting in ${currentModeConfig.label} mode`);

        if (window.updateStatus) window.updateStatus(`Connecting (${currentModeConfig.label})...`);

        const identity = "participant-" + Math.floor(Math.random() * 1000);
        const response = await fetch(`/api/get-token?room=my-room&identity=${identity}`);
        const { token } = await response.json();

        // Configure Publish Defaults based on Mode
        const publishDefaults = {
            videoCodec: currentModeConfig.codec,
            videoEncoding: {
                maxBitrate: currentModeConfig.maxBitrate,
                maxFramerate: 30,
            }
        };

        // Add backup codec always
        if (currentModeConfig.codec === 'vp9') {
            publishDefaults.backupCodec = { codec: 'vp8' };
        }

        // Configure Simulcast (only for high/balanced)
        if (currentModeConfig.simulcast) {
            publishDefaults.videoSimulcastLayers = [
                VideoPresets.h360,
                VideoPresets.h720
            ];
            // Add 1080p layer only if high mode
            if (currentModeConfig.height >= 1080) {
                publishDefaults.videoSimulcastLayers.push(VideoPresets.h1080);
            }
            publishDefaults.videoEncoding.scalabilityMode = "L3T3";
        } else {
            publishDefaults.videoSimulcastLayers = []; // No simulcast
            publishDefaults.videoEncoding.scalabilityMode = "L1T3"; // No spatial layers
        }

        room = new Room({
            adaptiveStream: true,
            dynacast: currentModeConfig.dynacast,
            expLowLatency: true,
            audioCaptureDefaults: {
                noiseSuppression: true,
                echoCancellation: true,
                autoGainControl: true
            },
            publishDefaults: publishDefaults
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

        // Use the token to connect
        // Ideally this URL comes from the API too, but using hardcoded for now as per previous
        await room.connect("wss://my-first-app-mwgdyws7.livekit.cloud", token);

        await switchCamera('user');  // Start with front camera using new constraints

        await room.localParticipant.setMicrophoneEnabled(true);

        if (window.updateStatus) window.updateStatus(`Connected – ${currentModeConfig.label}`);
        console.log("Participant connected");
    } catch (err) {
        console.error("Participant error:", err);
        alert("Connection failed: " + err.message);
        if (window.updateStatus) window.updateStatus("Error");

        // Reset UI if failed
        document.getElementById('join-controls').style.display = 'flex';
        document.getElementById('incall-controls').style.display = 'none';
    }
}

window.switchCamera = async function (facingMode = 'user') {
    if (!room || !room.localParticipant) {
        console.warn("Room not ready");
        return false;
    }

    try {
        // Use the current mode's resolution preference
        const widthIdeal = currentModeConfig ? currentModeConfig.width : 1280;
        const heightIdeal = currentModeConfig ? currentModeConfig.height : 720;

        const constraints = {
            video: {
                facingMode: facingMode,
                width: { ideal: widthIdeal },
                height: { ideal: heightIdeal }
            }
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        const newVideoTrack = stream.getVideoTracks()[0];

        const cameraPub = room.localParticipant.getTrackPublication(Track.Source.Camera);

        if (cameraPub && cameraPub.track) {
            await cameraPub.track.replaceTrack(newVideoTrack);
        } else {
            await room.localParticipant.publishTrack(newVideoTrack, {
                source: Track.Source.Camera,
                // Ensure the track inherits the room's publish defaults or we set them explicitly here if needed
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
        alert("Failed to switch camera: " + err.message);
        return false;
    }
};

// Removed auto-start: startParticipant();
