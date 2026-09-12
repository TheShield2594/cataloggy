/**
 * The Stremio wire shapes.
 *
 * Everything the API sends is typed by `@cataloggy/shared` (see api-contracts
 * there). What stays local is what this service itself emits, which never
 * crosses the API boundary.
 */

export type StremioMetaPreview = {
  id: string;
  type: string;
  name: string;
  poster?: string;
  posterShape: "poster";
  genres?: string[];
};

export type StremioSubtitle = {
  id: string;
  url: string;
  lang: string;
};
