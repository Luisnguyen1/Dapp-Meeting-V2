// Add utility function to escape HTML
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

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

// Add at the top with other global variables
let faceMaskFilter = null;
let processedStream = null;

// Add after other global variables
let currentMask = 'default.png';
let masksList = [];

async function initializeRoom() {
    try {
        await loadAvailableMasks();
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

        // Initialize face mask filter
        const maskCanvas = document.getElementById('maskCanvas');
        const maskImage = document.getElementById('maskImage');
        faceMaskFilter = new FaceMaskFilter(
            document.createElement('video'), // Create temporary video element
            maskCanvas,
            maskImage
        );
        await faceMaskFilter.initialize();

        // Create processed stream from canvas
        processedStream = maskCanvas.captureStream();
        // Add audio track from original stream
        localStream.getAudioTracks().forEach(track => {
            processedStream.addTrack(track);
        });

        // Setup audio detection after stream is initialized
        setupAudioDetection();

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
            // Only check existing stream for non-screen share participants
            if (!participant.isScreenShare && participants.get(participant.session_id)?.stream) {
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
        if (ws) {
            // Properly close existing connection if any
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close(1000, 'Intentional close for reconnection');
            }
        }

        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsBaseUrl = isLocalhost
            ? 'localhost:7860'
            : 'manhteky123-dapp-meeting.hf.space';
        const wsUrl = `${wsProtocol}//${wsBaseUrl}/ws/meetings/${roomId}?username=${encodeURIComponent(username)}`;
        
        console.log('Connecting to WebSocket:', wsUrl);
        
        ws = new WebSocket(wsUrl);

        // Add connection timeout
        const connectionTimeout = setTimeout(() => {
            if (ws.readyState !== WebSocket.OPEN) {
                ws.close();
                throw new Error('WebSocket connection timeout');
            }
        }, 15000);

        await new Promise((resolve, reject) => {
            ws.onopen = () => {
                clearTimeout(connectionTimeout);
                console.log('WebSocket connected successfully');
                resolve();
            };

            ws.onerror = (error) => {
                clearTimeout(connectionTimeout);
                console.error('WebSocket error:', error);
                reject(error);
            };

            ws.onclose = (event) => {
                clearTimeout(connectionTimeout);
                console.log('WebSocket closed:', {
                    code: event.code,
                    reason: event.reason,
                    wasClean: event.wasClean,
                    timestamp: new Date().toISOString()
                });

                // Only attempt to reconnect on abnormal closure
                if (event.code === 1006) {
                    console.log('Abnormal closure detected, attempting to reconnect...');
                    setTimeout(() => {
                        if (!ws || ws.readyState === WebSocket.CLOSED) {
                            setupWebSocket().catch(err => {
                                console.error('Reconnection failed:', err);
                            });
                        }
                    }, 3000);
                }
            };

            // Setup message handler
            ws.onmessage = (event) => {
                try {
                    const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
                    if (data === 'ping') {
                        ws.send('pong');
                        return;
                    }
                    handleWebSocketMessage(data);
                } catch (e) {
                    console.warn('Error handling WebSocket message:', e);
                    console.warn('Received invalid message:', event.data);
                }
            };
        });

        // Setup periodic ping to keep connection alive
        const pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                safeSendWebSocketMessage({ type: 'ping' }).catch(err => {
                    console.error('Failed to send ping:', err);
                });
            } else {
                clearInterval(pingInterval);
            }
        }, 30000);

    } catch (error) {
        console.error('Error setting up WebSocket:', error);
        throw error;
    }
}

// Update handleWebSocketMessage function
function handleWebSocketMessage(message) {
    console.log('WebSocket message received:', message);

    if (['participant_joined', 'participant_left', 'tracks_ready', 'wave'].includes(message.type)) {
        showNotification(message.type, message.payload);
    }

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
        case 'wave':
            handleWaveNotification(message.payload);
            break;
        case 'speaking_state':
            handleSpeakingState(message.payload);
            break;
    }
}

