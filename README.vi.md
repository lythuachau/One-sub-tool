# One-sub-tool

**One-sub-tool v2.2.1** là công cụ cá nhân chạy local trên Windows để trích xuất, chỉnh sửa, dịch phụ đề và tạo thuyết minh cho video.

Xem tài liệu tiếng Anh tại [README.md](README.md).

## Điểm mới trong v2.2.1

- Tự phát hiện model Gemini và kiểm tra model có hoạt động hay không.
- Có thể chọn Whisper local cho bước trích xuất phụ đề.
- Cấu hình endpoint, model và API key dịch trong **Cài đặt → API**.
- VieNeu-TTS: giọng có sẵn hoặc âm thanh tham chiếu.
- OmniVoice: âm thanh tham chiếu, thiết kế giọng hoặc tự sinh giọng.
- Nút **Nghe thử giọng** cho cả VieNeu-TTS và OmniVoice.
- Sửa câu, khóa bản dịch, nhóm phụ đề và chạy lại có chọn lọc.
- Dán nguyên văn nội dung chia sẻ Douyin, hệ thống tự trích xuất URL.
- Tải Douyin theo chuỗi dự phòng native → yt-dlp → Chromium tạm thời.
- Lưu cache và audio local, không cần server công khai.

## Kiến trúc local

| Thành phần | Địa chỉ mặc định | Chức năng |
| --- | --- | --- |
| Giao diện React | `http://localhost:3030` | Phụ đề, dịch, thuyết minh và render |
| Backend Express | `http://localhost:3031` | API, tải video, file và điều phối |
| VieNeu-TTS | `http://localhost:3035` | Tạo giọng local |
| OmniVoice | `http://localhost:3036` | Reference/design narration |

Đây là công cụ một người dùng, ưu tiên local; không có tài khoản, database cloud hay server public.

## Yêu cầu

- Windows 10/11.
- Node.js LTS và npm.
- Python 3.11 được quản lý bằng [uv](https://github.com/astral-sh/uv).
- FFmpeg và FFprobe có trong `PATH`.
- CUDA NVIDIA là tùy chọn. Chế độ `auto` sẽ chuyển sang CPU nếu CUDA không dùng được.
- Gemini API chỉ bắt buộc khi dùng dịch hoặc phân tích bằng Gemini; Whisper local có thể chạy độc lập.

## Cài đặt nhanh trên Windows

```powershell
git clone https://github.com/lythuachau/One-sub-tool.git
cd One-sub-tool
npm install
npm run install:all
npm run dev:cuda
```

Mở `http://localhost:3030`. Lần đầu chạy VieNeu-TTS hoặc OmniVoice có thể lâu hơn vì phải tải và nạp model.

Nếu chỉ cần làm phụ đề, không dùng thuyết minh local:

```powershell
npm run dev
```

## Cấu hình API và model

Vào **Cài đặt → API** để nhập provider dịch, base URL, model và API key. Key chỉ lưu local, không ghi vào log hoặc job snapshot. Không commit `.env.local`, `localStorage.json`, model weights và video/audio sinh ra.

## Quy trình sử dụng

1. Tải video/audio local hoặc dán URL YouTube/Douyin. Nội dung chia sẻ Douyin dài sẽ được tự động rút ra URL.
2. Chọn Gemini hoặc Whisper để trích xuất phụ đề.
3. Kiểm tra và chỉnh thời gian, nội dung từng câu.
4. Dịch bằng provider đã cấu hình; bản dịch đã duyệt được giữ lại.
5. Mở phần thuyết minh và chọn VieNeu-TTS hoặc OmniVoice.
6. Chọn nguồn giọng, bấm **Nghe thử giọng**, sau đó tạo thuyết minh.
7. Render hoặc tải video, SRT, JSON và audio thuyết minh.

## Kiểm tra lỗi

- Backend: `http://localhost:3031/api/health`
- VieNeu-TTS: `http://localhost:3035/api/narration/status`
- OmniVoice: `http://localhost:3036/health`
- Nếu thuyết minh chưa dùng được, chạy `npm run dev:cuda` và chờ trạng thái service chuyển sang sẵn sàng.
- Nếu thiếu FFmpeg/FFprobe, cài lại FFmpeg rồi mở PowerShell mới.
- Nếu GPU lỗi khởi tạo, chọn `auto` hoặc CPU; GPU vẫn chỉ chạy một tác vụ để tránh đầy VRAM.

## Lệnh phát triển

```powershell
npm run build              # build frontend production
npm run dev:cuda           # frontend, backend, VieNeu-TTS và OmniVoice
npm run setup:tts          # cài/cấu hình engine TTS local
npm run test:services      # kiểm tra nhanh các service
```

## Giấy phép

MIT License.
- Có thể bấm trực tiếp vào nội dung phụ đề trên timeline để sửa; đặt con trỏ rồi nhấn Enter sẽ tách thành một dòng có mốc thời gian mới.
- Mốc tách được tính ổn định theo vị trí văn bản, không tạo timestamp ngẫu nhiên; mỗi dòng sau khi tách được dùng độc lập cho TTS.
- Có thể chọn chỉnh phụ đề gốc hoặc phụ đề đã dịch ngay trên cùng timeline.
- Chỉnh phụ đề theo kiểu CapCut: bấm trực tiếp để sửa, Enter để tách, Backspace ở đầu dòng để gộp và tìm/thay thế text thủ công.
- Khung xem trước bản dịch dùng cùng timeline có thể chỉnh sửa như phụ đề gốc.
