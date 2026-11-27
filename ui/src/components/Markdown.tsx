import type { ReactNode } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useT } from '../i18n';
import { FILE_HREF, fileTargetOf, fileKind, localLinkPath, remarkFileLinks, resolveRelative } from '../filePaths';
import { useFileLinksContext } from '../fileLinks';
import { CodeBlock } from './CodeBlock';

const urlTransform = (url: string) => (url.startsWith(FILE_HREF) ? url : defaultUrlTransform(url));

/** A cited file: a button that opens it in the side panel when it can be opened, plain text otherwise. */
function FileLink({ path, line, children }: { path: string; line?: number; children: ReactNode }) {
  const links = useFileLinksContext();
  if (!links || !links.isLinkable(path)) return <>{children}</>;
  return (
    <button type="button" className="file-link" title={line ? `${path}:${line}` : path} onClick={() => links.open(path, line)}>
      {children}
    </button>
  );
}

/** An image in Markdown never loads by itself: a local one opens in the panel, a remote one shows its text. */
function BlockedImage({ src, alt, base }: { src?: string; alt?: string; base?: string }) {
  const t = useT();
  const local = src ? localLinkPath(src) : null;
  const path = local && fileKind(local) === 'image' ? (base ? resolveRelative(base, local) : local) : null;
  const label = alt || t('ui.panel.image');
  if (path) return <FileLink path={path}>{`🖼 ${label}`}</FileLink>;
  return (
    <span className="blocked-image" title={t('ui.panel.imageBlocked')}>
      {`🖼 ${label}`}
    </span>
  );
}

/**
 * The Markdown of messages and of Markdown files: GitHub flavour, no raw HTML (react-markdown drops it), no
 * image loaded from anywhere, and cited files as links to the side panel. `linkBase`: the file whose
 * relative links are relative to it.
 */
export function MarkdownText({ text, linkBase }: { text: string; linkBase?: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm, [remarkFileLinks, { linkBase }]]}
      urlTransform={urlTransform}
      skipHtml
      components={{
        a: ({ node: _node, href, children, ...props }) => {
          const f = fileTargetOf(href);
          if (f !== null) return <FileLink path={f.path} line={f.line}>{children}</FileLink>;
          return (
            <a {...props} href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        },
        img: ({ src, alt }) => <BlockedImage src={typeof src === 'string' ? src : undefined} alt={alt} base={linkBase} />,
        pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
      }}
    >
      {text}
    </Markdown>
  );
}