// Update wave notification handler
function handleWaveNotification(data) {
    console.log('Wave notification received:', data);
    // showNotification('wave', data);
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
        const isScreenShare = data.username.endsWith('_screen');
        const sessionState = await fetch(
            `https://rtc.live.cloudflare.com/v1/apps/${APP_ID}/sessions/${data.session_id}`, {
            headers: {
                "Authorization": `Bearer ${APP_TOKEN}`
            }
        }).then(res => res.json());

        if (sessionState.tracks && sessionState.tracks.length > 0) {
            const activeTracks = sessionState.tracks.filter(track => track.status === 'active');
            if (activeTracks.length > 0) {
                // Force update stream if it's screen share
                if (isScreenShare) {
                    const participant = participants.get(data.session_id);
                    if (participant) {
                        // Reset stream to force new pull
                        participant.stream = null;
                    }
                }

                await pullParticipantTracks(activeTracks, {
                    session_id: data.session_id,
                    username: data.username,
                    isScreenShare: isScreenShare
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
            const streamToUse = isMaskEnabled ? processedStream : localStream;
            const transceivers = streamToUse.getTracks().map(track =>
                localPeerConnection.addTransceiver(track, {
                    direction: 'sendonly',
                    streams: [streamToUse]
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

        // Setup audio detection if this is an audio track
        if (event.track.kind === 'audio') {
            setupRemoteAudioDetection(matchingParticipant.stream, matchingParticipant.sessionId);
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
    
    // Special handling for screen share video
    if (username.endsWith('_screen')) {
        video.style.objectFit = 'contain'; // Better for screen sharing
        videoWrapper.classList.add('screen-share');
    }

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
            // Only check existing stream for non-screen share participants
            if (!participant.isScreenShare && participants.get(participant.session_id)?.stream) {
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

                // Update participant with new stream
                const existingParticipant = participants.get(participant.session_id);
                if (existingParticipant) {
                    // Stop old stream tracks if they exist
                    if (existingParticipant.stream) {
                        existingParticipant.stream.getTracks().forEach(track => track.stop());
                    }
                    existingParticipant.stream = remoteStream;
                } else {
                    participants.set(participant.session_id, {
                        username: participant.username,
                        stream: remoteStream,
                        sessionId: participant.session_id,
                        isScreenShare: participant.isScreenShare
                    });
                }

                // Always add/update video element for screen shares
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
    console.log('Handling participant left:', data);
    
    if (data.session_id) {
        // Direct removal using session_id 
        removeParticipant(data.session_id);
    } else if (data.username) {
        // Find session_id by username if session_id not provided
        const participantEntry = Array.from(participants.entries())
            .find(([_, p]) => p.username === data.username);
            
        if (participantEntry) {
            const [sessionId, participant] = participantEntry;
            console.log('Found session ID for leaving user:', sessionId);
            removeParticipant(sessionId);
            
            // Also check and remove any associated screen share
            const screenShareEntry = Array.from(participants.entries())
                .find(([_, p]) => p.username === `${data.username}_screen`);
                
            if (screenShareEntry) {
                removeParticipant(screenShareEntry[0]);
            }
        } else {
            console.warn('Could not find participant with username:', data.username);
        }
    } else {
        console.error('Invalid participant_left payload:', data);
    }
}

function removeParticipant(sessionId) {
    const participant = participants.get(sessionId);
    if (!participant) {
        console.log('Participant not found for removal:', sessionId);
        return;
    }

    console.log('Removing participant:', sessionId, participant.username);

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
        participant.stream = null; // Clear stream reference
    }

    // Clean up peer connection if it exists
    if (participant.peerConnection) {
        participant.peerConnection.close();
        participant.peerConnection = null;
    }

    // Remove from participants map
    participants.delete(sessionId);

    // Update UI
    updateParticipantsList();
    updateGridLayout();
    
    console.log('Participant removed successfully:', sessionId);
    console.log('Remaining participants:', Array.from(participants.keys()));
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
const SCREEN_SHARE_PREFIX = '_screen';

document.getElementById('shareScreenBtn').onclick = async () => {
    try {
        const existingScreenShare = [...participants.values()].some(obj => obj.username?.endsWith("_screen"));
        if (existingScreenShare) {
            const screenShareParticipant = Array.from(participants.entries())
                .find(([_, obj]) => obj.username === `${username}_screen`);
            
            if (screenShareParticipant) {
                const [sessionId, participant] = screenShareParticipant;
                
                // Dừng streams và đóng kết nối trước
                if (participant.stream) {
                    participant.stream.getTracks().forEach(track => {
                        track.stop();
                        participant.stream.removeTrack(track);
                    });
                }
                if (participant.peerConnection) {
                    participant.peerConnection.getSenders().forEach(sender => {
                        if (sender.track) {
                            sender.track.stop();
                            participant.peerConnection.removeTrack(sender);
                        }
                    });
                    participant.peerConnection.close();
                }

                // Gửi WebSocket message trước khi xóa
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'participant_left',
                        payload: {
                            session_id: sessionId,
                            username: `${username}_screen`
                        }
                    }));

                    // Đợi một chút để đảm bảo message được gửi
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                // Sau đó mới xóa khỏi local state
                removeParticipant(sessionId);
                
                // Reset button state
                const shareBtn = document.getElementById('shareScreenBtn');
                shareBtn.querySelector('.material-icons').textContent = 'screen_share';
                shareBtn.classList.remove('active');
                return;
            }
            alert("Another participant is already sharing their screen");
            return;
        }

        // Start new screen share
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false
        });

        // Create screen share username
        const screenShareUsername = `${username}_screen`;

        // Join meeting as new participant for screen share
        const joinResponse = await fetch(
            `${API_BASE}/meetings/${roomId}?username=${encodeURIComponent(screenShareUsername)}`,
            {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Origin': window.location.origin
                },
                credentials: 'include'
            }
        );

        if (!joinResponse.ok) {
            throw new Error('Failed to create screen share session');
        }

        // Get session ID for screen share
        const screenSession = await joinResponse.json();
        const screenSessionId = screenSession.session_id;

        // Create peer connection and setup WebRTC for screen share
        await setupScreenShare(screenSessionId, screenStream);

        // Handle stream ending
        screenStream.getVideoTracks()[0].onended = async () => {
            try {
                await fetch(`${API_BASE}/meetings/${roomId}/leave`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        session_id: screenSessionId
                    })
                });
                // WebSocket will handle cleanup via participant_left event
            } catch (err) {
                console.error('Error handling screen share end:', err);
            }
        };

        // Update button state
        const shareBtn = document.getElementById('shareScreenBtn');
        shareBtn.querySelector('.material-icons').textContent = 'stop_screen_share';
        shareBtn.classList.add('active');

    } catch (error) {
        console.error('Error sharing screen:', error);
        alert('Failed to share screen: ' + error.message);
    }
};

