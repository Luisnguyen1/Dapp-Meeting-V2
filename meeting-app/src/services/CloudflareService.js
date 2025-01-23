class CloudflareService {
    constructor() {
        this.APP_ID = "45a8f268c6e1827a3edf6e0cb80b8618";
        this.APP_TOKEN = "3180fd33c689b7b7345332f2272d64ed639a99f3ece3536bc6185367181c38ee";
        this.API_BASE = `https://rtc.live.cloudflare.com/v1/apps/${this.APP_ID}`;
    }

    async createSession() {
        const response = await fetch(`${this.API_BASE}/sessions/new`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.APP_TOKEN}`,
                "Content-Type": "application/json"
            }
        });
        const data = await response.json();
        if (data.errorCode) {
            throw new Error(data.errorDescription);
        }
        return data.sessionId;
    }

    async checkSession(sessionId) {
        const response = await fetch(`${this.API_BASE}/sessions/${sessionId}`, {
            headers: {
                "Authorization": `Bearer ${this.APP_TOKEN}`
            }
        });
        return response.json();
    }

    async addTracks(sessionId, tracks) {
        const response = await fetch(`${this.API_BASE}/sessions/${sessionId}/tracks/new`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.APP_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(tracks)
        });
        return response.json();
    }

    async renegotiate(sessionId, sessionDescription) {
        const response = await fetch(`${this.API_BASE}/sessions/${sessionId}/renegotiate`, {
            method: "PUT",
            headers: {
                "Authorization": `Bearer ${this.APP_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                sessionDescription
            })
        });
        return response.json();
    }

    async closeTracks(sessionId) {
        return fetch(`${this.API_BASE}/sessions/${sessionId}/tracks/close`, {
            method: "PUT",
            headers: {
                "Authorization": `Bearer ${this.APP_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                tracks: [],
                force: true
            })
        });
    }

    async getSessionInfo(sessionId) {
        const response = await fetch(`${this.API_BASE}/sessions/${sessionId}`, {
            headers: {
                "Authorization": `Bearer ${this.APP_TOKEN}`
            }
        });
        return response.json();
    }
}

export default new CloudflareService();
