module.exports = function(eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy("src/admin");
  eleventyConfig.addPassthroughCopy("src/_redirects");
  eleventyConfig.addPassthroughCopy("src/content.json");

  eleventyConfig.addFilter("date", function(date, format) {
    const d = new Date(date);
    if (format === "readable") {
      return d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
    }
    return d.toISOString().split("T")[0];
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data"
    }
  };
};
