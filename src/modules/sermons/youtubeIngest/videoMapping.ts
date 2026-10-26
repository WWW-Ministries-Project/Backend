export type IngestSermonFields = {
  video_id: string; title: string; description?: string; tags: string[];
  youtube_url: string; thumbnail_url: string; preached_at?: string;
};
export const mapVideoToSermonFields = (resource: {
  id?: string;
  snippet?: { title?: string; description?: string; tags?: string[]; publishedAt?: string };
}): IngestSermonFields => {
  const video_id = String(resource.id ?? "");
  const snippet = resource.snippet ?? {};
  const title = (snippet.title ?? "").trim() || "Sermon";
  const description = (snippet.description ?? "").trim() || undefined;
  return {
    video_id, title, description,
    tags: Array.isArray(snippet.tags) ? snippet.tags : [],
    youtube_url: `https://www.youtube.com/watch?v=${video_id}`,
    thumbnail_url: `https://i.ytimg.com/vi/${video_id}/hqdefault.jpg`,
    preached_at: snippet.publishedAt || undefined,
  };
};