async function setupScreenShare(sessionId, screenStream) {
    // Create new peer connection for screen share
    const screenPeerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
        bundlePolicy: 'max-bundle'
    });

    screenPeerConnection.sessionId = sessionId;

    // Add screen track to peer connection
    const screenTrack = screenStream.getVideoTracks()[0];
    const transceiver = screenPeerConnection.addTransceiver(screenTrack, {
        direction: 'sendonly',
        streams: [screenStream]
    });

    // Create and send offer
    const offer = await screenPeerConnection.createOffer();
    await screenPeerConnection.setLocalDescription(offer);

    // Send tracks to Cloudflare
    const cloudflareResponse = await fetch(
        `https://rtc.live.cloudflare.com/v1/apps/${APP_ID}/sessions/${sessionId}/tracks/new`,
        {
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
                tracks: [{
                    location: 'local',
                    mid: transceiver.mid,
                    trackName: screenTrack.id
                }]
            })
        }
    );

    if (!cloudflareResponse.ok) {
        throw new Error('Failed to setup screen share tracks');
    }

    const data = await cloudflareResponse.json();
    await screenPeerConnection.setRemoteDescription(
        new RTCSessionDescription(data.sessionDescription)
    );

    // Add to participants map
    participants.set(sessionId, {
        username: `${username}'s Screen`,
        stream: screenStream,
        sessionId: sessionId,
        isScreenShare: true,
        peerConnection: screenPeerConnection
    });

    // Notify that tracks are ready
    await fetch(`${API_BASE}/meetings/${roomId}/notify-tracks-ready`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            session_id: sessionId,
            username: `${username}_screen`
        })
    });

    // Update stream end handler
    screenStream.getVideoTracks()[0].onended = () => {
        handleScreenShareEnd(sessionId, screenStream, screenPeerConnection);
    };

    // Add track ended listener for each track
    screenStream.getTracks().forEach(track => {
        track.addEventListener('ended', () => {
            handleScreenShareEnd(sessionId, screenStream, screenPeerConnection);
        });
    });
}

