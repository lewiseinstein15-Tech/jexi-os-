# 📺 /watch — JEXI can watch videos

Ported from the [`claude-watch`](https://github.com/taoufik123-collab/claude-watch) skill (MIT). JEXI doesn't guess from a title — she **downloads the video, reads the transcript, looks at every scene, and answers with timestamps**.

## Usage

In any JEXI chat (app, APK, or website):

```
/watch <video URL or local file path> [optional question]
```

**Examples**

```
/watch https://youtu.be/jNQXAC9IVRw what happens in this video?
/watch https://www.tiktok.com/@user/video/123 summarize this
/watch bug-repro.mov what's going wrong?
/watch https://youtu.be/xyz how does the creator hook the viewer in the first 30 seconds?
```

No question = she summarizes. You can also just paste a video link in a normal sentence — JEXI's Video Analyst can call the same ability as a tool.

## What she does (and streams live, step by step)

1. ⬇️ **Downloads** the video (yt-dlp — YouTube, TikTok, Instagram, Vimeo, X, direct files; capped at 30 min / 80 MB / 720p)
2. 🗣️ **Transcript** — free captions first; if none, the audio is transcribed with **Whisper (Groq, free — no extra key needed)**
3. 🎬 **Scene-change frames** — one frame per detected *cut* (not every-N-seconds), plus a **dense 2fps pass over the first 10 seconds** (the hook microscope)
4. 👀 **Looks at every frame** with her vision models, timestamps attached
5. 🧠 **Answers your question** from what she saw AND heard, citing `[1:23]` timestamps

## Install / requirements

Nothing to configure. On Render the container ships `ffmpeg` + `yt-dlp` (Dockerfile). Self-hosting: `apt install ffmpeg && pip install yt-dlp`. Whisper rides the existing `GROQ_API_KEY`. Every missing piece degrades honestly (no captions + no ffmpeg → clear message, never a crash).

## Try it

`/watch https://www.youtube.com/watch?v=jNQXAC9IVRw who is filming?`
