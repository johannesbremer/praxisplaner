// src/utils/seo.ts
export const seo = ({
  description,
  image,
  keywords,
  title,
  twitterCreator,
}: {
  description?: string;
  image?: string;
  keywords?: string;
  title: string;
  twitterCreator?: string;
}) => {
  const metaTags = [
    { content: description, name: "description" },
    { content: keywords, name: "keywords" },
    { content: title, name: "twitter:title" },
    { content: description, name: "twitter:description" },
    { content: "@tannerlinsley", name: "twitter:creator" },
    { content: twitterCreator || "@tannerlinsley", name: "twitter:creator" },
    { content: "website", property: "og:type" },
    { content: title, property: "og:title" },
    { content: description, property: "og:description" },
    ...(image
      ? [
          { content: image, name: "twitter:image" },
          { content: "summary_large_image", name: "twitter:card" },
          { content: image, property: "og:image" },
        ]
      : []),
  ].filter((tag) => tag.content !== undefined);

  return {
    metaTags,
    title,
  };
};
