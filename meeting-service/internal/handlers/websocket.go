package handlers

import (
	"context"
	"log"
	"net/http"
	"sync"
	"time"

	"meeting-service/internal/database"
	"meeting-service/internal/models" // Add this import

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
	"go.mongodb.org/mongo-driver/bson"
)

var (
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			// Allow all origins
			return true
		},
		HandshakeTimeout: 15 * time.Second,
		ReadBufferSize:   1024,
		WriteBufferSize:  1024,
	}

	// Store room connections
	rooms      = make(map[string]map[*websocket.Conn]*RoomConnection)
	roomsMutex sync.RWMutex
)

// Thêm một struct để lưu trữ thông tin kết nối đầy đủ
type RoomConnection struct {
	Username  string
	SessionID string // Thêm SessionID
	Conn      *websocket.Conn
}

type WebSocketMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

// Add new speaking state structure
type SpeakingStatePayload struct {
	Username   string `json:"username"`
	IsSpeaking bool   `json:"isSpeaking"`
}

// Thêm hàm để thông báo người tham gia mới
func (h *MeetingHandler) notifyNewParticipant(roomId string, sessionId string, username string) {
	h.broadcastToRoom(roomId, WebSocketMessage{
		Type: "participant_joined",
		Payload: map[string]interface{}{
			"session_id": sessionId,
			"username":   username,
			"tracks":     nil, // Will be populated when tracks are ready
		},
	})
}

func (h *MeetingHandler) notifyTracksReady(roomId string, sessionId string, username string) {
	// Notify others when a participant's tracks are ready
	h.broadcastToRoom(roomId, WebSocketMessage{
		Type: "tracks_ready",
		Payload: map[string]interface{}{
			"session_id": sessionId,
			"username":   username,
		},
	})
}

func (h *MeetingHandler) HandleWebSocket(c echo.Context) error {
	// Enable CORS for WebSocket
	c.Response().Header().Set("Access-Control-Allow-Origin", "*")
	c.Response().Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	c.Response().Header().Set("Access-Control-Allow-Headers", "Content-Type")

	// Handle preflight
	if c.Request().Method == "OPTIONS" {
		return c.NoContent(http.StatusOK)
	}

	roomId := c.Param("roomId")
	username := c.QueryParam("username")

	// Get session ID from database first
	collection := database.GetCollection("meetings")
	var meeting models.Meeting
	err := collection.FindOne(
		context.Background(),
		bson.M{"room_id": roomId},
	).Decode(&meeting)

	if err != nil {
		return err
	}

	// Find session ID for this user
	var sessionID string
	for _, session := range meeting.Sessions {
		if session.Username == username {
			sessionID = session.SessionID
			break
		}
	}

	if sessionID == "" {
		return echo.NewHTTPError(http.StatusNotFound, "Session not found")
	}

	ws, err := upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return err
	}

	// Set ping handler
	ws.SetPingHandler(func(string) error {
		ws.WriteControl(websocket.PongMessage, []byte{}, time.Now().Add(10*time.Second))
		return nil
	})

	// Set read deadline
	ws.SetReadDeadline(time.Now().Add(60 * time.Second))

	// Register connection with session ID
	roomsMutex.Lock()
	if rooms[roomId] == nil {
		rooms[roomId] = make(map[*websocket.Conn]*RoomConnection)
	}
	rooms[roomId][ws] = &RoomConnection{
		Username:  username,
		SessionID: sessionID,
		Conn:      ws,
	}
	roomsMutex.Unlock()

	// Notify others about new participant with correct session ID
	h.notifyNewParticipant(roomId, sessionID, username)

	// Send initial room state
	go h.sendRoomState(roomId, ws)

	// Start MongoDB change stream
	go h.watchRoomChanges(roomId)

	// Start heartbeat
	go h.startHeartbeat(ws)

	// Handle WebSocket messages
	go h.handleWebSocketConnection(roomId, ws, username)

	return nil
}

func (h *MeetingHandler) startHeartbeat(ws *websocket.Conn) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		if err := ws.WriteControl(websocket.PingMessage, []byte{}, time.Now().Add(10*time.Second)); err != nil {
			log.Printf("Heartbeat error: %v", err)
			return
		}
	}
}

