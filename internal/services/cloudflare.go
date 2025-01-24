package services

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
)

type CloudflareService struct {
    AppID    string
    AppToken string
    BaseURL  string
}

func NewCloudflareService(appID, appToken string) *CloudflareService {
    return &CloudflareService{
        AppID:    appID,
        AppToken: appToken,
        BaseURL:  fmt.Sprintf("https://rtc.live.cloudflare.com/v1/apps/%s", appID),
    }
}

type SessionResponse struct {
    SessionID        string `json:"sessionId"`
    ErrorCode       int    `json:"errorCode,omitempty"`
    ErrorDescription string `json:"errorDescription,omitempty"`
}

func (s *CloudflareService) CreateSession() (string, error) {
    url := fmt.Sprintf("%s/sessions/new", s.BaseURL)
    
    req, err := http.NewRequest("POST", url, bytes.NewBuffer([]byte{}))
    if err != nil {
        return "", fmt.Errorf("failed to create request: %v", err)
    }

    req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", s.AppToken))
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, err := client.Do(req)
    if err != nil {
        return "", fmt.Errorf("failed to send request: %v", err)
    }
    defer resp.Body.Close()

    var sessionResp SessionResponse
    if err := json.NewDecoder(resp.Body).Decode(&sessionResp); err != nil {
        return "", fmt.Errorf("failed to decode response: %v", err)
    }

    if sessionResp.ErrorCode != 0 {
        return "", fmt.Errorf("cloudflare error: %s", sessionResp.ErrorDescription)
    }

    return sessionResp.SessionID, nil
}
