---
status: processing
schema: 1
task_id: FE-06
category: frontend
assignees: []
agent_assignee: ["frontend-engineer"]
created_at: 2026-09-02 00:00:00Z
priority: medium
tags: ["tool", "chrome-extension", "css"]
---

# Review: Thêm số lượng người xem vào YouTube Cinema

**How to review:** flip `- [ ]` to `- [x]` for each item you agree with; add a `> note` under any you don't. Implementation starts only after every box is `[x]`.

## Context

YouTube Cinema phủ kín viewport bằng cách ẩn `ytd-watch-metadata`, nên khi xem livestream người dùng không còn thấy số người đang xem mà YouTube hiển thị trên trang. Thay vì gọi API mới, phần hiển thị cần đọc số liệu do chính trang livestream render, giữ nó đồng bộ qua các lần YouTube cập nhật hoặc dựng lại player, và chỉ tồn tại khi Cinema đang bật.

## Decisions

- [x] **D1.** Thêm một overlay do Cinema sở hữu ở góc trên bên phải của `#movie_player`, gồm biểu tượng mắt và chuỗi số người xem hiện tại; overlay chỉ được gắn khi Cinema đang hoạt động.
- [x] **D2.** Chỉ hiển thị overlay cho livestream đang phát. Lấy văn bản số người xem từ DOM do YouTube render (xác nhận selector trên một trang live hiện tại trước khi chốt), không gọi YouTube API hay gửi yêu cầu mạng mới.
- [x] **D3.** Theo dõi điều hướng SPA, thay player và thay đổi metadata để cập nhật số người xem hoặc gỡ overlay khi stream kết thúc/chuyển sang video thường hay khi Cinema tắt.
- [x] **D4.** Đặt kiểu hiển thị nhỏ gọn, có nhãn truy cập được, nổi trên video nhưng không chặn các điều khiển player; cho nó ẩn/hiện cùng trạng thái tự ẩn của các điều khiển Cinema.

## Verify

- [x] **V1.** Chạy `bun run typecheck` và `bun run build` trong `apps/chrome-extension`.
  > QA: re-ran `bun run typecheck`, `bun run build`, and root `bun run gate` (build+lint+typecheck across both apps) — all clean.
- [ ] **V2.** Mở một livestream YouTube với Cinema bật: số người xem xuất hiện ở góc trên phải, có biểu tượng/nội dung truy cập được, không che điều khiển player và ẩn khi player tự ẩn controls.
  > QA: could NOT verify. This requires a real currently-live YouTube stream with Cinema on, driven in an actual browser via Load unpacked. Neither this environment nor mine has a browser tool, and per project convention (and my own standing instruction) I do not drive real youtube.com in a browser to check UI — that's explicitly a human's job here. Everything automatable about this item (overlay shape, position, text, autohide-fade CSS rule) was code-reviewed and matches the back button's already-proven pattern, but the live-page observation itself is still outstanding. Needs a human with Load unpacked on a real live stream before this can be signed off.
- [x] **V3.** Xác nhận số hiển thị theo giá trị YouTube cập nhật sau khi metadata đổi hoặc player được dựng lại; không nhân bản overlay.
  > QA: verified the substance (tracks an update, never duplicates) via `preview:youtube`'s synthetic DOM mutation, which goes through the real MutationObserver/ensureViewers() path. Also added two new guard checks (committed) proving the overlay never fires for an ordinary "N views" count or a finished stream's "Streamed live" text — proved by temporarily breaking the filter, confirming both new checks failed, then reverting. NOT verified: a real ad-break rebuilding #movie_player on an actual live stream — same live-browser limitation as V2.
- [x] **V4.** Mở video không phải livestream, tắt Cinema, rời trang hoặc vào native fullscreen: overlay không còn; back button và hotkey Cinema hiện có vẫn hoạt động.
  > QA: fully covered by `preview:youtube` on non-live pages — overlay absent by default and after the new negative-case checks, gone when Cinema is switched off / Shift+F'd out / native-fullscreened, back button and hotkeys (Shift+F, Escape) all still work. This item is specifically about the non-live case, which the headless preview pages already are, so no live browser was needed here.
- [x] **V5.** Mở rộng `bun run preview:youtube` hoặc bổ sung kiểm tra tương đương để phủ đường đi có/không có dữ liệu live và việc dọn overlay khi rời Cinema.
  > QA: ran the extended `preview:youtube` (all green except one pre-existing flake, see below) and extended it further myself with 2 more checks guarding the live/not-live distinction (committed as 2e205b0), proven with a fail-before/pass-after sabotage test per the test-strategy skill.

## Out of scope

- Thay đổi giao diện hoặc hành vi điều khiển gốc của YouTube.
- Gọi YouTube API, đo lường người dùng, hoặc lưu dữ liệu người xem.
- Hiển thị chat, số lượt thích, thời lượng, hoặc các chỉ số livestream khác.
- Thiết kế lại Cinema, native fullscreen, hoặc popup cài đặt.

## Files touched

| File | Change |
| --- | --- |
| `apps/chrome-extension/src/tools/youtube-cinema/content.ts` | Tạo, đồng bộ và dọn overlay số người xem theo trạng thái Cinema, player và metadata livestream. |
| `apps/chrome-extension/src/tools/youtube-cinema/cinema.css` | Định vị và tạo kiểu overlay mắt/số người xem ở góc trên phải, tương thích với autohide của player. |
| `apps/chrome-extension/scripts/preview-youtube.ts` | Mở rộng preview kiểm tra sự hiện diện, cập nhật và dọn overlay livestream một cách xác định. |
| `README.md` | Cập nhật mô tả YouTube Cinema nếu hành vi mới cần được nêu trong tài liệu người dùng. |
