// Update API URL detection logic
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE = isLocalhost 
    ? 'http://127.0.0.1:7860' 
    : 'https://manhteky123-dapp-meeting.hf.space';

let APP_ID;
let APP_TOKEN;

let localStream;
let localPeerConnection;
let participants = new Map(); // Store participant connections
let ws; // WebSocket connection

const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('roomId');
const username = urlParams.get('username');

// Get stored device preferences
const devicePrefs = JSON.parse(localStorage.getItem('selectedDevices') || '{}');

async function initializeRoom() {
    try {
        // Fetch Cloudflare credentials first
        const credentialsResponse = await fetch(`${API_BASE}/cloudflare/credentials`);
        if (!credentialsResponse.ok) {
            throw new Error('Failed to fetch Cloudflare credentials');
        }
        const credentials = await credentialsResponse.json();
        APP_ID = credentials.appId;
        APP_TOKEN = credentials.token;

        // Initialize local media with stored preferences
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: devicePrefs.audioDeviceId },
            video: { deviceId: devicePrefs.videoDeviceId }
        });

        // Apply stored enable/disable states
        localStream.getAudioTracks()[0].enabled = devicePrefs.audioEnabled;
        localStream.getVideoTracks()[0].enabled = devicePrefs.videoEnabled;

        // Add local video to grid
        addVideoStream('local', username, localStream);
        updateControls();

        // Get session info from backend
        const response = await fetch(`${API_BASE}/meetings/${roomId}/info`);
        if (!response.ok) {
            throw new Error('Failed to fetch meeting info');
        }
        
        const meetingInfo = await response.json();
        console.log('Meeting info received:', meetingInfo);

        if (!meetingInfo.sessions || meetingInfo.sessions.length === 0) {
            throw new Error('No sessions array in meeting info');
        }

        // Find current user's session
        const userSession = meetingInfo.sessions.find(s => s.username === username);
        if (!userSession) {
            throw new Error('No session found for user: ' + username);
        }

        // Initialize WebSocket connection
        await setupWebSocket();

        // Initialize WebRTC with user's session
        await setupCloudflareRTC(userSession.session_id);

        // After setting up our connection, handle existing participants
        await handleExistingParticipants(meetingInfo.sessions);

    } catch (error) {
        console.error('Error initializing room:', error);
        alert('Failed to initialize meeting room: ' + error.message);
    }
}

// Add new function to handle existing participants
async function handleExistingParticipants(sessions) {
    console.log('Handling existing participants:', sessions);

    const existingParticipants = sessions.filter(s => s.username !== username);
    
    for (const participant of existingParticipants) {
        try {
            // Get session state from Cloudflare
            const sessionState = await fetch(
                `https://rtc.live.cloudflare.com/v1/apps/${APP_ID}/sessions/${participant.session_id}`,
                {
                    headers: {
                        "Authorization": `Bearer ${APP_TOKEN}`
                    }
                }
            ).then(res => res.json());

            console.log('Session state for existing participant:', participant.username, sessionState);

            if (sessionState.errorCode) {
                console.warn(`Error getting session state for ${participant.username}:`, sessionState.errorDescription);
                continue;
            }

            // Add to participants map first
            participants.set(participant.session_id, {
                username: participant.username,
                stream: null,
                sessionId: participant.session_id
            });

            // Pull tracks if available
            if (sessionState.tracks && sessionState.tracks.length > 0) {
                const activeTracks = sessionState.tracks.filter(track => track.status === 'active');
                if (activeTracks.length > 0) {
                    console.log('Found active tracks for', participant.username, ':', activeTracks);
                    
                    // Use retryOperation for pulling tracks
                    await retryOperation(
                        () => pullParticipantTracks(activeTracks, {
                            session_id: participant.session_id,
                            username: participant.username
                        }),
                        5, // max retries
                        1000, // initial delay
                        'Pulling tracks for ' + participant.username
                    );
                }
            }
        } catch (err) {
            console.error(`Error handling existing participant ${participant.username}:`, err);
        }
    }

    // Update UI after handling all participants
    updateParticipantsList();
    updateGridLayout();
}

