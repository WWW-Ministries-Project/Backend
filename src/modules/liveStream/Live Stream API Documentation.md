# Live Stream API

Tells the mobile app whether the church YouTube channel is live, or has a
broadcast scheduled, and pushes members once when a broadcast goes live.

## How it works

- `src/cron-jobs/liveStreamCron.ts` ticks every minute. `liveStreamService.refreshLiveStreamState`
  skips the tick until `live_stream_state.next_check_at`, then:
  1. `playlistItems.list` on the channel's Live-tab playlist (`UULV…`, falling back to uploads `UU…` on 404) — 1 quota unit.
  2. `videos.list` on those ids for `snippet.liveBroadcastContent` + `liveStreamingDetails` — 1 quota unit.
  3. Stores the chosen broadcast in the `live_stream_state` singleton (id = 1) and schedules the next check.
- Check pacing: every 1 min from 15 min before to 60 min after an upcoming broadcast's scheduled start,
  every 2 min while live, every 5 min otherwise, 30 min after an error. At these defaults a day costs
  roughly 600–900 of the key's 10,000 daily units.
- When a broadcast first turns LIVE, one Expo push goes to every active device whose user is active and has
  not turned off the `livestream.started` preference. A conditional update on `notified_video_id` makes this
  once-per-broadcast even with two processes running the cron. A stream first seen more than 60 minutes after it
  started is shown but not pushed about. No inbox rows are created.

## Endpoint

### `GET /live-stream/status`

Auth: any signed-in account (`protect`). Reads the stored row (cached 15 s in memory); never calls YouTube.

```json
{
  "message": "Live stream status retrieved successfully",
  "data": {
    "status": "live",
    "videoId": "m2SN6RWC2xo",
    "title": "WORD OF LIFE LIVE BROADCAST",
    "thumbnailUrl": "https://i.ytimg.com/vi/m2SN6RWC2xo/hqdefault_live.jpg",
    "youtubeUrl": "https://www.youtube.com/watch?v=m2SN6RWC2xo",
    "scheduledStartAt": "2026-10-05T20:51:23.000Z",
    "actualStartAt": "2026-10-05T20:52:01.000Z",
    "checkedAt": "2026-10-05T21:10:20.000Z"
  }
}
```

`status` is `live`, `upcoming` or `offline` (with null fields). A row not refreshed for 20 minutes, or an
upcoming broadcast more than 2 hours overdue, reads as `offline`.

## Opt-out

Preference type `livestream.started`, channel `inApp`, default on:

`PATCH /notifications/preferences/livestream.started` with `{ "inAppEnabled": false }`.

## Environment

| Variable | Required | Default | Notes |
|---|---|---|---|
| `YOUTUBE_API_KEY` | yes | — | YouTube Data API v3 key. The cron is off without it. |
| `YOUTUBE_CHANNEL_ID` | no | `UCEdXLYbtPZFk1wXrOKBX0qw` | |
| `YOUTUBE_API_REFERER` | no | — | Sent as `Referer`. If the key rejects it (403, referer blocked), the check retries with `http://localhost:3000/`, the only origin the shared key accepts today. |
| `LIVE_STREAM_CRON` | no | `20 * * * * *` | Tick schedule; pacing is decided per tick. |
| `LIVE_STREAM_IDLE_POLL_MINUTES` | no | `5` | |
| `LIVE_STREAM_LIVE_POLL_MINUTES` | no | `2` | |
| `LIVE_STREAM_IMMINENT_POLL_MINUTES` | no | `1` | |
| `LIVE_STREAM_ERROR_POLL_MINUTES` | no | `30` | |
| `EXPO_ACCESS_TOKEN` | no | — | Already used by device push. |