func (h *MeetingHandler) handleWebSocketConnection(roomId string, ws *websocket.Conn, username string) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("Recovered from panic in handleWebSocketConnection: %v", r)
		}
		h.handleParticipantLeave(roomId, ws, username)
		ws.WriteControl(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
			time.Now().Add(time.Second),
		)
		ws.Close()
	}()

	// Set ping handler
	ws.SetPingHandler(func(data string) error {
		err := ws.WriteControl(websocket.PongMessage, []byte(data), time.Now().Add(time.Second))
		if err != nil {
			log.Printf("Error sending pong: %v", err)
		}
		return err
	})

	// Set pong handler
	ws.SetPongHandler(func(string) error {
		ws.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		var msg WebSocketMessage
		err := ws.ReadJSON(&msg)
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("WebSocket read error: %v", err)
			}
			break
		}

		switch msg.Type {
		case "ping":
			err = ws.WriteJSON(WebSocketMessage{Type: "pong"})
			if err != nil {
				log.Printf("Error sending pong: %v", err)
				break
			}
		case "wave":
			if _, ok := msg.Payload.(map[string]interface{}); !ok {
				log.Printf("Invalid wave payload format")
				continue
			}

			h.broadcastToRoom(roomId, WebSocketMessage{
				Type: "wave",
				Payload: map[string]interface{}{
					"username":  username,
					"timestamp": time.Now().Format(time.RFC3339),
				},
			})
		case "speaking_state":
			// Broadcast speaking state to all participants in room
			h.broadcastToRoom(roomId, msg)
		}

		ws.SetReadDeadline(time.Now().Add(60 * time.Second))
	}
}

func (h *MeetingHandler) handleParticipantLeave(roomId string, ws *websocket.Conn, username string) {
	roomsMutex.Lock()
	delete(rooms[roomId], ws)
	if len(rooms[roomId]) == 0 {
		delete(rooms, roomId)
	}
	roomsMutex.Unlock()

	// Update MongoDB
	collection := database.GetCollection("meetings")
	_, err := collection.UpdateOne(
		context.Background(),
		bson.M{"room_id": roomId},
		bson.M{
			"$pull": bson.M{
				"sessions": bson.M{"username": username},
			},
		},
	)
	if err != nil {
		log.Printf("Error removing session: %v", err)
		return
	}

	// Notify remaining participants
	h.broadcastToRoom(roomId, WebSocketMessage{
		Type: "participant_left",
		Payload: map[string]string{
			"username": username,
		},
	})
}

func (h *MeetingHandler) sendRoomState(roomId string, ws *websocket.Conn) {
	collection := database.GetCollection("meetings")
	var meeting models.Meeting
	err := collection.FindOne(
		context.Background(),
		bson.M{"room_id": roomId},
	).Decode(&meeting)

	if err != nil {
		log.Printf("Error fetching room state: %v", err)
		return
	}

	ws.WriteJSON(WebSocketMessage{
		Type:    "room_state",
		Payload: meeting,
	})
}

func (h *MeetingHandler) broadcastToRoom(roomId string, msg WebSocketMessage) {
	roomsMutex.RLock()
	defer roomsMutex.RUnlock()

	for ws := range rooms[roomId] {
		ws.WriteJSON(msg)
	}
}

func (h *MeetingHandler) watchRoomChanges(roomId string) {
	collection := database.GetCollection("meetings")
	pipeline := []bson.M{
		{
			"$match": bson.M{
				"$and": []bson.M{
					{"operationType": "update"},
					{"fullDocument.room_id": roomId},
				},
			},
		},
	}

	changeStream, err := collection.Watch(context.Background(), pipeline)
	if err != nil {
		log.Printf("Error creating change stream: %v", err)
		return
	}
	defer changeStream.Close(context.Background())

	for changeStream.Next(context.Background()) {
		var changeDoc bson.M
		if err := changeStream.Decode(&changeDoc); err != nil {
			log.Printf("Error decoding change stream document: %v", err)
			continue
		}

		h.broadcastToRoom(roomId, WebSocketMessage{
			Type:    "room_updated",
			Payload: changeDoc["fullDocument"],
		})
	}
}
