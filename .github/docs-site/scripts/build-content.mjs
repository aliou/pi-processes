import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import GithubSlugger from "github-slugger";
import { toMarkdown } from "mdast-util-to-markdown";
import { codeToHtml } from "shiki";
import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const docsRoot = path.resolve(__dirname, "..");
const readmePath = path.join(repoRoot, "README.md");
const packageJsonPath = path.join(repoRoot, "package.json");
const outputPath = path.join(docsRoot, "src/content/README.generated.json");

const videoPattern = /<!--\s*VIDEO:\s*(\{[\s\S]*?\})\s*-->/g;

function replaceVideoComments(markdown) {
  const videos = new Map();
  let index = 0;
  const next = markdown.replace(videoPattern, (_match, json) => {
    const data = JSON.parse(json);
    const token = `VIDEO_PLACEHOLDER_${index++}`;
    videos.set(token, data);
    return token;
  });
  return { markdown: next, videos };
}

function isVideoParagraph(node) {
  return (
    node.type === "paragraph" &&
    node.children?.length === 1 &&
    node.children[0].type === "text" &&
    /^VIDEO_PLACEHOLDER_\d+$/.test(node.children[0].value)
  );
}

async function blockFromNode(node) {
  if (node.type === "code") {
    return {
      type: "code",
      lang: node.lang ?? undefined,
      html: await codeToHtml(node.value, {
        lang: node.lang || "text",
        theme: "github-dark",
      }),
    };
  }

  return {
    type: "markdown",
    markdown: toMarkdown(node).trim(),
  };
}

async function main() {
  const readme = await fs.readFile(readmePath, "utf8");
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  const { markdown, videos } = replaceVideoComments(readme);
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);

  const slugger = new GithubSlugger();
  let title = "Processes Extension";
  let description;
  const sections = [];
  let currentSection = null;

  for (const node of tree.children) {
    if (node.type === "heading") {
      const text = node.children
        .filter((child) => "value" in child)
        .map((child) => child.value)
        .join("")
        .trim();

      if (node.depth === 1) {
        title = text || title;
        currentSection = null;
        continue;
      }

      if (node.depth === 2 || node.depth === 3) {
        currentSection = {
          id: slugger.slug(text),
          title: text,
          level: node.depth,
          blocks: [],
        };
        sections.push(currentSection);
      }
      continue;
    }

    if (!description && !currentSection && node.type === "paragraph") {
      description = toMarkdown(node).trim();
      continue;
    }

    if (!currentSection) continue;

    if (isVideoParagraph(node)) {
      const key = node.children[0].value;
      const video = videos.get(key);
      currentSection.blocks.push({
        type: "video",
        id: video.id,
        title: video.title,
        url: video.url,
      });
      continue;
    }

    currentSection.blocks.push(await blockFromNode(node));
  }

  const doc = {
    title,
    description,
    repoUrl: packageJson.repository?.url,
    sections,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(doc, null, 2)}\n`);
}

await main();