// Add new helper function to handle screen share cleanup
async function handleScreenShareEnd(sessionId, stream, peerConnection) {
    try {
        // Dừng streams và đóng kết nối trước
        if (stream) {
            stream.getTracks().forEach(track => {
                track.stop();
                stream.removeTrack(track);
            });
        }
        
        if (peerConnection) {
            peerConnection.getSenders().forEach(sender => {
                if (sender.track) {
                    sender.track.stop();
                    peerConnection.removeTrack(sender);
                }
            });
            peerConnection.close();
        }

        // Gửi WebSocket message trước khi xóa
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'participant_left',
                payload: {
                    session_id: sessionId,
                    username: `${username}_screen`
                }
            }));

            // Đợi một chút để đảm bảo message được gửi
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Sau đó mới xóa video element và local state
        const videoElement = document.getElementById(`video-${sessionId}`);
        if (videoElement) {
            const video = videoElement.querySelector('video');
            if (video) {
                video.srcObject = null;
                video.load();
            }
            videoElement.remove();
        }

        removeParticipant(sessionId);

        // Reset button state
        const shareBtn = document.getElementById('shareScreenBtn');
        shareBtn.querySelector('.material-icons').textContent = 'screen_share';
        shareBtn.classList.remove('active');

        // Force update layout
        updateGridLayout();
    } catch (err) {
        console.error('Error handling screen share end:', err);
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

// Add after localStream initialization in initializeRoom()
function setupAudioDetection() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const analyzer = audioContext.createAnalyser();
        const microphone = audioContext.createMediaStreamSource(localStream);
        const scriptProcessor = audioContext.createScriptProcessor(2048, 1, 1);
        
        analyzer.smoothingTimeConstant = 0.3; // Make it more responsive
        analyzer.fftSize = 1024;

        microphone.connect(analyzer);
        analyzer.connect(scriptProcessor);
        scriptProcessor.connect(audioContext.destination);

        const speakingThreshold = -30; // Lower threshold to detect more subtle sounds
        let speakingIndicatorTimeout;
        let lastSpeakingState = false; // Track speaking state

        scriptProcessor.onaudioprocess = function() {
            const array = new Uint8Array(analyzer.frequencyBinCount);
            analyzer.getByteFrequencyData(array);
            const arrayAverage = array.reduce((a, value) => a + value, 0) / array.length;
            const volume = 20 * Math.log10(arrayAverage / 255);
            
            const isSpeaking = volume > speakingThreshold;
            
            // Only send update when speaking state changes
            if (isSpeaking !== lastSpeakingState) {
                lastSpeakingState = isSpeaking;
                
                // Send speaking state update via WebSocket
                if (ws && ws.readyState === WebSocket.OPEN) {
                    safeSendWebSocketMessage({
                        type: 'speaking_state',
                        payload: {
                            username: username,
                            isSpeaking: isSpeaking
                        }
                    });
                }
            }

            const localVideo = document.getElementById('video-local');
            if (localVideo) {
                if (isSpeaking) {
                    if (!localVideo.classList.contains('speaking')) {
                        localVideo.classList.add('speaking');
                    }
                    clearTimeout(speakingIndicatorTimeout);
                } else {
                    speakingIndicatorTimeout = setTimeout(() => {
                        localVideo.classList.remove('speaking');
                    }, 300); // Shorter timeout for more responsive UI
                }
            }
        };
    } catch (error) {
        console.error('Error setting up audio detection:', error);
    }
}

