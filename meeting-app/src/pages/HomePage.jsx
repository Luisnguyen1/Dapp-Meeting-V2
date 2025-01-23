import React, { useState } from 'react';
import { useMeetingContext } from '../context/MeetingContext';
import { Box, Button, TextField, Container, Typography, Paper } from '@mui/material';

const HomePage = () => {
    const { createMeeting, joinMeeting } = useMeetingContext();
    const [title, setTitle] = useState('');
    const [username, setUsername] = useState('');
    const [roomId, setRoomId] = useState('');
    const [isJoining, setIsJoining] = useState(false);

    const handleCreateMeeting = async (e) => {
        e.preventDefault();
        try {
            await createMeeting(title, username);
        } catch (error) {
            console.error('Failed to create meeting:', error);
            alert('Failed to create meeting');
        }
    };

    const handleJoinMeeting = async (e) => {
        e.preventDefault();
        try {
            await joinMeeting(roomId, username);
        } catch (error) {
            console.error('Failed to join meeting:', error);
            alert('Failed to join meeting');
        }
    };

    return (
        <Container maxWidth="sm">
            <Box sx={{ mt: 8, mb: 4 }}>
                <Paper elevation={3} sx={{ p: 4 }}>
                    {!isJoining ? (
                        <>
                            <Typography variant="h4" component="h1" gutterBottom>
                                Create New Meeting
                            </Typography>
                            <Box component="form" onSubmit={handleCreateMeeting} sx={{ mt: 2 }}>
                                <TextField
                                    fullWidth
                                    label="Meeting Title"
                                    margin="normal"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    required
                                />
                                <TextField
                                    fullWidth
                                    label="Your Name"
                                    margin="normal"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    required
                                />
                                <Button
                                    type="submit"
                                    fullWidth
                                    variant="contained"
                                    sx={{ mt: 3 }}
                                >
                                    Create Meeting
                                </Button>
                            </Box>
                            <Button
                                fullWidth
                                variant="outlined"
                                sx={{ mt: 2 }}
                                onClick={() => setIsJoining(true)}
                            >
                                Join Existing Meeting
                            </Button>
                        </>
                    ) : (
                        <>
                            <Typography variant="h4" component="h1" gutterBottom>
                                Join Meeting
                            </Typography>
                            <Box component="form" onSubmit={handleJoinMeeting} sx={{ mt: 2 }}>
                                <TextField
                                    fullWidth
                                    label="Room ID"
                                    margin="normal"
                                    value={roomId}
                                    onChange={(e) => setRoomId(e.target.value)}
                                    required
                                />
                                <TextField
                                    fullWidth
                                    label="Your Name"
                                    margin="normal"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    required
                                />
                                <Button
                                    type="submit"
                                    fullWidth
                                    variant="contained"
                                    sx={{ mt: 3 }}
                                >
                                    Join Meeting
                                </Button>
                            </Box>
                            <Button
                                fullWidth
                                variant="outlined"
                                sx={{ mt: 2 }}
                                onClick={() => setIsJoining(false)}
                            >
                                Create New Meeting
                            </Button>
                        </>
                    )}
                </Paper>
            </Box>
        </Container>
    );
};

export default HomePage;