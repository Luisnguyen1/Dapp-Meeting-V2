package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type Session struct {
    UserID      primitive.ObjectID `bson:"user_id" json:"user_id"`
    Username    string             `bson:"username" json:"username"`
    SessionID   string             `bson:"session_id" json:"session_id"`
    CreatedAt   time.Time          `bson:"created_at" json:"created_at"`
}

// Meeting represents a meeting room structure
type Meeting struct {
    ID          primitive.ObjectID `bson:"_id,omitempty" json:"id"`
    RoomID      string             `bson:"room_id" json:"room_id"`
    Title       string             `bson:"title" json:"title"`
    Description string             `bson:"description"`
    CreatorID   primitive.ObjectID `bson:"creator_id" json:"creator_id"`
    Sessions    []Session          `bson:"sessions" json:"sessions"`
    CreatedAt   time.Time          `bson:"created_at" json:"created_at"`
    UpdatedAt   time.Time          `bson:"updated_at" json:"updated_at"`
}

// NewMeeting creates a new meeting instance
func NewMeeting(title, description string, creatorID primitive.ObjectID, roomID string) *Meeting {
    now := time.Now()
    return &Meeting{
        Title:       title,
        Description: description,
        RoomID:      roomID,
        CreatorID:   creatorID,
        Sessions:    []Session{},
        CreatedAt:   now,
        UpdatedAt:   now,
    }
}