function setupRemoteAudioDetection(stream, sessionId) {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const analyzer = audioContext.createAnalyser();
        const microphone = audioContext.createMediaStreamSource(stream);
        const scriptProcessor = audioContext.createScriptProcessor(2048, 1, 1);
        
        analyzer.smoothingTimeConstant = 0.3; // Make it more responsive
        analyzer.fftSize = 1024;

        microphone.connect(analyzer);
        analyzer.connect(scriptProcessor);
        scriptProcessor.connect(audioContext.destination);

        const speakingThreshold = -30; // Lower threshold to detect more subtle sounds
        let speakingIndicatorTimeout;

        scriptProcessor.onaudioprocess = function() {
            const array = new Uint8Array(analyzer.frequencyBinCount);
            analyzer.getByteFrequencyData(array);
            const arrayAverage = array.reduce((a, value) => a + value, 0) / array.length;
            const volume = 20 * Math.log10(arrayAverage / 255);
            
            const videoElement = document.getElementById(`video-${sessionId}`);
            if (videoElement) {
                if (volume > speakingThreshold) {
                    if (!videoElement.classList.contains('speaking')) {
                        videoElement.classList.add('speaking');
                    }
                    clearTimeout(speakingIndicatorTimeout);
                    speakingIndicatorTimeout = setTimeout(() => {
                        videoElement.classList.remove('speaking');
                    }, 300); // Shorter timeout for more responsive UI
                }
            }
        };
    } catch (error) {
        console.error('Error setting up remote audio detection:', error);
    }
}

// Add after other control handlers
document.getElementById('waveBtn').onclick = () => {
    if (!ws) {
        console.error('WebSocket connection not initialized, attempting to reconnect...');
        setupWebSocket().catch(err => {
            console.error('Failed to reconnect WebSocket:', err);
        });
        return;
    }

    // Check WebSocket state
    if (ws.readyState !== WebSocket.OPEN) {
        console.log('WebSocket is not open, current state:', ws.readyState);
        return;
    }

    try {
        // Add message type validation
        const waveMessage = {
            type: 'wave',
            payload: {
                username: username,
                timestamp: new Date().toISOString()
            }
        };

        // Use a safe send method
        safeSendWebSocketMessage(waveMessage);

    } catch (error) {
        console.error('Error sending wave message:', error);
    }
};

// Add new utility function for safe WebSocket sending
function safeSendWebSocketMessage(message) {
    return new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            reject(new Error('WebSocket is not connected'));
            return;
        }

        try {
            const messageString = JSON.stringify(message);
            ws.send(messageString);
            console.log('Message sent successfully:', messageString);
            resolve();
        } catch (error) {
            console.error('Error sending message:', error);
            reject(error);
        }
    });
}

// Update showNotification function
function showNotification(type, data) {
    // Check if notifications container exists
    let notificationsContainer = document.getElementById('notificationsContainer');
    if (!notificationsContainer) {
        notificationsContainer = document.createElement('div');
        notificationsContainer.id = 'notificationsContainer';
        notificationsContainer.className = 'notifications-container';
        document.body.appendChild(notificationsContainer);
    }

    const notification = document.createElement('div');
    notification.className = 'notification';
    
    // Add different text for own notifications
    const isOwnAction = data.username === username;
    
    let content = '';
    switch (type) {
        case 'wave':
            notification.classList.add('wave');
            content = `
                <span class="material-icons">👋</span>
                <div class="notification-content">
                    <span class="notification-username">${isOwnAction ? 'You' : escapeHtml(data.username)}</span>
                    <span>${isOwnAction ? 'waved' : 'is waving'}</span>
                </div>
            `;
            break;
        case 'participant_joined':
            notification.classList.add('join');
            content = `
                <span class="material-icons">person_add</span>
                <div class="notification-content">
                    <span class="notification-username">${escapeHtml(data.username)}</span>
                    <span>joined the meeting</span>
                </div>
            `;
            break;
        case 'participant_left':
            notification.classList.add('leave');
            content = `
                <span class="material-icons">person_remove</span>
                <div class="notification-content">
                    <span class="notification-username">${escapeHtml(data.username)}</span>
                    <span>left the meeting</span>
                </div>
            `;
            break;
        case 'tracks_ready':
            notification.classList.add('media');
            content = `
                <span class="material-icons">videocam</span>
                <div class="notification-content">
                    <span class="notification-username">${escapeHtml(data.username)}</span>
                    <span>turned on their media</span>
                </div>
            `;
            break;
    }

    notification.innerHTML = content;
    notificationsContainer.appendChild(notification);
    console.log('Notification added:', type, data); // Debug log

    // Remove notification after 5 seconds with animation
    setTimeout(() => {
        notification.classList.add('removing');
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 300); // Match animation duration
    }, 5000);
}

