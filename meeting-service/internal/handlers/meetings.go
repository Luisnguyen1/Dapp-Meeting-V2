package handlers

import (
    "context"
    "net/http"
    "time"
    "github.com/labstack/echo/v4"
    "go.mongodb.org/mongo-driver/bson"
    "go.mongodb.org/mongo-driver/bson/primitive"
    "meeting-service/internal/database"
    "meeting-service/internal/models"
    "meeting-service/internal/services"
    "github.com/google/uuid"
)

type MeetingHandler struct {
    cloudflare *services.CloudflareService
}

func NewMeetingHandler(cloudflare *services.CloudflareService) *MeetingHandler {
    return &MeetingHandler{
        cloudflare: cloudflare,
    }
}

type CreateMeetingRequest struct {
    Title     string             `json:"title"`
    CreatorID primitive.ObjectID `json:"creator_id"`
    Username  string             `json:"username"`
}

func (h *MeetingHandler) CreateMeeting(c echo.Context) error {
    var req CreateMeetingRequest
    if err := c.Bind(&req); err != nil {
        return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
    }

    // Generate room ID
    roomID := uuid.New().String()

    // Create Cloudflare session
    sessionID, err := h.cloudflare.CreateSession()
    if err != nil {
        return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create session"})
    }

    // Create meeting
    meeting := models.NewMeeting(req.Title, "additionalString", req.CreatorID, roomID)
    
    // Add creator's session with username
    meeting.Sessions = append(meeting.Sessions, models.Session{
        UserID:    req.CreatorID,
        Username:  req.Username,
        SessionID: sessionID,
        CreatedAt: time.Now(),
    })

    // Save to MongoDB
    collection := database.GetCollection("meetings")
    _, err = collection.InsertOne(context.Background(), meeting)
    if err != nil {
        return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to save meeting"})
    }

    return c.JSON(http.StatusCreated, meeting)
}

type JoinMeetingRequest struct {
    UserID   primitive.ObjectID `json:"user_id"`
    Username string             `json:"username"`
}

func (h *MeetingHandler) JoinMeeting(c echo.Context) error {
    roomID := c.Param("roomID")
    username := c.QueryParam("username")
    
    if username == "" {
        return c.JSON(http.StatusBadRequest, map[string]string{"error": "Username is required"})
    }

    // Create new Cloudflare session
    sessionID, err := h.cloudflare.CreateSession()
    if err != nil {
        return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create session"})
    }

    // Add session to meeting
    collection := database.GetCollection("meetings")
    session := models.Session{
        UserID:    primitive.NewObjectID(), // Generate new ID for the user
        Username:  username,
        SessionID: sessionID,
        CreatedAt: time.Now(),
    }

    _, err = collection.UpdateOne(
        context.Background(),
        bson.M{"room_id": roomID},
        bson.M{"$push": bson.M{"sessions": session}},
    )
    if err != nil {
        return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update meeting"})
    }

    return c.JSON(http.StatusOK, map[string]string{
        "session_id": sessionID,
        "room_id":   roomID,
    })
}

func (h *MeetingHandler) GetMeetingInfo(c echo.Context) error {
    roomID := c.Param("roomID")

    collection := database.GetCollection("meetings")
    var meeting models.Meeting
    err := collection.FindOne(
        context.Background(),
        bson.M{"room_id": roomID},
    ).Decode(&meeting)

    if err != nil {
        return c.JSON(http.StatusNotFound, map[string]string{"error": "Meeting not found"})
    }

    return c.JSON(http.StatusOK, meeting)
}

func (h *MeetingHandler) GetCloudflareCredentials(c echo.Context) error {
    return c.JSON(http.StatusOK, map[string]string{
        "appId": h.cloudflare.AppID,
        "token": h.cloudflare.AppToken,
    })
}

// Add new handler method
func (h *MeetingHandler) NotifyTracksReady(c echo.Context) error {
    roomId := c.Param("roomId")
    var data struct {
        SessionID string `json:"session_id"`
        Username  string `json:"username"`
    }
    
    if err := c.Bind(&data); err != nil {
        return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
    }

    // Notify all participants in the room about the ready tracks
    h.notifyTracksReady(roomId, data.SessionID, data.Username)
    
    return c.NoContent(http.StatusOK)
}