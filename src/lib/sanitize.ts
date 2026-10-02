import sanitizeHtml from "sanitize-html";

const options: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "h2", "h3", "h4", "ul", "ol", "li", "strong", "b", "em", "i", "u", "blockquote", "a", "img", "figure", "figcaption", "hr"],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height", "loading"],
  },
  allowedSchemes: ["https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["https"] },
  allowProtocolRelative: false,
  transformTags: {
    a: (tag, attribs) => ({ tagName: "a", attribs: { ...attribs, rel: "noopener noreferrer nofollow ugc", target: "_blank" } }),
    img: (tag, attribs) => ({ tagName: "img", attribs: { ...attribs, loading: "lazy" } }),
  },
  disallowedTagsMode: "discard",
};

/** Article bodies are stored as sanitised HTML; nothing else is trusted on the way out. */
export const cleanHtml = (html: string) => sanitizeHtml(html, options).trim();

export const stripHtml = (html: string) => sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim();

/** Plain-text field (titles, names): no markup at all. */
export const cleanText = (text: string) => stripHtml(text);
