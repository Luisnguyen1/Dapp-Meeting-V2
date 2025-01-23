import React, { useState } from 'react';
import { IconButton } from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import './UserControls.css';

const UserControls = ({ onToggleMic, onToggleCamera }) => {
    const [isMicOn, setMicOn] = useState(true);
    const [isCameraOn, setCameraOn] = useState(true);

    const handleMicToggle = () => {
        setMicOn(!isMicOn);
        onToggleMic(!isMicOn);
    };

    const handleCameraToggle = () => {
        setCameraOn(!isCameraOn);
        onToggleCamera(!isCameraOn);
    };

    return (
        <div className="user-controls">
            <IconButton onClick={handleMicToggle}>
                {isMicOn ? <MicIcon /> : <MicOffIcon />}
            </IconButton>
            <IconButton onClick={handleCameraToggle}>
                {isCameraOn ? <VideocamIcon /> : <VideocamOffIcon />}
            </IconButton>
        </div>
    );
};

export default UserControls;