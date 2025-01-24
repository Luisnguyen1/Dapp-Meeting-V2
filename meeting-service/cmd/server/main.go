package main

import (
    "log"
    "github.com/labstack/echo/v4"
    "github.com/labstack/echo/v4/middleware" 
    "meeting-service/internal/config"
    "meeting-service/internal/database"
    "meeting-service/internal/handlers"
    "meeting-service/internal/services"
)

func main() {
    // Initialize Echo
    e := echo.New()
    
    // Add logging middleware
    e.Use(middleware.LoggerWithConfig(middleware.LoggerConfig{
        Format: "method=${method}, uri=${uri}, status=${status}, latency=${latency_human}, body=${body}\n",
    }))

    // Add request body dumper for debugging
    e.Use(middleware.BodyDump(func(c echo.Context, reqBody, resBody []byte) {
        log.Printf("Request Body: %s\n", reqBody)
        log.Printf("Response Body: %s\n", resBody)
    }))

    // Add CORS middleware
    e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
        AllowOrigins: []string{"http://127.0.0.1:5500", "http://localhost:5500"},
        AllowMethods: []string{echo.GET, echo.PUT, echo.POST, echo.DELETE},
        AllowHeaders: []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAccept},
    }))
    
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