// Add utility function for retrying operations
async function retryOperation(operation, maxRetries, initialDelay, operationName) {
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const result = await operation();
            console.log(`${operationName} succeeded on attempt ${attempt + 1}`);
            return result;
        } catch (error) {
            lastError = error;
            console.warn(`${operationName} failed attempt ${attempt + 1}:`, error);
            
            if (attempt < maxRetries - 1) {
                const delay = initialDelay * Math.pow(2, attempt) * (1 + Math.random() * 0.1);
                console.log(`Retrying ${operationName} in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    throw lastError;
}

// Update pullParticipantTracks to use timeout and better error handling
async function pullParticipantTracks(tracks, participant) {
    const maxRetries = 5;
    const baseDelay = 1000; 
    const localSessionId = localPeerConnection.sessionId;

    // Prevent pulling tracks for our own session
    if (localSessionId === participant.session_id) {
        console.log('Skipping track pull for local session');
        return;
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // Check if participant already has stream
            if (participants.get(participant.session_id)?.stream) {
                console.log('Participant already has stream:', participant.username);
                return;
            }

            console.log(`Pulling tracks attempt ${attempt + 1}/${maxRetries} for participant:`, participant.username, tracks);

            // Set up track reception promise with timeout
            const receivedTracksPromise = new Promise((resolve, reject) => {
                const receivedTracks = new Map();
                const timeout = setTimeout(() => {
                    reject(new Error("Track reception timeout"));
                }, 15000);

                // Store the track IDs we're expecting for this participant
                participant.pendingTracks = new Set(tracks.map(track => track.trackName));
                console.log('Expecting tracks for participant:', participant.username, participant.pendingTracks);

                const trackHandler = (event) => {
                    const track = event.track;
                    if (participant.pendingTracks.has(track.id)) {
                        console.log(`Received expected ${track.kind} track for ${participant.username}:`, track.id);
                        receivedTracks.set(track.id, track);

                        if (receivedTracks.size >= tracks.length) {
                            clearTimeout(timeout);
                            localPeerConnection.removeEventListener('track', trackHandler);
                            resolve(Array.from(receivedTracks.values()));
                        }
                    }
                };

                localPeerConnection.addEventListener('track', trackHandler);
            });

            // Pull remote tracks
            console.log(`Pulling tracks for participant ${participant.username} using local session ${localSessionId}`);
            const pullResponse = await fetch(
                `https://rtc.live.cloudflare.com/v1/apps/${APP_ID}/sessions/${localSessionId}/tracks/new`,
                {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${APP_TOKEN}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        tracks: tracks.map(track => ({
                            location: "remote",
                            sessionId: participant.session_id,
                            trackName: track.trackName
                        }))
                    })
                }
            );

            if (!pullResponse.ok) {
                throw new Error(`Failed to pull tracks: ${pullResponse.status}`);
            }

            const pullData = await pullResponse.json();
            console.log('Pull response:', pullData);

            if (pullData.requiresImmediateRenegotiation) {
                await handleRenegotiation(pullData, localPeerConnection);
            }

            const receivedTracks = await receivedTracksPromise;
            
            if (receivedTracks.length > 0) {
                const remoteStream = new MediaStream(receivedTracks);
                
                participants.set(participant.session_id, {
                    ...participants.get(participant.session_id),
                    stream: remoteStream
                });

                addVideoStream(participant.session_id, participant.username, remoteStream);
                console.log(`Successfully added video stream for ${participant.username}`);
                return; // Success - exit retry loop
            }

        } catch (err) {
            console.error(`Attempt ${attempt + 1} failed for ${participant.username}:`, err);
            
            const delay = Math.min(baseDelay * Math.pow(2, attempt) * (1 + Math.random() * 0.1), 10000);
            
            if (attempt === maxRetries - 1) {
                throw err;
            }
            
            if (err.message.includes("500") || 
                err.message.includes("Session is not ready") || 
                err.message.includes("Track reception timeout") ||
                err.message.includes("Invalid state")) {
                
                console.log(`Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            throw err;
        }
    }
}

async function setupWebSocket() {
    try {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsBaseUrl = isLocalhost
            ? 'localhost:7860'
            : 'manhteky123-dapp-meeting.hf.space';
        const wsUrl = `${wsProtocol}//${wsBaseUrl}/ws/meetings/${roomId}?username=${encodeURIComponent(username)}`;
        
        console.log('Connecting to WebSocket:', wsUrl);
        
        ws = new WebSocket(wsUrl);

        // Increase timeout for connection
        const connectionTimeout = 15000; // 15 seconds

        // Wait for connection to establish with extended timeout
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (ws.readyState !== WebSocket.OPEN) {
                    ws.close();
                    reject(new Error('WebSocket connection timeout'));
                }
            }, connectionTimeout);

            ws.onopen = () => {
                clearTimeout(timeout);
                console.log('WebSocket connected successfully');
                resolve();
            };

            ws.onerror = (error) => {
                clearTimeout(timeout);
                console.error('WebSocket error:', error);
                reject(error);
            };
        });

        // Set up heartbeat only after successful connection
        const heartbeat = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send('ping');
            }
        }, 30000);

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleWebSocketMessage(data);
            } catch (e) {
                console.log('Received non-JSON message:', event.data);
            }
        };

        ws.onclose = (event) => {
            console.log('WebSocket closed with code:', event.code);
            clearInterval(heartbeat);
            
            // Attempt to reconnect after 5 seconds if not intentionally closed
            if (event.code !== 1000) {
                console.log('Connection lost, attempting to reconnect in 5 seconds...');
                setTimeout(() => {
                    setupWebSocket().catch(err => {
                        console.error('Reconnection failed:', err);
                    });
                }, 5000);
            }
        };

    } catch (error) {
        console.error('Error setting up WebSocket:', error);
        throw error;
    }
}

