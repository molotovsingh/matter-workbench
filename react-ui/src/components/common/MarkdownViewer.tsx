import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { safeMarkdownUrl } from '../../lib/markdownSafety';

export interface MarkdownViewerProps {
  content: string;
  className?: string;
  ariaLabel?: string;
}

export function MarkdownViewer({ content, className = '', ariaLabel }: MarkdownViewerProps) {
  const classes = ['markdown-viewer', className].filter(Boolean).join(' ');

  return (
    <div className={classes} aria-label={ariaLabel}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        skipHtml
        components={{
          a: ({ node: _node, href, children, ...props }) => {
            const safeHref = safeMarkdownUrl(href || '');
            if (!safeHref) return <span>{children}</span>;
            return (
              <a {...props} href={safeHref} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
          img: ({ alt }) => (alt ? <span>{alt}</span> : null),
        }}
      >
        {content || ''}
      </ReactMarkdown>
    </div>
  );
}
