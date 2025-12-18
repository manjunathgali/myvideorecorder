import { AccessToken } from 'livekit-server-sdk';

export default async function handler(req, res) {
    const { room, identity } = req.query;

    // Use Environment Variables for security
    const apiKey = 'APIDSZ43mKQ9ArB';
    const apiSecret = '0jBkFpEIQZWaETN8ioBcJYWm3rOrANfrVgVPa0fQ4og';

    const at = new AccessToken(apiKey, apiSecret, { identity });
    at.addGrant({ roomJoin: true, room: room, canPublish: true, canSubscribe: true });

    res.status(200).json({ token: await at.toJwt() });
}