function handleWebSocketMessage(message) {
    console.log('WebSocket message received:', message);
    switch (message.type) {
        case 'room_state':
            console.log('Room state update received:', message.payload);
            updateParticipants(message.payload);
            break;
        case 'participant_left':
            console.log('Participant left:', message.payload);
            handleParticipantLeft(message.payload);
            break;
        case 'participant_joined':
            console.log('New participant joined:', message.payload);
            handleNewParticipant(message.payload);
            break;
        case 'tracks_ready':
            handleTracksReady(message.payload);
            break;
        case 'room_updated':
            console.log('Room updated:', message.payload);
            updateParticipants(message.payload);
            break;
    }
}

async function handleNewParticipant(data) {
    console.log('New participant joined:', data);
    
    // Skip if this is ourselves
    if (data.username === username) {
        console.log('Skipping self participant');
        return;
    }
    
    try {
        // Wait a bit to ensure the session is ready
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Get session state from Cloudflare
        const sessionState = await fetch(
            `https://rtc.live.cloudflare.com/v1/apps/${APP_ID}/sessions/${data.session_id}`, {
            headers: {
                "Authorization": `Bearer ${APP_TOKEN}`
            }
        }).then(res => res.json());

        console.log('New participant session state:', sessionState);

        if (sessionState.errorCode) {
            if (sessionState.errorDescription === 'Session is not ready yet') {
                // Retry after a delay
                console.log('Session not ready, retrying...');
                setTimeout(() => handleNewParticipant(data), 3000);
                return;
            }
            throw new Error(`Cloudflare error: ${sessionState.errorDescription}`);
        }

        // Lưu thông tin participant
        if (!participants.has(data.session_id)) {
            participants.set(data.session_id, {
                username: data.username,
                stream: null,
                sessionId: data.session_id
            });

            // Pull tracks nếu có
            if (sessionState.tracks && sessionState.tracks.length > 0) {
                const activeTracks = sessionState.tracks.filter(track => track.status === 'active');
                console.log('Active tracks found for new participant:', activeTracks);
                if (activeTracks.length > 0) {
                    await pullParticipantTracks(activeTracks, {
                        session_id: data.session_id,
                        username: data.username
                    });
                }
            }

            // Update UI
            updateParticipantsList();
        }

    } catch (err) {
        console.error("Error handling new participant:", err);
        if (err.message.includes("Session is not ready")) {
            setTimeout(() => handleNewParticipant(data), 3000);
        }
    }
}

async function handleTracksReady(data) {
    console.log('Tracks ready for participant:', data);
    if (data.username === username) return; // Skip if it's our own tracks

    try {
        // Get session state with tracks
        const sessionState = await fetch(
            `https://rtc.live.cloudflare.com/v1/apps/${APP_ID}/sessions/${data.session_id}`, {
            headers: {
                "Authorization": `Bearer ${APP_TOKEN}`
            }
        }).then(res => res.json());

        if (sessionState.tracks && sessionState.tracks.length > 0) {
            const activeTracks = sessionState.tracks.filter(track => track.status === 'active');
            if (activeTracks.length > 0) {
                await pullParticipantTracks(activeTracks, {
                    session_id: data.session_id,
                    username: data.username
                });
            }
        }
    } catch (err) {
        console.error('Error handling tracks ready:', err);
    }
}

