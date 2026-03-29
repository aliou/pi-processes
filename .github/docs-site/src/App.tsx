import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import content from "./content/README.generated.json";

type Block =
  | { type: "markdown"; markdown: string }
  | { type: "code"; html: string; lang?: string }
  | { type: "video"; id: string; title: string; url?: string };

type Section = {
  id: string;
  title: string;
  level: number;
  blocks: Block[];
};

type Doc = {
  title: string;
  description?: string;
  repoUrl?: string;
  sections: Section[];
};

const doc = content as Doc;

function MarkdownBlock({ markdown, repoUrl }: { markdown: string; repoUrl?: string }) {
  return (
    <div className="markdown-block prose prose-neutral max-w-none prose-a:no-underline hover:prose-a:underline dark:prose-invert">
      <ReactMarkdown
        components={{
          a: ({ href, children }) => {
            const isRelativeLink =
              !!href &&
              !href.startsWith("#") &&
              !href.startsWith("http://") &&
              !href.startsWith("https://") &&
              !href.startsWith("mailto:");
            const normalizedHref = href?.startsWith("./") ? href.slice(2) : href;
            const resolvedHref =
              isRelativeLink && repoUrl
                ? `${repoUrl.replace(/\.git$/, "")}/blob/main/${normalizedHref}`
                : href;

            return (
              <a href={resolvedHref} rel="noreferrer" target="_blank">
                {children}
              </a>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ html }: { html: string }) {
  return (
    <div
      className="code-block overflow-x-auto rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function VideoBlock({ title, url }: { title: string; url?: string }) {
  if (url) {
    return (
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-950 dark:border-zinc-800">
        <video className="block w-full" controls playsInline preload="metadata">
          <source src={url} type="video/mp4" />
        </video>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-10 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
      Video placeholder: {title}
    </div>
  );
}

function SectionView({ section }: { section: Section }) {
  const Tag = section.level === 2 ? "h2" : "h3";

  return (
    <section className="scroll-mt-20" id={section.id}>
      <Tag className={section.level === 2 ? "mt-14 mb-4 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50" : "mt-8 mb-3 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"}>
        {section.title}
      </Tag>
      <div className="space-y-5">
        {section.blocks.map((block, index) => {
          if (block.type === "markdown") {
            return <MarkdownBlock key={index} markdown={block.markdown} repoUrl={doc.repoUrl} />;
          }
          if (block.type === "code") {
            return <CodeBlock key={index} html={block.html} />;
          }
          return <VideoBlock key={index} title={block.title} url={block.url} />;
        })}
      </div>
    </section>
  );
}

export default function App() {
  const tocSections = useMemo(
    () => doc.sections.filter((section) => section.level === 2),
    [],
  );
  const [activeSection, setActiveSection] = useState(tocSections[0]?.id ?? "");

  useEffect(() => {
    const observers = tocSections
      .map((section) => {
        const el = document.getElementById(section.id);
        if (!el) return undefined;
        const observer = new IntersectionObserver(
          ([entry]) => {
            if (entry.isIntersecting) {
              setActiveSection(section.id);
            }
          },
          { rootMargin: "-20% 0px -60% 0px" },
        );
        observer.observe(el);
        return observer;
      })
      .filter(Boolean) as IntersectionObserver[];

    return () => {
      for (const observer of observers) observer.disconnect();
    };
  }, [tocSections]);

  return (
    <div className="min-h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <nav className="sticky top-0 z-50 border-b border-zinc-200/80 bg-white/85 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-4 px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-600 text-xs font-bold text-white dark:bg-blue-500">
              {doc.title[0]}
            </div>
            <span className="truncate text-sm font-semibold">{doc.title}</span>
          </div>
          <a className="text-sm text-blue-600 hover:underline dark:text-blue-400" href={doc.repoUrl} rel="noreferrer" target="_blank">
            GitHub ↗
          </a>
        </div>
      </nav>

      <div className="mx-auto flex max-w-[1080px] gap-10 px-6 py-10">
        <aside className="sticky top-20 hidden h-[calc(100vh-6rem)] w-[200px] shrink-0 overflow-y-auto lg:block">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
            On this page
          </div>
          <div className="space-y-1">
            {tocSections.map((section) => (
              <a
                key={section.id}
                className={`block border-l-2 py-1 pl-3 text-sm ${activeSection === section.id ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400" : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"}`}
                href={`#${section.id}`}
              >
                {section.title}
              </a>
            ))}
          </div>
        </aside>

        <main className="min-w-0 max-w-[720px] flex-1">
          <header>
            <h1 className="text-4xl font-bold tracking-tight text-zinc-950 dark:text-white">
              {doc.title}
            </h1>
            {doc.description ? (
              <div className="mt-4">
                <MarkdownBlock markdown={doc.description} repoUrl={doc.repoUrl} />
              </div>
            ) : null}
          </header>

          <div className="mt-10 space-y-2">
            {doc.sections.map((section) => (
              <SectionView key={section.id} section={section} />
            ))}
          </div>
        </main>
      </div>

      <footer className="mx-auto max-w-[1080px] border-t border-zinc-200 px-6 py-6 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        A <a className="text-blue-600 hover:underline dark:text-blue-400" href="https://pi.dev" rel="noreferrer" target="_blank">Pi</a> extension
      </footer>
    </div>
  );
}
