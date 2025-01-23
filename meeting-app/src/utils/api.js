const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:8080';

export const createMeeting = async (meetingData) => {
    const response = await fetch(`${API_BASE_URL}/meetings`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(meetingData),
    });
    return response.json();
};

export const joinMeeting = async (roomID, userData) => {
    const response = await fetch(`${API_BASE_URL}/meetings/${roomID}/join`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(userData),
    });
    return response.json();
};

export const getMeetingInfo = async (roomID) => {
    const response = await fetch(`${API_BASE_URL}/meetings/${roomID}`);
    return response.json();
};