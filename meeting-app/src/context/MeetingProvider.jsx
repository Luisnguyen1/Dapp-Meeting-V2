import React, { createContext, useState } from 'react';

export const MeetingContext = createContext();

export const MeetingProvider = ({ children }) => {
    const [meetingData, setMeetingData] = useState({
        roomID: null,
        participants: [],
    });

    const createMeeting = (roomID) => {
        setMeetingData({ ...meetingData, roomID });
    };

    const joinMeeting = (participant) => {
        setMeetingData((prevState) => ({
            ...prevState,
            participants: [...prevState.participants, participant],
        }));
    };

    const leaveMeeting = (participantID) => {
        setMeetingData((prevState) => ({
            ...prevState,
            participants: prevState.participants.filter(p => p.id !== participantID),
        }));
    };

    return (
        <MeetingContext.Provider value={{ meetingData, createMeeting, joinMeeting, leaveMeeting }}>
            {children}
        </MeetingContext.Provider>
    );
};