package main

import (
    "log"
    "github.com/labstack/echo/v4"
    "meeting-service/internal/config"
    "meeting-service/internal/database"
    "meeting-service/internal/handlers"
    "meeting-service/internal/services"
)

func main() {
    // Initialize Echo
    e := echo.New()
    
    // Load configuration
    cfg := config.LoadConfig()
    
    // Connect to MongoDB
    database.Connect(cfg.MongoDBURI)

    // Initialize services
    cloudflareService := services.NewCloudflareService(
        cfg.CloudflareAppID,
        cfg.CloudflareToken,
    )
    
    // Initialize handlers
    meetingHandler := handlers.NewMeetingHandler(cloudflareService)
    
    // Set up routes
    e.POST("/meetings", meetingHandler.CreateMeeting)
    e.GET("/meetings/:roomID", meetingHandler.JoinMeeting)
    e.GET("/meetings/:roomID/info", meetingHandler.GetMeetingInfo)
    
    // Start server
    log.Fatal(e.Start(":8080"))
}