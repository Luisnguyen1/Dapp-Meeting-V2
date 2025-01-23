import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, TextField, Box, Typography } from '@mui/material';
import { createMeeting, joinMeeting } from '../../utils/api';

const CreateJoinRoom = () => {
    const [roomID, setRoomID] = useState('');
    const [username, setUsername] = useState('');
    const [title, setTitle] = useState('');
    const navigate = useNavigate();

    const handleCreateRoom = async () => {
        try {
            // Create temporary user ID
            const tempUserId = new ObjectId().toString();
            const meeting = await createMeeting(title, tempUserId, username);
            navigate(`/meeting/${meeting.room_id}`);
        } catch (error) {
            console.error('Error creating room:', error);
        }
    };

    const handleJoinRoom = async () => {
        try {
            // Create temporary user ID
            const tempUserId = new ObjectId().toString();
            const response = await joinMeeting(roomID, tempUserId, username);
            navigate(`/meeting/${roomID}`);
        } catch (error) {
            console.error('Error joining room:', error);
        }
    };

    return (
        <Box sx={{ maxWidth: 400, mx: 'auto', p: 3 }}>
            <Typography variant="h4" gutterBottom>
                Create or Join Meeting
            </Typography>
            <TextField
                fullWidth
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                margin="normal"
            />
            <Box sx={{ mt: 2 }}>
                <Typography variant="h6">Create New Meeting</Typography>
                <TextField
                    fullWidth
                    label="Meeting Title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    margin="normal"
                />
                <Button 
                    variant="contained" 
                    onClick={handleCreateRoom}
                    fullWidth
                    sx={{ mt: 1 }}
                >
                    Create Meeting
                </Button>
            </Box>
            <Box sx={{ mt: 3 }}>
                <Typography variant="h6">Join Existing Meeting</Typography>
                <TextField
                    fullWidth
                    label="Room ID"
                    value={roomID}
                    onChange={(e) => setRoomID(e.target.value)}
                    margin="normal"
                />
                <Button 
                    variant="contained" 
                    onClick={handleJoinRoom}
                    fullWidth
                    sx={{ mt: 1 }}
                >
                    Join Meeting
                </Button>
            </Box>
        </Box>
    );
};

export default CreateJoinRoom;