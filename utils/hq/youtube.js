/**
 * YouTube channel numbers (public stats, API key only).
 *
 * TODO(keys): YOUTUBE_API_KEY   Google Cloud → APIs → enable "YouTube Data
 *   API v3" → Credentials → API key (restrict it to that API).
 * TODO(keys): YOUTUBE_CHANNEL_ID  starts with "UC…" (YouTube Studio →
 *   Settings → Channel → Advanced settings).
 */
const axios = require("axios");

const isConfigured = () => Boolean(process.env.YOUTUBE_API_KEY && process.env.YOUTUBE_CHANNEL_ID);
const yt = (path, params) =>
  axios.get(`https://www.googleapis.com/youtube/v3/${path}`, { params: { key: process.env.YOUTUBE_API_KEY, ...params }, timeout: 15000 }).then((r) => r.data);

async function channelSummary({ max = 25 } = {}) {
  const ch = await yt("channels", { part: "snippet,statistics,contentDetails", id: process.env.YOUTUBE_CHANNEL_ID });
  const channel = ch.items?.[0];
  if (!channel) throw new Error("Channel not found; check YOUTUBE_CHANNEL_ID");
  const uploads = channel.contentDetails?.relatedPlaylists?.uploads;
  const pl = uploads ? await yt("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: Math.min(50, max) }) : { items: [] };
  const ids = (pl.items || []).map((i) => i.contentDetails?.videoId).filter(Boolean);
  const vids = ids.length ? await yt("videos", { part: "snippet,statistics,contentDetails", id: ids.join(",") }) : { items: [] };
  return {
    channel: {
      title: channel.snippet?.title,
      subscribers: Number(channel.statistics?.subscriberCount || 0),
      views: Number(channel.statistics?.viewCount || 0),
      videos: Number(channel.statistics?.videoCount || 0),
    },
    videos: (vids.items || []).map((v) => ({
      id: v.id,
      title: v.snippet?.title,
      publishedAt: v.snippet?.publishedAt,
      thumbnail: v.snippet?.thumbnails?.medium?.url || "",
      duration: v.contentDetails?.duration || "",
      views: Number(v.statistics?.viewCount || 0),
      likes: Number(v.statistics?.likeCount || 0),
      comments: Number(v.statistics?.commentCount || 0),
      url: `https://www.youtube.com/watch?v=${v.id}`,
    })),
  };
}

module.exports = { isConfigured, channelSummary };
