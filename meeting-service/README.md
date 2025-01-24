---
title: Meeting Service
emoji: 🎥
colorFrom: blue
colorTo: indigo
sdk: docker
sdk_version: "3.0.0"
app_file: cmd/server/main.go 
pinned: false
---

# Meeting Service

This project is a Go backend service for managing user sessions and creating meeting rooms, utilizing MongoDB for data storage.

## Project Structure

```
meeting-service
├── cmd
│   └── server
│       └── main.go          # Entry point of the application
├── internal
│   ├── config
│   │   └── config.go       # Configuration settings and environment variables
│   ├── handlers
│   │   └── meetings.go      # HTTP handlers for managing meetings
│   ├── models
│   │   └── meeting.go       # Meeting model and database interactions
│   └── database
│       └── mongodb.go       # MongoDB connection logic
├── .env.example              # Example environment variables
├── .gitignore                # Git ignore file
├── go.mod                    # Module definition and dependencies
├── go.sum                    # Dependency checksums
└── README.md                 # Project documentation
```

## Setup Instructions

1. Clone the repository:
   ```
   git clone <repository-url>
   cd meeting-service
   ```

2. Create a `.env` file based on the `.env.example` file and fill in the necessary environment variables.

3. Install the required dependencies:
   ```
   go mod tidy
   ```

4. Run the application:
   ```
   go run cmd/server/main.go
   ```

## Docker Deployment

### Local Docker Development
```bash
# Build and run with docker-compose
docker-compose up --build

# Or build and run with Docker directly
docker build -t meeting-service .
docker run -p 8080:8080 meeting-service
```

## Deploying to Hugging Face Spaces

1. Create a new Space on Hugging Face:
   - Go to huggingface.co/spaces
   - Click "Create new Space"
   - Choose "Docker" as the SDK
   
2. Upload the following files to your Space:
   - Dockerfile
   - All source code files
   - go.mod and go.sum

3. Configure Environment Variables in Hugging Face:
   - Go to your Space settings
   - Add the following environment variables:
     - MONGODB_URI
     - CLOUDFLARE_APP_ID
     - CLOUDFLARE_TOKEN

4. The Space will automatically build and deploy your container

## Usage

- The service provides endpoints for creating, joining, and ending meetings.
- Refer to the `meetings.go` file for detailed API documentation and usage examples.

## License

This project is licensed under the MIT License.