async function setupCloudflareRTC(sessionId) {
    const maxRetries = 5;
    const baseDelay = 1000; // Start with 1 second delay

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            if (!localPeerConnection || localPeerConnection.connectionState === 'failed') {
                localPeerConnection = new RTCPeerConnection({
                    iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
                    bundlePolicy: 'max-bundle'
                });
                
                localPeerConnection.sessionId = sessionId;

                localPeerConnection.onicecandidate = (event) => {
                    if (event.candidate) {
                        console.log("New ICE candidate:", event.candidate);
                    }
                };

                localPeerConnection.onconnectionstatechange = (event) => {
                    console.log("Connection state changed:", localPeerConnection.connectionState);
                };

                localPeerConnection.ontrack = handleRemoteTrack;
            }

            // Create transceivers for local stream
            console.log(`Creating transceivers for local stream (attempt ${attempt + 1})`);
            const transceivers = localStream.getTracks().map(track =>
                localPeerConnection.addTransceiver(track, {
                    direction: 'sendonly',
                    streams: [localStream]
                })
            );

            const offer = await localPeerConnection.createOffer();
            await localPeerConnection.setLocalDescription(offer);

            // Send local tracks to server with retry logic
            console.log(`Sending local tracks to server (attempt ${attempt + 1})`);
            const response = await fetch(`https://rtc.live.cloudflare.com/v1/apps/${APP_ID}/sessions/${sessionId}/tracks/new`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${APP_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sessionDescription: { 
                        sdp: offer.sdp, 
                        type: offer.type 
                    },
                    tracks: transceivers.map(({ mid, sender }) => ({
                        location: 'local',
                        mid: mid,
                        trackName: sender.track?.id || 'anonymous'
                    }))
                })
            });

            if (!response.ok) {
                if (response.status === 500) {
                    const delay = Math.min(baseDelay * Math.pow(2, attempt), 10000);
                    console.log(`Server returned 500, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    
                    // Reset PeerConnection for next attempt
                    if (localPeerConnection) {
                        localPeerConnection.close();
                        localPeerConnection = null;
                    }
                    
                    continue; // Try again
                }
                throw new Error(`Cloudflare API error: ${response.status}`);
            }

            const data = await response.json();
            
            if (!data.sessionDescription || !data.sessionDescription.type || !data.sessionDescription.sdp) {
                throw new Error('Invalid response format from Cloudflare API');
            }

            await localPeerConnection.setRemoteDescription(
                new RTCSessionDescription(data.sessionDescription)
            );

            // Wait for connection to be established
            await waitForConnectionState(localPeerConnection, 'connected', 15000);

            // Only proceed after connection is confirmed
            console.log('WebRTC connection established successfully');

            // Notify that our tracks are ready
            const notifyResponse = await fetch(`${API_BASE}/meetings/${roomId}/notify-tracks-ready`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionId,
                    username: username
                })
            });

            if (!notifyResponse.ok) {
                console.error('Failed to notify tracks ready');
            }

            // If we get here, everything succeeded
            return;

        } catch (error) {
            console.error(`Error in setupCloudflareRTC attempt ${attempt + 1}:`, error);
            
            // Clean up the failed connection
            if (localPeerConnection) {
                localPeerConnection.close();
                localPeerConnection = null;
            }

            // If this was our last attempt, throw the error
            if (attempt === maxRetries - 1) {
                throw error;
            }

            // Wait before retrying
            const delay = Math.min(baseDelay * Math.pow(2, attempt), 10000);
            console.log(`Retrying setupCloudflareRTC in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Add new utility function to wait for connection state
async function waitForConnectionState(peerConnection, desiredState, timeout = 15000) {
    return new Promise((resolve, reject) => {
        if (peerConnection.connectionState === desiredState) {
            resolve();
            return;
        }

        const timer = setTimeout(() => {
            peerConnection.removeEventListener('connectionstatechange', checkState);
            reject(new Error(`Connection state timeout: waited ${timeout}ms for '${desiredState}' state`));
        }, timeout);

        function checkState() {
            if (peerConnection.connectionState === desiredState) {
                clearTimeout(timer);
                peerConnection.removeEventListener('connectionstatechange', checkState);
                resolve();
            } else if (peerConnection.connectionState === 'failed') {
                clearTimeout(timer);
                peerConnection.removeEventListener('connectionstatechange', checkState);
                reject(new Error('Connection failed while waiting for desired state'));
            }
        }

        peerConnection.addEventListener('connectionstatechange', checkState);
    });
}

function handleRemoteTrack(event) {
    const stream = event.streams[0];
    if (!stream) {
        console.warn('No stream in remote track event');
        return;
    }

    // Log the received track and stream details for debugging
    console.log('Received remote track:', {
        trackKind: event.track.kind,
        trackId: event.track.id,
        streamId: stream.id
    });

    // Find the participant this stream belongs to by checking track IDs
    let matchingParticipant = null;
    for (const [sessionId, participant] of participants) {
        if (participant.pendingTracks && participant.pendingTracks.has(event.track.id)) {
            console.log('Found matching participant for track:', sessionId);
            matchingParticipant = participant;
            break;
        }
    }

    if (matchingParticipant) {
        // If we already have a stream for this participant, add the track to it
        if (matchingParticipant.stream) {
            if (!matchingParticipant.stream.getTracks().find(t => t.id === event.track.id)) {
                matchingParticipant.stream.addTrack(event.track);
            }
        } else {
            // Create new stream if this is the first track
            matchingParticipant.stream = new MediaStream([event.track]);
        }
        
        // Update the video element with the correct stream
        const videoElement = document.getElementById(`video-${matchingParticipant.sessionId}`);
        if (videoElement) {
            const videoTag = videoElement.querySelector('video');
            if (videoTag && videoTag.srcObject !== matchingParticipant.stream) {
                console.log('Updating video source for participant:', matchingParticipant.username);
                videoTag.srcObject = matchingParticipant.stream;
            }
        }
    } else {
        console.log('No matching participant found for track, waiting for participant info');
    }
}

function addVideoStream(id, username, stream) {
    // Remove existing video element if it exists
    const existingVideo = document.getElementById(`video-${id}`);
    if (existingVideo) {
        existingVideo.remove();
    }

    console.log('Adding video stream:', { id, username, streamId: stream.id });
    
    // Create and setup video element
    const videoWrapper = document.createElement('div');
    videoWrapper.className = 'video-wrapper';
    videoWrapper.id = `video-${id}`;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    
    // Add error handling
    video.onerror = (e) => {
        console.error('Video error:', e);
    };
    
    video.onloadedmetadata = () => {
        console.log(`Video metadata loaded for ${username}`);
        video.play().catch(e => console.error('Error playing video:', e));
    };

    try {
        video.srcObject = stream;
    } catch (e) {
        console.error('Error setting srcObject:', e);
        return;
    }

    if (id === 'local') {
        video.muted = true;
    }

    const nameTag = document.createElement('div');
    nameTag.className = 'participant-name';
    nameTag.textContent = username;

    videoWrapper.appendChild(video);
    videoWrapper.appendChild(nameTag);
    
    // Add to video grid
    const videoGrid = document.getElementById('videoGrid');
    if (videoGrid) {
        videoGrid.appendChild(videoWrapper);
        console.log('Video element added to grid for:', username);
    }
    
    // Add or update participant in the participants map if not local user
    if (id !== 'local') {
        participants.set(id, {
            username: username,
            stream: stream,
            sessionId: id
        });
    }

    // Update both layouts
    updateGridLayout();
    updateParticipantsList();

    console.log('Updated participants after adding video:', Array.from(participants.entries()));
}

// Update the updateParticipantsList function to be more reliable
function updateParticipantsList() {
    const participantsList = document.getElementById('participantsList');
    if (!participantsList) {
        console.error('Participants list element not found');
        return;
    }

    // Clear current list
    participantsList.innerHTML = '';
    
    // Add local user first
    const localLi = document.createElement('li');
    localLi.textContent = `${username} (You)`;
    participantsList.appendChild(localLi);
    
    // Sort participants by username for consistent ordering
    const sortedParticipants = Array.from(participants.entries())
        .sort((a, b) => a[1].username.localeCompare(b[1].username));
    
    // Add remote participants
    for (const [sessionId, participant] of sortedParticipants) {
        if (participant.username !== username) {
            const li = document.createElement('li');
            li.textContent = participant.username;
            li.setAttribute('data-session-id', sessionId);
            participantsList.appendChild(li);
        }
    }

    console.log('Participants list updated with', participants.size + 1, 'participants');
}

async function updateParticipants(meetingInfo) {
    if (!meetingInfo || !meetingInfo.sessions) {
        console.warn('Invalid meeting info:', meetingInfo);
        return;
    }

    console.log('Current participants:', Array.from(participants.entries()));
    console.log('Updating with new sessions:', meetingInfo.sessions);

    // Create a set of current session IDs for removal tracking
    const currentSessionIds = new Set(participants.keys());
    
    // Process each session from the meeting info
    for (const session of meetingInfo.sessions) {
        // Skip local user
        if (session.username === username) {
            currentSessionIds.delete(session.session_id);
            continue;
        }

        // Update or add participant
        if (!participants.has(session.session_id)) {
            // New participant
            console.log('Adding new participant:', session.username);
            participants.set(session.session_id, {
                username: session.username,
                stream: null,
                sessionId: session.session_id
            });
        } else {
            // Existing participant - update info
            console.log('Updating existing participant:', session.username);
            const existingParticipant = participants.get(session.session_id);
            existingParticipant.username = session.username;
        }

        // Remove from tracking set since we've processed it
        currentSessionIds.delete(session.session_id);
    }

    // Remove participants that are no longer in the meeting
    for (const sessionId of currentSessionIds) {
        console.log('Removing participant with session ID:', sessionId);
        removeParticipant(sessionId);
    }

    // Update the UI
    updateParticipantsList();
    updateGridLayout();

    console.log('Updated participants map:', Array.from(participants.entries()));
}

function updateParticipantsList() {
    const participantsList = document.getElementById('participantsList');
    if (!participantsList) {
        console.error('Participants list element not found');
        return;
    }

    console.log('Updating participants list UI');
    participantsList.innerHTML = '';
    
    // Add local user
    const localLi = document.createElement('li');
    localLi.textContent = `${username} (You)`;
    participantsList.appendChild(localLi);
    
    // Add all remote participants
    for (const [_, participant] of participants) {
        if (participant.username !== username) {
            const li = document.createElement('li');
            li.textContent = participant.username;
            participantsList.appendChild(li);
        }
    }

    console.log('Participants list updated with', participants.size + 1, 'participants');
}

async function pullParticipantTracks(tracks, participant) {
    const maxRetries = 5;
    const baseDelay = 1000; // Start with 1 second delay

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // Kiểm tra nếu participant đã có stream
            if (participants.get(participant.session_id)?.stream) {
                console.log('Participant already has stream:', participant.username);
                return;
            }

            console.log(`Pulling tracks attempt ${attempt + 1}/${maxRetries} for participant:`, participant.username, tracks);
            
            // Rest of the existing pullParticipantTracks code...
            const localSessionId = localPeerConnection.sessionId;

            if (localPeerConnection.connectionState === 'failed') {
                console.log('Connection failed, attempting to restart...');
                const offer = await localPeerConnection.createOffer({ iceRestart: true });
                await localPeerConnection.setLocalDescription(offer);
            }

            // Set up track reception promise
            const receivedTracksPromise = new Promise((resolve, reject) => {
                // ...existing promise setup code...
                const receivedTracks = new Map();
                const timeout = setTimeout(() => {
                    if (receivedTracks.size === 0) {
                        reject(new Error("Track reception timeout"));
                    } else {
                        resolve(Array.from(receivedTracks.values()));
                    }
                }, 15000);

                const trackHandler = (event) => {
                    const track = event.track;
                    console.log("Received track:", track.kind, track.id);
                    
                    // Check if this track belongs to the participant we're pulling for
                    if (event.streams[0]) {
                        receivedTracks.set(track.id, track);

                        if (receivedTracks.size >= tracks.length) {
                            clearTimeout(timeout);
                            resolve(Array.from(receivedTracks.values()));
                        }
                    }

                    // Add track removal handler
                    if (event.streams && event.streams[0]) {
                        event.streams[0].onremovetrack = () => {
                            console.log('Track removed:', track.id);
                            const participant = Array.from(participants.entries())
                                .find(([_, p]) => p.stream?.id === event.streams[0].id);
                            if (participant) {
                                console.log('Removing track from participant:', participant[1].username);
                            }
                        };
                    }
                };

                localPeerConnection.addEventListener('track', trackHandler);
                setTimeout(() => {
                    localPeerConnection.removeEventListener('track', trackHandler);
                }, 15000);
            });

            // Pull remote tracks
            console.log('Sending pull tracks request for:', participant.username);
            const pullResponse = await fetch(
                `https://rtc.live.cloudflare.com/v1/apps/${APP_ID}/sessions/${localSessionId}/tracks/new`,
                {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${APP_TOKEN}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        tracks: tracks.map(track => ({
                            location: "remote",
                            sessionId: participant.session_id,
                            trackName: track.trackName
                        }))
                    })
                }
            );

            if (!pullResponse.ok) {
                throw new Error(`Failed to pull tracks: ${pullResponse.status}`);
            }

            // If successful, process the response and return
            const pullData = await pullResponse.json();
            console.log('Pull response for', participant.username, ':', pullData);

            if (pullData.requiresImmediateRenegotiation) {
                console.log('Renegotiation required for:', participant.username);
                await handleRenegotiation(pullData, localPeerConnection);
            }

            const receivedTracks = await receivedTracksPromise;
            if (receivedTracks.length > 0) {
                // Process received tracks...
                const existingVideo = document.getElementById(`video-${participant.session_id}`);
                if (existingVideo) {
                    existingVideo.remove();
                }

                const remoteStream = new MediaStream();
                receivedTracks.forEach(track => {
                    console.log('Adding track to stream:', track.kind, track.id);
                    remoteStream.addTrack(track);
                });

                participants.set(participant.session_id, {
                    ...participants.get(participant.session_id),
                    stream: remoteStream
                });

                addVideoStream(participant.session_id, participant.username, remoteStream);
            }

            // If we get here, we succeeded, so break the retry loop
            return;

        } catch (err) {
            console.error(`Attempt ${attempt + 1} failed for ${participant.username}:`, err);
            
            // Calculate exponential backoff delay with jitter
            const delay = Math.min(baseDelay * Math.pow(2, attempt) * (1 + Math.random() * 0.1), 10000);
            
            // If this was our last attempt, throw the error
            if (attempt === maxRetries - 1) {
                throw err;
            }
            
            // If we get specific errors that we want to retry
            if (err.message.includes("500") || 
                err.message.includes("Session is not ready") || 
                err.message.includes("Track reception timeout") ||
                err.message.includes("Invalid state")) {
                    
                console.log(`Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            // For other types of errors, throw immediately
            throw err;
        }
    }
}

async function handleRenegotiation(pullData, peerConnection) {
    try {
        console.log('Starting renegotiation with data:', pullData);
        
        // Check if connection is closed or failing
        if (peerConnection.connectionState === 'closed' || peerConnection.connectionState === 'failed') {
            console.log('Connection is closed/failed, creating new connection...');
            await setupCloudflareRTC(peerConnection.sessionId);
            return;
        }

        // Wait for stable state with timeout
        await waitForSignalingState(peerConnection, 'stable', 5000);
        
        try {
            await peerConnection.setRemoteDescription(
                new RTCSessionDescription(pullData.sessionDescription)
            );

            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            const renegotiateResponse = await fetch(
                `https://rtc.live.cloudflare.com/v1/apps/${APP_ID}/sessions/${peerConnection.sessionId}/renegotiate`,
                {
                    method: "PUT",
                    headers: {
                        "Authorization": `Bearer ${APP_TOKEN}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        sessionDescription: {
                            sdp: answer.sdp,
                            type: "answer"
                        }
                    })
                }
            );

            if (!renegotiateResponse.ok) {
                throw new Error(`Renegotiation failed: ${renegotiateResponse.status}`);
            }

        } catch (error) {
            console.error('Error during renegotiation:', error);
            if (error.name === 'InvalidStateError') {
                // If we get invalid state, try recreating the connection
                await setupCloudflareRTC(peerConnection.sessionId);
            }
            throw error;
        }
    } catch (error) {
        console.error('Renegotiation error:', error);
        throw error;
    }
}

// Add new utility function to wait for signaling state
function waitForSignalingState(peerConnection, desiredState, timeout) {
    return new Promise((resolve, reject) => {
        if (peerConnection.signalingState === desiredState) {
            resolve();
            return;
        }

        const timer = setTimeout(() => {
            peerConnection.removeEventListener('signalingstatechange', checkState);
            reject(new Error('Signaling state timeout'));
        }, timeout);

        function checkState() {
            if (peerConnection.signalingState === desiredState) {
                clearTimeout(timer);
                peerConnection.removeEventListener('signalingstatechange', checkState);
                resolve();
            }
        }

        peerConnection.addEventListener('signalingstatechange', checkState);
    });
}

function handleParticipantLeft(data) {
    console.log('Participant left:', data);
    
    // Find the participant by username
    let sessionIdToRemove = null;
    for (const [sessionId, participant] of participants) {
        if (participant.username === data.username) {
            sessionIdToRemove = sessionId;
            break;
        }
    }

    if (sessionIdToRemove) {
        removeParticipant(sessionIdToRemove);
    }
}

function removeParticipant(sessionId) {
    const participant = participants.get(sessionId);
    if (!participant) return;

    // Get video element
    const videoElement = document.getElementById(`video-${sessionId}`);
    if (videoElement) {
        // Add animation class
        videoElement.classList.add('removing');

        // Wait for animation to complete before removing
        setTimeout(() => {
            const video = videoElement.querySelector('video');
            if (video) {
                video.srcObject = null;
            }
            videoElement.remove();
            
            // Update layout after removal
            updateGridLayout();
        }, 300); // Match transition duration in CSS
    }

    // Stop all tracks in participant's stream
    if (participant.stream) {
        participant.stream.getTracks().forEach(track => {
            track.stop();
            track.enabled = false;
        });
    }

    // Remove from participants map
    participants.delete(sessionId);

    // Update UI
    updateParticipantsList();
    console.log('Participant removed:', sessionId);
}

// Control handlers
document.getElementById('toggleMicBtn').onclick = () => {
    const audioTrack = localStream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;
    updateControls();
};

document.getElementById('toggleVideoBtn').onclick = () => {
    const videoTrack = localStream.getVideoTracks()[0];
    videoTrack.enabled = !videoTrack.enabled;
    updateControls();
};

// Add new constant for screen share identifier
const SCREEN_SHARE_PREFIX = 'screen_';

document.getElementById('shareScreenBtn').onclick = async () => {
    try {
        // Check if already sharing
        const existingScreenShare = Array.from(participants.entries())
            .find(([id, _]) => id.startsWith(SCREEN_SHARE_PREFIX));
        
        if (existingScreenShare) {
            // Stop existing screen share
            await stopScreenSharing(existingScreenShare[0]);
            return;
        }

        // Start new screen share
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false
        });

        // Create unique ID for screen share participant
        const screenShareId = SCREEN_SHARE_PREFIX + username;

        // Create screen share participant
        const screenParticipant = {
            username: `${username}'s Screen`,
            stream: screenStream,
            sessionId: screenShareId,
            isScreenShare: true
        };

        // Add to participants map
        participants.set(screenShareId, screenParticipant);

        // Add video element for screen share
        addVideoStream(screenShareId, `${username}'s Screen`, screenStream);

        // Handle stream ending
        screenStream.getVideoTracks()[0].onended = () => {
            stopScreenSharing(screenShareId);
        };

        // Update button state
        const shareBtn = document.getElementById('shareScreenBtn');
        shareBtn.querySelector('.material-icons').textContent = 'stop_screen_share';
        shareBtn.classList.add('active');

    } catch (error) {
        console.error('Error sharing screen:', error);
    }
};

// Add new function to handle stopping screen share
async function stopScreenSharing(screenShareId) {
    const participant = participants.get(screenShareId);
    if (!participant) return;

    // Stop all tracks
    participant.stream.getTracks().forEach(track => {
        track.stop();
    });

    // Remove participant
    removeParticipant(screenShareId);

    // Reset share button
    const shareBtn = document.getElementById('shareScreenBtn');
    shareBtn.querySelector('.material-icons').textContent = 'screen_share';
    shareBtn.classList.remove('active');
}

// Update removeParticipant function to handle screen shares
function removeParticipant(sessionId) {
    const participant = participants.get(sessionId);
    if (!participant) return;

    // Get video element
    const videoElement = document.getElementById(`video-${sessionId}`);
    if (videoElement) {
        // Add animation class
        videoElement.classList.add('removing');

        // Wait for animation to complete before removing
        setTimeout(() => {
            const video = videoElement.querySelector('video');
            if (video) {
                video.srcObject = null;
            }
            videoElement.remove();
            
            // Update layout after removal
            updateGridLayout();
        }, 300);
    }

    // Stop all tracks in participant's stream
    if (participant.stream) {
        participant.stream.getTracks().forEach(track => {
            track.stop();
            track.enabled = false;
        });
    }

    // If this is a screen share, reset the share button
    if (sessionId.startsWith(SCREEN_SHARE_PREFIX)) {
        const shareBtn = document.getElementById('shareScreenBtn');
        shareBtn.querySelector('.material-icons').textContent = 'screen_share';
        shareBtn.classList.remove('active');
    }

    // Remove from participants map
    participants.delete(sessionId);

    // Update UI
    updateParticipantsList();
    console.log('Participant removed:', sessionId);
}

// Update updateParticipantsList to handle screen shares
function updateParticipantsList() {
    const participantsList = document.getElementById('participantsList');
    if (!participantsList) return;

    participantsList.innerHTML = '';
    
    // Add local user first
    const localLi = document.createElement('li');
    localLi.textContent = `${username} (You)`;
    participantsList.appendChild(localLi);
    
    // Add remote participants and screen shares
    for (const [sessionId, participant] of participants) {
        // Skip if it's the local user
        if (participant.username === username && !sessionId.startsWith(SCREEN_SHARE_PREFIX)) continue;

        const li = document.createElement('li');
        li.textContent = participant.username;
        if (participant.isScreenShare) {
            li.classList.add('screen-share-participant');
        }
        li.setAttribute('data-session-id', sessionId);
        participantsList.appendChild(li);
    }
}

document.getElementById('leaveBtn').onclick = async () => {
    try {
        if (ws) {
            ws.close();
        }
        if (localPeerConnection) {
            localPeerConnection.close();
        }
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Error leaving meeting:', error);
    }
};

function updateControls() {
    const micBtn = document.getElementById('toggleMicBtn');
    const videoBtn = document.getElementById('toggleVideoBtn');
    
    const audioTrack = localStream.getAudioTracks()[0];
    const videoTrack = localStream.getVideoTracks()[0];
    
    micBtn.querySelector('.material-icons').textContent = audioTrack.enabled ? 'mic' : 'mic_off';
    videoBtn.querySelector('.material-icons').textContent = videoTrack.enabled ? 'videocam' : 'videocam_off';
    
    micBtn.classList.toggle('active', !audioTrack.enabled);
    videoBtn.classList.toggle('active', !videoTrack.enabled);
}

// Add this function to update grid layout based on participant count
function updateGridLayout() {
    const grid = document.getElementById('videoGrid');
    const participantCount = participants.size + 1; // +1 for local user
    
    // Remove all existing layout classes
    grid.classList.remove(
        'single-participant',
        'two-participants',
        'few-participants',
        'many-participants'
    );

    // Add appropriate layout class based on participant count
    if (participantCount === 1) {
        grid.classList.add('single-participant');
    } else if (participantCount === 2) {
        grid.classList.add('two-participants');
    } else if (participantCount <= 4) {
        grid.classList.add('few-participants');
    } else {
        grid.classList.add('many-participants');
    }

    // Force grid reflow for smoother transitions
    grid.style.display = 'none';
    grid.offsetHeight; // Trigger reflow
    grid.style.display = 'grid';
}

// Add this helper function to verify stream mappings
function verifyStreamMappings() {
    console.log('Verifying stream mappings:');
    for (const [sessionId, participant] of participants) {
        const videoElement = document.getElementById(`video-${sessionId}`);
        if (videoElement) {
            const videoTag = videoElement.querySelector('video');
            console.log('Participant:', participant.username, {
                sessionId,
                hasStream: !!participant.stream,
                streamId: participant.stream?.id,
                videoSrcObject: videoTag?.srcObject?.id,
                matches: videoTag?.srcObject === participant.stream
            });
        }
    }
}

// Call this periodically or after significant events
setInterval(verifyStreamMappings, 10000);

// Initialize the room
initializeRoom();