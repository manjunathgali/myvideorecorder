import { AccessToken } from 'livekit-server-sdk';

export default async function handler(req, res) {
    // Pull from Environment Variables (set these in Vercel Dashboard)
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    // 1. Get query parameters from the URL
    const { room, identity } = req.query;

    // 2. Validate input
    if (!room || !identity) {
        return res.status(400).json({ error: 'Missing "room" or "identity" query parameter' });
    }

    try {
        // 3. Create the token
        const at = new AccessToken(apiKey, apiSecret, { identity });

        // 4. Add permissions (Grants)
        at.addGrant({
            roomJoin: true,
            room: room,
            canPublish: true,
            canSubscribe: true
        });

        // 5. Generate the JWT string
        const token = await at.toJwt();

        // 6. Return as JSON
        res.status(200).json({ token });
    } catch (error) {
        console.error('Token Error:', error);
        res.status(500).json({ error: 'Failed to generate token' });
    }
}