// Add new function to handle speaking state updates
function handleSpeakingState(data) {
    // Find video element for the speaker
    let videoElement;
    if (data.username === username) {
        videoElement = document.getElementById('video-local');
    } else {
        // Find participant session ID by username
        const participant = Array.from(participants.entries())
            .find(([_, p]) => p.username === data.username);
        if (participant) {
            videoElement = document.getElementById(`video-${participant[0]}`);
        }
    }

    if (videoElement) {
        if (data.isSpeaking) {
            videoElement.classList.add('speaking');
        } else {
            videoElement.classList.remove('speaking');
        }
    }
}

// Add mask toggle handler
let isMaskEnabled = false;
document.getElementById('toggleMaskBtn').onclick = () => {
    if (!isMaskEnabled) {
        showMaskModal();
    } else {
        isMaskEnabled = false;
        updateMaskState();
    }
};

// Add modal functions
function showMaskModal() {
    const modal = document.getElementById('maskModal');
    const maskGrid = document.getElementById('maskGrid');
    maskGrid.innerHTML = '';

    // Add mask options
    masksList.forEach(maskFile => {
        const maskOption = document.createElement('div');
        maskOption.className = `mask-option ${maskFile === currentMask ? 'selected' : ''}`;
        
        const maskName = maskFile.replace('.png', '').replace(/-/g, ' ');
        
        maskOption.innerHTML = `
            <img src="assets/mask/${maskFile}" alt="${maskName}">
            <div class="mask-name">${maskName}</div>
        `;
        
        maskOption.onclick = () => {
            document.querySelectorAll('.mask-option').forEach(opt => 
                opt.classList.remove('selected')
            );
            maskOption.classList.add('selected');
            currentMask = maskFile;
            isMaskEnabled = true;
            updateMaskState();
        };
        
        maskGrid.appendChild(maskOption);
    });
    
    modal.classList.add('show');

    // Close button handler
    modal.querySelector('.close-btn').onclick = () => {
        modal.classList.remove('show');
    };

    // Close on outside click
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.classList.remove('show');
        }
    };
}

// Update mask state function
function updateMaskState() {
    const maskBtn = document.getElementById('toggleMaskBtn');
    maskBtn.classList.toggle('active', isMaskEnabled);
    
    const maskImage = document.getElementById('maskImage');
    maskImage.src = `assets/mask/${currentMask}`;

    // Close modal if open
    document.getElementById('maskModal').classList.remove('show');

    if (isMaskEnabled) {
        if (localPeerConnection) {
            const senders = localPeerConnection.getSenders();
            const videoSender = senders.find(sender => sender.track.kind === 'video');
            if (videoSender) {
                videoSender.replaceTrack(processedStream.getVideoTracks()[0]);
            }
        }
        const localVideo = document.getElementById('video-local').querySelector('video');
        localVideo.srcObject = processedStream;
    } else {
        if (localPeerConnection) {
            const senders = localPeerConnection.getSenders();
            const videoSender = senders.find(sender => sender.track.kind === 'video');
            if (videoSender) {
                videoSender.replaceTrack(localStream.getVideoTracks()[0]);
            }
        }
        const localVideo = document.getElementById('video-local').querySelector('video');
        localVideo.srcObject = localStream;
    }
}

// Add function to load available masks
async function loadAvailableMasks() {
    masksList = [
        'basic/mask1.png',
        'basic/mask2.png', 
        'basic/mask3.png',
        'medicel/mask1.png',
        'medicel/mask2.png',
        'medicel/mask3.png',
    ];
    console.log('Available masks:', masksList);
}

// Initialize the room
initializeRoom();
