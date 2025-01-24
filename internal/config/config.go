package config

import (
    "os"

    "github.com/joho/godotenv"
)

type Config struct {
    MongoDBURI       string
    CloudflareAppID  string `env:"CLOUDFLARE_APP_ID"`
    CloudflareToken  string `env:"CLOUDFLARE_TOKEN"`
    CloudflareAPIURL string
}

func LoadConfig() *Config {
    // Try to load .env file but don't fail if it doesn't exist
    _ = godotenv.Load()

    // Use default values if env vars are not set
    mongoURI := os.Getenv("MONGODB_URI")
    if mongoURI == "" {
        mongoURI = "mongodb+srv://meeting:admin@cluster0.pdbzo.mongodb.net/meeting"
    }

    appID := os.Getenv("CLOUDFLARE_APP_ID")
    if appID == "" {
        appID = "45a8f268c6e1827a3edf6e0cb80b8618"
    }

    token := os.Getenv("CLOUDFLARE_TOKEN")
    if token == "" {
        token = "3180fd33c689b7b7345332f2272d64ed639a99f3ece3536bc6185367181c38ee"
    }

    return &Config{
        MongoDBURI:       mongoURI,
        CloudflareAppID:  appID,
        CloudflareToken:  token,
        CloudflareAPIURL: "https://rtc.live.cloudflare.com/v1/apps",
    }
}