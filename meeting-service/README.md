# meeting-service/meeting-service/README.md

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

## Usage

- The service provides endpoints for creating, joining, and ending meetings.
- Refer to the `meetings.go` file for detailed API documentation and usage examples.

## License

This project is licensed under the MIT License.