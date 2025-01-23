Collecting workspace information

# Dự Án Ứng Dụng Meeting

## Mô Tả
Ứng dụng họp trực tuyến cho phép người dùng tạo và tham gia các phòng họp với tính năng video/audio theo thời gian thực.

## Lưu ý: Em chỉ mới hoàn thành backend và frontend đang thực hiện.
## Cấu Trúc Dự Án

### Frontend (meeting-app)
```
meeting-app/
├── public/          # Tài nguyên tĩnh
├── src/
│   ├── components/  # Components React
│   ├── context/     # Context quản lý state
│   ├── pages/       # Các trang của ứng dụng  
│   ├── services/    # Các service giao tiếp API
│   └── utils/       # Tiện ích
```

### Backend (meeting-service)
```
meeting-service/
├── cmd/
│   └── server/     # Điểm khởi chạy ứng dụng
├── internal/
│   ├── config/     # Cấu hình
│   ├── handlers/   # Xử lý HTTP request
│   ├── models/     # Models dữ liệu
│   └── database/   # Kết nối database
```

## Luồng Hoạt Động

1. **Tạo Phòng Họp**
   - Người dùng nhập tên và tiêu đề phòng họp
   - Frontend gọi API tạo phòng mới
   - Backend tạo session Cloudflare và lưu thông tin vào MongoDB
   - Trả về room ID cho người dùng

2. **Tham Gia Phòng Họp**
   - Người dùng nhập room ID và tên
   - Backend kiểm tra và tạo session mới
   - Frontend khởi tạo kết nối WebRTC
   - Stream audio/video được thiết lập

3. **Trong Phòng Họp**
   - Người dùng có thể bật/tắt camera và micro
   - Danh sách người tham gia được cập nhật realtime
   - Stream được quản lý thông qua Cloudflare

## API Endpoints

### API (meeting-app)

```javascript
const API_BASE = 'http://localhost:8080'

// Tạo phòng họp mới
POST /meetings
Body: {
    title: string,
    creator_id: string,
    username: string
}

// Tham gia phòng họp
GET /meetings/:roomId
Body: {
    username: string
}

// Lấy thông tin phòng họp
GET /meetings/:roomId/info
```

### Cloudflare API (WebRTC)

```javascript
const CLOUDFLARE_BASE = 'https://rtc.live.cloudflare.com/v1'

// Tạo session mới
POST /apps/{appId}/sessions/new

// Thêm track mới
POST /apps/{appId}/sessions/{sessionId}/tracks/new

// Renegotiate session
PUT /apps/{appId}/sessions/{sessionId}/renegotiate

// Đóng track
PUT /apps/{appId}/sessions/{sessionId}/tracks/close

// Lấy trạng thái session
GET /apps/{appId}/sessions/{sessionId}
```

## Cài Đặt và Chạy Dự Án

### Frontend
```bash
cd meeting-app
npm install
npm run dev
```

### Backend
```bash 
cd meeting-service
go mod tidy
go run cmd/server/main.go
```

## Môi Trường
```env
# Frontend
VITE_API_BASE_URL=http://localhost:8080

# Backend
MONGODB_URI=mongodb+srv://...
CLOUDFLARE_APP_ID=your_app_id
CLOUDFLARE_TOKEN=your_token
```

## Công Nghệ Sử Dụng

- **Frontend**: React, Vite, Material-UI
- **Backend**: Go, Echo Framework
- **Database**: MongoDB
- **WebRTC**: Cloudflare RTC
- **State Management**: React Context