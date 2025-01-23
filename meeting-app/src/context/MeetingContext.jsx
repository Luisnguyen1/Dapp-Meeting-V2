import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../services/api';

export const MeetingContext = createContext();

export const MeetingProvider = ({ children }) => {
  const [meetingData, setMeetingData] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const peerConnectionRef = useRef(null);
  const navigate = useNavigate();

  const initializeWebRTC = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    setLocalStream(stream);

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
      bundlePolicy: "max-bundle"
    });

    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    pc.ontrack = (event) => {
      setRemoteStreams(prev => {
        const newStreams = new Map(prev);
        newStreams.set(event.streams[0].id, event.streams[0]);
        return newStreams;
      });
    };

    peerConnectionRef.current = pc;
    return pc;
  }, []);

  const createMeeting = useCallback(async (title, username) => {
    try {
      // Create meeting in backend - this will create the session
      const meeting = await api.createMeeting(title, username);
      setMeetingData(meeting);

      // Initialize WebRTC and add tracks to the session
      await initializeWebRTC();
      
      navigate(`/meeting/${meeting.room_id}`);
      return meeting.room_id;
    } catch (error) {
      console.error("Error creating meeting:", error);
      throw error;
    }
  }, [initializeWebRTC, navigate]);

  const joinMeeting = useCallback(async (roomId, username) => {
    try {
      // Join meeting through backend - this will create a new session
      const joinResponse = await api.joinMeeting(roomId, username);
      const meetingInfo = await api.getMeetingInfo(roomId);
      setMeetingData(meetingInfo);

      // Initialize WebRTC and add tracks to the session
      await initializeWebRTC();

      navigate(`/meeting/${roomId}`);
    } catch (error) {
      console.error("Error joining meeting:", error);
      throw error;
    }
  }, [initializeWebRTC, navigate]);

  const value = {
    meetingData,
    localStream,
    remoteStreams,
    createMeeting,
    joinMeeting
  };

  return (
    <MeetingContext.Provider value={value}>
      {children}
    </MeetingContext.Provider>
  );
};

// Single export point for all named exports
const useMeetingContext = () => useContext(MeetingContext);
export { MeetingProvider, useMeetingContext };