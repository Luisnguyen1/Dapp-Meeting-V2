const API_BASE = 'http://localhost:8080';

export const createMeeting = async (title, username) => {
    const response = await fetch(`${API_BASE}/meetings`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            title,
            creator_id: "65c12a890000000000000000", // This should come from auth
            username
        })
    });
    return response.json();
};

export const joinMeeting = async (roomId, username) => {
    const response = await fetch(`${API_BASE}/meetings/${roomId}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username })
    });
    return response.json();
};

export const getMeetingInfo = async (roomId) => {
    const response = await fetch(`${API_BASE}/meetings/${roomId}/info`);
    return response.json();
};