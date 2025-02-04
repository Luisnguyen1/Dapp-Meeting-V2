package main

import (
	"log"
	"meeting-service/internal/config"
	"meeting-service/internal/database"
	"meeting-service/internal/handlers"
	"meeting-service/internal/services"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
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

	// Update CORS configuration to allow requests from your deployed domain
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: []string{
			"http://127.0.0.1:5500",
			"http://localhost:5500",
			"https://manhteky123-meeting-dapp-frontend.static.hf.space",
			"https://manhteky123-dapp-meeting.hf.space",
		},
		AllowMethods: []string{echo.GET, echo.PUT, echo.POST, echo.DELETE, echo.OPTIONS},
		AllowHeaders: []string{
			echo.HeaderOrigin,
			echo.HeaderContentType,
			echo.HeaderAccept,
			echo.HeaderAuthorization,
			"X-Requested-With",
		},
		AllowCredentials: true,
		MaxAge:           86400, // Cache preflight requests for 24 hours
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
	e.GET("/cloudflare/credentials", meetingHandler.GetCloudflareCredentials) // Add this line
	// Add WebSocket route
	e.GET("/ws/meetings/:roomId", meetingHandler.HandleWebSocket)
	// Add new route
	e.POST("/meetings/:roomId/notify-tracks-ready", meetingHandler.NotifyTracksReady)

	// Start server
	log.Fatal(e.Start(":7860"))
}
