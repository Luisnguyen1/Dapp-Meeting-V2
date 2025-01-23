import React, { useEffect, useRef } from 'react';
import { useMeetingContext } from '../../context/MeetingContext';
import './MeetingRoom.css';

const MeetingRoom = () => {
    const { localStream, remoteStreams } = useMeetingContext();
    const localVideoRef = useRef(null);
    const remoteVideosRef = useRef(new Map());

    useEffect(() => {
        if (localVideoRef.current && localStream) {
            localVideoRef.current.srcObject = localStream;
        }
    }, [localStream]);

    useEffect(() => {
        remoteStreams.forEach((stream, streamId) => {
            const videoEl = remoteVideosRef.current.get(streamId);
            if (videoEl && videoEl.srcObject !== stream) {
                videoEl.srcObject = stream;
            }
        });
    }, [remoteStreams]);

    return (
        <div className="meeting-room">
            <div className="video-grid">
                <div className="video-container">
                    <video
                        ref={localVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="video-player"
                    />
                    <div className="video-label">You</div>
                </div>
                {Array.from(remoteStreams).map(([streamId, stream]) => (
                    <div key={streamId} className="video-container">
                        <video
                            ref={el => {
                                if (el) {
                                    remoteVideosRef.current.set(streamId, el);
                                }
                            }}
                            autoPlay
                            playsInline
                            className="video-player"
                        />
                        <div className="video-label">Participant</div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default MeetingRoom;